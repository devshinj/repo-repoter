# Dashboard Newsfeed & Milestone 설계 스펙

## 개요

대시보드를 RSS 기반 뉴스피드 + 마일스톤 중심으로 개편한다. 각 저장소의 RSS/Atom 피드를 구독하여 최신 커밋 활동을 수집하고, LLM이 프로젝트/저장소 단위로 브리핑을 생성한다. 마일스톤을 자연어로 설정하면 LLM이 구조화하고, 커밋 활동 기반으로 진행 상태를 자동 추론한다.

## 동기

- 기존 대시보드는 통계 + 저장소 목록으로 구성되어 저장소 관리 페이지와 중복됨
- 사용자에게 "지금 무슨 일이 벌어지고 있는지" 알려주는 실질적 정보가 없음
- 기존 Octokit API 동기화는 깊은 분석(보고서/업무 등록)용으로 무거움. 가벼운 최신 활동 감지 채널이 필요함

## 핵심 개념

### RSS vs 기존 API 동기화 역할 분리

| | RSS 수집 (신규) | Octokit API 수집 (기존) |
|---|---|---|
| 목적 | 뉴스피드용 최신 활동 감지 | 보고서/업무 등록용 깊은 분석 |
| 데이터 | SHA, 작성자, 메시지, 시각 | + diff stat, 변경 파일 목록 |
| 저장소 | rss_commits | commit_cache |
| 주기 | 3시간 + 대시보드 접속 시 | 기존 스케줄 유지 |

### 브리핑 계층 구조

프로젝트/마일스톤 설정 상태에 따라 피드 구조가 점진적으로 풍부해진다:

1. **저장소만 있을 때** -> 저장소별 브리핑 + LLM 프로젝트 그룹핑 제안
2. **프로젝트 묶음 시** -> 프로젝트별 통합 브리핑
3. **마일스톤 추가 시** -> 마일스톤 상태 헤더 + 브리핑

### 마일스톤 상태 자동 추론

LLM이 커밋 활동 패턴을 기반으로 정성적 상태를 판단한다 (퍼센트 진행률 없음):

| 상태 | 추론 근거 |
|------|----------|
| 미착수 | 마일스톤 관련 커밋이 없음 |
| 개발 중 | 관련 커밋이 활발하게 올라오는 중 |
| 수정/보완 | feat -> fix/refactor 패턴으로 전환 |
| 활동 없음 | 관련 커밋이 며칠째 없음 |
| 지연 위험 | 마감 임박인데 활동 저조 |

## 데이터 모델

### 신규 테이블

#### `projects` -- 프로젝트 (저장소 그룹)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INTEGER PK | |
| user_id | TEXT FK | 소유자 |
| name | TEXT | 프로젝트명 |
| description | TEXT (nullable) | 설명 |
| created_at | TEXT | |
| updated_at | TEXT | |

#### `project_repositories` -- 프로젝트-저장소 매핑

| 컬럼 | 타입 | 설명 |
|------|------|------|
| project_id | INTEGER FK | |
| repository_id | INTEGER FK | |
| PK | (project_id, repository_id) | 복합키 |

#### `milestones` -- 마일스톤

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INTEGER PK | |
| user_id | TEXT FK | |
| project_id | INTEGER FK (nullable) | 프로젝트 연결 시 |
| repository_id | INTEGER FK (nullable) | 저장소 단독 연결 시 |
| title | TEXT | LLM이 가공한 명확한 제목 |
| raw_input | TEXT | 사용자 원문 자연어 |
| deadline | TEXT (nullable) | 마감일 (YYYY-MM-DD) |
| status | TEXT | active / completed / cancelled |
| created_at | TEXT | |
| updated_at | TEXT | |

> CHECK 제약: project_id 또는 repository_id 중 하나는 반드시 값이 있어야 한다.

#### `rss_commits` -- RSS 전용 커밋 캐시

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INTEGER PK | |
| repository_id | INTEGER FK | |
| sha | TEXT | 커밋 SHA |
| author_name | TEXT | 커밋 작성자 |
| message | TEXT | 커밋 메시지 |
| committed_at | TEXT | 커밋 시각 |
| feed_entry_id | INTEGER FK (nullable) | 포함된 브리핑 |
| created_at | TEXT | |
| UNIQUE | (repository_id, sha) | |

#### `feed_entries` -- 뉴스피드 캐시

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INTEGER PK | |
| user_id | TEXT FK | |
| scope_type | TEXT | 'project' 또는 'repository' |
| scope_id | INTEGER | project_id 또는 repository_id |
| briefing | TEXT | LLM 생성 브리핑 본문 |
| milestone_summary | TEXT (nullable) | 마일스톤 컨텍스트 요약 |
| commit_shas | TEXT | 요약에 포함된 커밋 SHA JSON 배열 |
| group_suggestion | TEXT (nullable) | LLM 프로젝트 묶음 제안 JSON |
| period_start | TEXT | 브리핑 대상 기간 시작 |
| period_end | TEXT | 브리핑 대상 기간 끝 |
| created_at | TEXT | |

## RSS 수집 파이프라인

### RSS 피드 URL 생성 규칙

credential의 `metadata.type`과 `metadata.host`를 기반으로 플랫폼별 Atom/RSS URL을 조합한다:

```
GitHub:  https://{host}/{owner}/{repo}/commits/{branch}.atom
GitLab:  https://{host}/{owner}/{repo}/-/commits/{branch}?format=atom
Gitea:   https://{host}/{owner}/{repo}.rss
```

### 수집 흐름

```
1. [백그라운드 3시간 주기] 또는 [대시보드 접속 시]
   +-- 활성 저장소 목록 조회
   +-- 각 저장소의 credential에서 host/type 확인
   +-- RSS URL 생성 -> fetch -> XML 파싱
   +-- 파싱된 커밋 엔트리를 rss_commits 테이블에 저장
       (이미 있는 SHA는 skip)

2. 새 커밋이 있는 저장소/프로젝트만 LLM 요약 대상으로 마킹
```

### XML 파싱 전략

외부 라이브러리 없이 가벼운 XML 파서로 Atom/RSS 피드를 처리한다. 피드 구조가 단순하므로 (entry -> id, title, author, updated) 범용 파서가 불필요하다.

## LLM 브리핑 생성

### 트리거 조건

1. 백그라운드 (3시간 주기): RSS 수집 후 feed_entry_id가 null인 새 커밋이 있으면
2. 대시보드 접속 시: RSS 즉시 fetch -> 새 커밋 발견 시

### 요약 단위

| 상황 | 요약 범위 |
|------|----------|
| 프로젝트 있음 | 프로젝트에 속한 모든 저장소의 새 커밋을 묶어서 하나의 브리핑 |
| 프로젝트 없음 | 저장소 개별로 브리핑 |
| 마일스톤 있음 | 브리핑 앞에 마일스톤 상태 분석(milestone_summary)이 붙음 |

### 브리핑 톤

- 친절하고 명확한 비즈니스 톤, 구어체
- 작업자별 분류하여 누가 무엇을 하고 있는지 정리
- 예시: "오늘 3명이 활동했어요. 재석님은 인증 미들웨어를 리팩토링했고, 민수님은 대시보드 API 2건을 수정했어요."

### LLM 프롬프트 구조

기존 Qwen(vLLM) 클라이언트를 재사용한다.

#### 브리핑 생성 프롬프트

```
[시스템]
당신은 개발팀의 업무 현황을 브리핑하는 어시스턴트입니다.
친절하고 명확한 비즈니스 톤으로, 구어체로 설명하세요.
작업자별로 분류하여 누가 무엇을 하고 있는지 정리하세요.

[입력 데이터]
- 프로젝트/저장소 이름
- 커밋 목록: [{author, message, committed_at}, ...]
- (있으면) 마일스톤: {title, deadline, raw_input}

[출력 형식]
- 마일스톤이 있으면: 마일스톤 상태 분석 먼저 (상태: 개발 중/수정/미착수/지연 위험 등)
- 이후: 작업자별 활동 요약
```

#### 프로젝트 그룹핑 제안 프롬프트

```
[추가 지시]
아래 저장소들이 같은 프로젝트에 속할 가능성이 있는지 판단하세요.
관련성이 보이면 { "suggestion": "...", "repositories": [...] } 형태로 제안하세요.
관련성이 없으면 null을 반환하세요.
```

## 마일스톤 설정 플로우

### 입력 -> 가공 -> 확인 -> 저장

```
사용자: "다음 주 금요일까지 프론트엔드 로그인 페이지 완성해야 해"
    |
LLM 가공 (POST /api/milestones/parse)
    |
LLM 응답:
  - 제목: "프론트엔드 로그인 페이지 완성"
  - 마감일: 2026-06-27
  - 연결 대상: [추천] frontend-app 저장소 / MyProject 프로젝트
    |
사용자에게 확인 UI 표시
  [제목 수정 가능] [마감일 수정 가능] [연결 대상 선택]
  [확인] [취소]
    |
확인 시 milestones 테이블에 저장 (POST /api/milestones)
```

### 마일스톤 파싱 LLM 프롬프트

```
[시스템]
사용자의 자연어 목표를 구조화하세요.

[입력]
- 사용자 원문: "..."
- 현재 날짜: YYYY-MM-DD
- 등록된 프로젝트 목록: [...]
- 등록된 저장소 목록: [...]

[출력 JSON]
{
  "title": "명확하고 간결한 마일스톤 제목",
  "deadline": "YYYY-MM-DD 또는 null",
  "suggested_scope": {
    "type": "project | repository",
    "id": 숫자,
    "name": "이름",
    "confidence": "high | medium | low"
  }
}
```

### 입력 진입점

1. **뉴스피드 상단 입력 바**: 범용 마일스톤 입력. 클릭 시 확장, LLM이 연결 대상 추천
2. **각 브리핑 카드 내 버튼**: 맥락 연결 입력. 프로젝트/저장소가 이미 선택된 채로 다이얼로그 오픈

### 상태 관리

- 자동 상태 추론: 브리핑 생성 시 LLM이 커밋 활동 기반으로 판단
- 수동 완료/취소: 사용자가 completed 또는 cancelled로 변경 가능
- 마감일 경과: deadline이 지났는데 active면 "지연" 상태로 표시

## 대시보드 UI 구성

### 레이아웃

```
+-------------------------+------------------------------------+
|  인사말                  | 마일스톤 입력 바                     |
|  (에러 시 알림 배너)      |                                    |
+-------------------------+------------------------------------+
|  통계 카드 (4개)          | 뉴스피드                            |
|                         |  +------------------------------+  |
+-------------------------+  | 마일스톤 헤더 + 브리핑 카드     |  |
|  6개월 히트맵             |  +------------------------------+  |
|                         |  | 저장소 브리핑 카드             |  |
+-------------------------+  +------------------------------+  |
|  성장 트리               |  | 프로젝트 그룹핑 제안 배너      |  |
|                         |  +------------------------------+  |
+-------------------------+------------------------------------+
```

### 왼쪽 패널 (상태 요약)

- 고정 높이, 스크롤 없음
- 인사말: 시간대별 인사. 정상 시 깔끔하게, 에러 시 알림 배너 + 수동 재시도 버튼
- 통계 카드 4개: 기존 유지
- 히트맵: 기존 유지
- 성장 트리: 기존 유지

### 오른쪽 패널 (뉴스피드)

- 스크롤 가능
- 최상단: 마일스톤 입력 바 (클릭 시 확장)
- 브리핑 카드: 마일스톤 있으면 헤더 포함, 없으면 활동 요약만
- 프로젝트 그룹핑 제안 배너: LLM 제안 시 노출
- 각 카드에 마일스톤 추가 버튼

### 반응형

- 데스크톱 (1024px+): 좌우 분할 (좌 ~350px 고정, 우 나머지)
- 모바일/태블릿: 세로 스택 (상태 요약 -> 뉴스피드 순서)

## API 엔드포인트

### 신규

| Method | Path | 역할 |
|--------|------|------|
| GET | /api/feed | 뉴스피드 목록 조회 |
| POST | /api/feed/refresh | RSS 즉시 수집 + 브리핑 생성 |
| GET | /api/projects | 프로젝트 목록 조회 |
| POST | /api/projects | 프로젝트 생성 |
| PUT | /api/projects/:id | 프로젝트 수정 |
| DELETE | /api/projects/:id | 프로젝트 삭제 |
| GET | /api/milestones | 마일스톤 목록 조회 |
| POST | /api/milestones | 마일스톤 생성 |
| PUT | /api/milestones/:id | 마일스톤 수정 |
| DELETE | /api/milestones/:id | 마일스톤 삭제 |
| POST | /api/milestones/parse | 자연어 파싱 프리뷰 |

### 기존 API 변경 없음

/api/sync, /api/repos, /api/cron 등 기존 엔드포인트는 그대로 유지한다. RSS 수집은 기존 Octokit 동기화와 독립적으로 동작한다.

## 아키텍처 배치

### 파일 구조

```
src/
+-- core/
|   +-- feed/
|   |   +-- rss-parser.ts        # XML -> 커밋 엔트리 변환 (순수 함수)
|   |   +-- briefing-prompt.ts   # LLM 프롬프트 조립 (순수 함수)
|   |   +-- feed-types.ts        # FeedEntry, RssCommit 등 타입
|   +-- project/
|   |   +-- project-types.ts     # Project, Milestone 타입
|   +-- types.ts                 # 기존 (변경 없음)
+-- infra/
|   +-- rss/
|   |   +-- rss-client.ts        # RSS URL 생성 + fetch (플랫폼별 분기)
|   +-- db/
|       +-- feed-repository.ts   # rss_commits, feed_entries CRUD
|       +-- project-repository.ts # projects, project_repositories CRUD
|       +-- milestone-repository.ts # milestones CRUD
|       +-- schema.ts            # 테이블 추가 (기존 파일에 마이그레이션)
+-- scheduler/
|   +-- polling-manager.ts       # 기존 (변경 없음)
|   +-- feed-scheduler.ts        # 3시간 주기 RSS 수집 + 브리핑 생성
+-- app/api/
    +-- feed/                    # GET, POST refresh
    +-- projects/                # CRUD
    +-- milestones/              # CRUD + parse
```

### 레이어 의존 방향

```
app/api/     -> core/ OK   -> infra/ OK
scheduler/   -> core/ OK   -> infra/ OK
core/        -> infra/ NO  (순수 함수만, 외부 import 금지)
```

### 스케줄러 등록

instrumentation.ts에서 기존 polling-manager와 함께 feed-scheduler를 등록한다:

```
기존: node-cron "0 9 * * *"   -> 보고서 생성 (유지)
신규: node-cron "0 */3 * * *" -> RSS 수집 + 브리핑 생성
```

### 기존 시스템과의 관계

| 기존 | 신규 | 관계 |
|------|------|------|
| Octokit 커밋 수집 | RSS 커밋 수집 | 독립 (별도 테이블, 별도 스케줄) |
| commit_cache | rss_commits | 용도 분리 (깊은 분석 vs 뉴스피드) |
| polling-manager | feed-scheduler | 병렬 동작, instrumentation.ts에서 각각 초기화 |
