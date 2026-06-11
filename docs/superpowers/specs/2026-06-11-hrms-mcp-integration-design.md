# HRMS MCP 통합 — 자동 업무 등록 설계

## 개요

Repo Reporter의 커밋 데이터를 활용하여 HRMS에 일일 업무를 자동 등록하는 기능.
HRMS MCP(Model Context Protocol) 엔드포인트를 JSON-RPC over HTTP로 직접 호출한다.

### 핵심 흐름

```
사용자: MCP Key 등록 → HRMS 프로젝트 ↔ 저장소 매핑 설정 → 자동/수동 트리거
시스템: 전일 커밋 수집 → Gemini AI 요약 → HRMS 태스크 1건 생성
```

### 기존 DailyTask 파이프라인과의 관계

별개 기능. DailyTask는 저장소별 AI 분석 결과이고, HRMS 업무 등록은 HRMS 프로젝트 단위로 여러 저장소의 커밋을 조합하여 별도 생성한다.

---

## 1. 데이터 모델

### 1.1 hrms_api_keys — 사용자별 MCP API Key

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INTEGER PK | |
| user_id | TEXT UNIQUE | Auth.js 사용자 ID |
| encrypted_key | TEXT | AES-256-GCM 암호화 (기존 token-encryption 활용) |
| hrms_user_name | TEXT | whoami 응답의 사용자명 |
| scopes | TEXT (JSON) | whoami 응답의 권한 범위 |
| created_at | TEXT | |
| updated_at | TEXT | |

### 1.2 hrms_project_mappings — HRMS 프로젝트 ↔ 저장소 매핑

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INTEGER PK | |
| user_id | TEXT | Auth.js 사용자 ID |
| hrms_project_id | INTEGER | HRMS 프로젝트 ID |
| hrms_project_name | TEXT | 프로젝트명 (표시용 캐시) |
| auto_register | INTEGER (BOOLEAN) | 자동 등록 ON/OFF |
| cron_time | TEXT | 자동 등록 시각 (기본: "0 9 * * 1-5") |
| created_at | TEXT | |
| updated_at | TEXT | |

### 1.3 hrms_mapping_repos — 매핑-저장소 연결 (N:M)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| mapping_id | INTEGER FK → hrms_project_mappings.id | |
| repository_id | INTEGER FK → repositories.id | |
| PK | (mapping_id, repository_id) 복합키 | |

### 1.4 hrms_task_logs — HRMS 등록 이력

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INTEGER PK | |
| mapping_id | INTEGER FK | |
| hrms_task_id | INTEGER | HRMS에서 반환된 태스크 ID |
| target_date | TEXT | 대상 날짜 (YYYY-MM-DD) |
| title | TEXT | 등록한 제목 |
| description | TEXT | 등록한 내용 |
| status | TEXT | success / error |
| error_message | TEXT | |
| created_at | TEXT | |

**중복 방지:** 동일 (mapping_id, target_date) 조합이 status=success로 존재하면 스킵.

**타임존:** 전일 계산 및 dueDate는 Asia/Seoul 기준. commit_cache의 committed_date 조회 시 KST 기준 전일 00:00~23:59 범위로 필터링.

---

## 2. Infra 레이어 — HRMS MCP 클라이언트

### 2.1 위치

```
src/infra/hrms/hrms-client.ts
```

### 2.2 통신 방식

JSON-RPC over HTTP. 추가 의존성 없이 fetch로 호출.

```
POST https://hrms.cudo.co.kr:9700/api/mcp
Headers:
  Authorization: Bearer <api_key>
  Content-Type: application/json
  Accept: application/json, text/event-stream
Body:
  {"jsonrpc":"2.0","id":n,"method":"tools/call","params":{"name":"<tool>","arguments":{...}}}
```

### 2.3 함수 목록

| 함수 | HRMS MCP 도구 | 용도 |
|------|--------------|------|
| `callMcpTool(apiKey, toolName, args)` | (범용) | JSON-RPC 요청 래퍼 |
| `verifyApiKey(apiKey)` | whoami | Key 유효성 + 사용자 정보 |
| `listProjects(apiKey)` | list_projects | 프로젝트 목록 조회 |
| `getProject(apiKey, id)` | get_project | 프로젝트 상세 |
| `createTask(apiKey, params)` | create_task | 태스크 생성 |
| `listCommonCodes(apiKey, groupCode?)` | list_common_codes | enum 값 조회 |

### 2.4 에러 처리

HRMS MCP 에러 코드를 통일된 형태로 변환:

| HRMS 에러 | 의미 |
|-----------|------|
| E_AUTH_FORBIDDEN | API Key 권한 부족 |
| E_VALIDATION | 파라미터 오류 |
| E_RATE_LIMITED | rate limit (60/분, 1000/일) |
| E_NOT_FOUND | 리소스 없음 |

---

## 3. API Routes

```
app/api/hrms/
  key/route.ts                  GET / POST / DELETE — MCP Key 관리
  projects/route.ts             GET — HRMS 프로젝트 목록 (프록시)
  common-codes/route.ts         GET — 공통코드 조회 (프록시)
  mappings/route.ts             GET / POST — 매핑 목록 / 생성
  mappings/[id]/route.ts        PUT / DELETE — 매핑 수정 / 삭제
  register/route.ts             POST — 수동 등록 트리거
  register/history/route.ts     GET — 등록 이력 조회
```

### 주요 흐름

**Key 등록:** `POST /api/hrms/key { apiKey }`
→ hrms-client.verifyApiKey() → whoami 검증 → encrypt() → DB 저장

**매핑 생성:** `POST /api/hrms/mappings { hrmsProjectId, repoIds[], autoRegister, cronTime }`
→ HRMS 프로젝트 유효성 확인 → DB 저장

**수동 등록:** `POST /api/hrms/register { mappingId, targetDate? }`
→ 매핑의 저장소들 → 전일 commit_cache 조회 → Gemini 요약 → create_task → 이력 기록

**자동 등록:** 스케줄러 → auto_register=true인 매핑들 순회 → 위 등록 로직 동일 실행

---

## 4. HRMS 업무 생성 파이프라인

### 4.1 파이프라인 단계

```
1. 커밋 수집    — 매핑 저장소들의 전일 commit_cache 조회
2. 시간 추정    — core/analyzer/time-estimator.ts (순수 함수)
3. Gemini 요약  — 여러 저장소 커밋 → 단일 업무 설명 텍스트 생성
4. HRMS 등록    — create_task 호출
5. 이력 기록    — hrms_task_logs 저장
```

### 4.2 소요시간 추정 (core/analyzer/time-estimator.ts)

순수 함수. 외부 의존성 없음.

```typescript
estimateWorkMinutes(commits: CommitRecord[]): number
```

추정 기준:
- 커밋별 변경 규모 (additions + deletions) 기반
  - 50줄 이하 → 20분
  - 50~200줄 → 40분
  - 200줄 초과 → 60분
- 일일 상한: 480분 (8시간)
- 일일 하한: 60분 (최소 1시간)

### 4.3 Gemini 프롬프트 (infra/gemini/gemini-client.ts에 추가)

```typescript
buildHrmsTaskPrompt(
  projectName: string,
  date: string,
  repoCommits: Array<{ repoName: string; commits: CommitRecord[] }>,
  estimatedMinutes: number
): string
```

프롬프트 구조:
```
HRMS 프로젝트 "${projectName}"에서 ${date}에 수행된 작업을 업무 보고 형식으로 정리해주세요.

[저장소별 커밋 목록]
## repo-frontend (2건, +57/-11)
- [abc1234] feat: 로그인 페이지 UI 구현 (+45/-3)
- [def5678] fix: 버튼 클릭 이벤트 수정 (+12/-8)

## repo-backend (1건, +120/-0)
- [ghi9012] feat: 인증 API 엔드포인트 추가 (+120/-0)

추정 총 작업 시간: 약 ${estimatedMinutes}분

규칙:
- 관련 커밋을 논리적 작업 단위로 묶어 정리
- 각 작업 항목은 "- " 로 시작
- 마지막에 "추정 작업 시간: 약 N시간 M분" 을 기재
- 한국어로 작성, 저장소명 언급 불필요
- 텍스트만 응답
```

### 4.4 HRMS 태스크 생성 파라미터

```typescript
create_task({
  title: `[${projectName}] ${targetDate} 개발 업무`,
  description: geminiResult,
  projectId: mapping.hrmsProjectId,
  status: "done",
  priority: "medium",
  dueDate: targetDate,
  timeSpentMinutes: estimatedMinutes
})
```

---

## 5. 스케줄러 — 자동 등록

### 5.1 위치

```
src/scheduler/hrms-scheduler.ts
```

### 5.2 동작 방식

매핑별 개별 cron job. 서버 시작 시 auto_register=true인 매핑들을 조회하여 각각 등록.

```typescript
startHrmsScheduler()    // instrumentation.ts에서 호출
stopHrmsScheduler()     // 서버 종료 시
refreshJob(mappingId)   // 매핑 설정 변경 시 해당 job만 재등록
```

### 5.3 실행 흐름

```
cron 트리거 (예: 매일 09:00)
  → 해당 매핑의 저장소들에서 전일 commit_cache 조회
  → 커밋 0건이면 스킵 (태스크 미생성, 로그만 기록)
  → 커밋 있으면 → 파이프라인 실행 (4.1 참조)
```

### 5.4 중복 방지

hrms_task_logs에서 동일 (mapping_id, target_date) 조합이 status=success로 존재하면 스킵.
수동 등록 후 자동 등록이 돌아도 중복 생성되지 않음.

### 5.5 instrumentation.ts 수정

기존 startPollingManager() 호출 아래에 startHrmsScheduler() 추가.

---

## 6. UI — HRMS 업무 관리 페이지

### 6.1 위치

```
app/(dashboard)/hrms/page.tsx
components/hrms/
  api-key-form.tsx        — Key 등록 폼
  mapping-card.tsx        — 프로젝트 매핑 카드
  mapping-modal.tsx       — 매핑 추가/수정 모달
  register-history.tsx    — 등록 이력 테이블
```

### 6.2 화면 상태

**MCP Key 미등록 시:**
- Key 등록 안내 + 사용 가이드 링크 (https://mc1024.notion.site/HRMS-MCP-37b60ffc8ee08012bc4af8cbd6d00e73)
- API Key 입력 폼

**Key 등록 완료 후 — 메인 화면:**
- 상단: 연결된 HRMS 사용자 정보 + Key 변경/삭제
- 안내 문구: "자동 등록은 설정된 시각에 전일 업무를 HRMS에 등록합니다. 전일 하루 동안의 커밋을 분석하여 업무 내용을 작성합니다."
- 프로젝트 매핑 카드 목록 (각 카드: 프로젝트명, 연결 저장소, 자동등록 상태, 최근 등록, 수동등록/수정/삭제 버튼)
- 하단: 등록 이력 테이블

**프로젝트 매핑 추가 모달:**
- HRMS 프로젝트 선택 (list_projects에서 실시간 조회)
- 연결할 저장소 복수 선택 (사용자의 등록된 저장소 목록)
- 자동 등록 ON/OFF + 시각 설정

### 6.3 사이드바 메뉴 추가

기존 사이드바에 "HRMS 업무 관리" 항목 추가. lucide-react 아이콘 사용.

---

## 7. 파일 구조 및 레이어 의존 검증

```
src/
├── core/analyzer/
│   └── time-estimator.ts              # 순수 함수
├── infra/
│   ├── hrms/hrms-client.ts            # HRMS MCP JSON-RPC 래퍼
│   ├── gemini/gemini-client.ts        # (기존) + buildHrmsTaskPrompt
│   └── db/schema.ts                   # (기존) + HRMS 테이블 4개
├── scheduler/
│   └── hrms-scheduler.ts             # 자동 등록 cron 관리
├── app/
│   ├── api/hrms/                     # API Routes (7개)
│   └── (dashboard)/hrms/page.tsx     # UI 페이지
└── components/hrms/                  # UI 컴포넌트 (4개)
```

의존 방향:
```
app/*           → infra/, core/    ✅
scheduler/      → infra/, core/    ✅
core/analyzer/  → (없음)           ✅
infra/hrms/     → (fetch만)        ✅
```

---

## 8. 환경 설정

기존 환경 변수 외 추가 필요 없음.
- HRMS MCP Key는 사용자별로 DB에 암호화 저장 (AUTH_SECRET 기반)
- HRMS MCP 엔드포인트 URL은 hrms-client.ts에 상수로 정의
- Gemini API Key는 기존 GEMINI_API_KEY 환경 변수 공유
