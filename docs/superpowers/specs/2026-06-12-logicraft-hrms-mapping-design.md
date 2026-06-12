# LogiCraft HRMS 매핑 설계

> 작성일: 2026-06-12
> 상태: 승인됨

## 목적

HRMS 업무 등록 시스템에 LogiCraft 설계 산출물 기반의 업무 이력 등록 기능을 추가한다.
기존 Git 커밋 기반 repo 매핑과 병렬로, LogiCraft 프로젝트의 일일 수정 활동을 수집하여
Gemini AI로 요약한 뒤 HRMS 태스크로 자동/수동 등록한다.

## 아키텍처 결정

**접근 방식:** 별도 테이블 + 별도 API (기존 repo 매핑 코드 미수정)

기존 repo 매핑 패턴을 복제하되, LogiCraft 전용 테이블/클라이언트/라우트를 신설한다.
기존 코드 변경을 최소화하고, 카드 UI도 자연스럽게 분리된다.

## 1. Database Schema

### logicraft_api_keys

LogiCraft API 키 저장. 사용자별 1개.

| Column | Type | Constraint |
|--------|------|------------|
| id | INTEGER | PRIMARY KEY |
| user_id | TEXT | UNIQUE |
| encrypted_key | TEXT | NOT NULL |
| created_at | TEXT | DEFAULT CURRENT_TIMESTAMP |
| updated_at | TEXT | DEFAULT CURRENT_TIMESTAMP |

### hrms_logicraft_mappings

LogiCraft 프로젝트 ↔ HRMS 프로젝트 매핑.

| Column | Type | Constraint |
|--------|------|------------|
| id | INTEGER | PRIMARY KEY |
| user_id | TEXT | NOT NULL |
| hrms_project_id | TEXT | NOT NULL |
| hrms_project_name | TEXT | NOT NULL |
| logicraft_project_id | TEXT | NOT NULL |
| logicraft_project_name | TEXT | NOT NULL |
| auto_register | INTEGER | DEFAULT 0 |
| cron_time | TEXT | DEFAULT '0 9 * * 1-5' |
| created_at | TEXT | DEFAULT CURRENT_TIMESTAMP |
| updated_at | TEXT | DEFAULT CURRENT_TIMESTAMP |
| | | UNIQUE(user_id, logicraft_project_id) |

### hrms_logicraft_task_logs

업무 등록 감사 로그. `hrms_task_logs`와 동일 구조.

| Column | Type | Constraint |
|--------|------|------------|
| id | INTEGER | PRIMARY KEY |
| mapping_id | INTEGER | FK → hrms_logicraft_mappings |
| hrms_task_id | TEXT | |
| target_date | TEXT | NOT NULL |
| title | TEXT | |
| description | TEXT | |
| status | TEXT | 'success' or 'error' |
| error_message | TEXT | |
| created_at | TEXT | DEFAULT CURRENT_TIMESTAMP |

## 2. LogiCraft Client

**파일:** `src/infra/logicraft/logicraft-client.ts`

HRMS 클라이언트와 동일한 JSON-RPC 2.0 패턴으로 `https://logicraft.cudo.co.kr:10000/api/mcp` 호출.

### 제공 함수

| 함수 | MCP Tool | 용도 |
|------|----------|------|
| `verifyApiKey(apiKey)` | `list_projects` | API key 유효성 검증 (호출 성공 여부로 판단) |
| `listProjects(apiKey)` | `list_projects` | 접근 가능한 프로젝트 목록 |
| `listItems(apiKey, projectId, type, options?)` | `list_items` | 타입별 ITEM 목록 (offset/limit) |
| `listProposals(apiKey, projectId, status?)` | `list_proposals` | 변경 제안 목록 |
| `getItem(apiKey, projectId, id)` | `get_item` | 개별 ITEM 상세 |
| `listNotes(apiKey, projectId, search?)` | `list_notes` | 노트 목록 |

### 인증

모든 요청에 API key를 HTTP 헤더로 전달 (HRMS 클라이언트와 동일 패턴).

### 일일 활동 수집 흐름

1. 주요 ITEM 타입(`requirement`, `feature`, `adr`, `domain_feature`, `api_endpoint`, `screen_spec` 등)에 대해 `listItems` 호출
2. 응답의 `updated_at` 타임스탬프로 해당 날짜 수정 건 필터링
3. `listProposals`로 해당일 제출/처리된 제안 확인
4. 필요 시 `getItem`으로 상세 내용 조회
5. 수집된 데이터를 Gemini에 전달하여 업무 요약 생성

## 3. API Routes

기존 HRMS API 라우트 패턴을 따라 `/api/logicraft/` 하위에 구성.

| Method | Path | 용도 |
|--------|------|------|
| `POST` | `/api/logicraft/verify` | API key 검증 + 프로젝트 목록 반환 |
| `GET` | `/api/logicraft/key` | 저장된 API key 존재 여부 확인 |
| `POST` | `/api/logicraft/key` | API key 저장 (암호화) |
| `DELETE` | `/api/logicraft/key` | API key 삭제 |
| `GET` | `/api/logicraft/mappings` | 사용자의 LogiCraft 매핑 목록 |
| `POST` | `/api/logicraft/mappings` | 매핑 생성 (HRMS 프로젝트 ↔ LogiCraft 프로젝트) |
| `PUT` | `/api/logicraft/mappings/[id]` | 매핑 수정 (auto_register, cron 등) |
| `DELETE` | `/api/logicraft/mappings/[id]` | 매핑 삭제 |
| `POST` | `/api/logicraft/register` | 업무 등록 (LogiCraft 활동 → HRMS 태스크) |
| `GET` | `/api/logicraft/tasks` | 매핑별 최근 등록 이력 조회 |

### POST /api/logicraft/register 흐름

1. 중복 검사 (로컬 로그 + HRMS `listTasks`)
2. LogiCraft에서 해당 날짜 활동 수집 (`listItems` + `listProposals`)
3. Gemini로 업무 요약 생성 (LogiCraft 전용 프롬프트)
4. HRMS에 태스크 등록 (`createTask` / `updateTask`)
5. 감사 로그 기록

## 4. UI 구성

### 페이지 변경 (`src/app/(dashboard)/hrms/page.tsx`)

- 헤더 영역에 기존 "매핑 추가" 버튼 옆에 **"LogiCraft 매핑 추가"** 버튼 추가
- 매핑 카드 그리드를 **두 섹션으로 분리:** Repo 카드 / LogiCraft 카드
- 각 카드에 소스 타입을 시각적으로 구분하는 배지

### 신규 컴포넌트

| 컴포넌트 | 위치 | 역할 |
|----------|------|------|
| `LogicraftKeyForm` | `src/components/hrms/` | LogiCraft API key 입력/저장 |
| `LogicraftMappingModal` | `src/components/hrms/` | 매핑 생성 모달 — key 입력 → 프로젝트 목록 → HRMS 프로젝트 선택 → 등록 |
| `LogicraftMappingCard` | `src/components/hrms/` | LogiCraft 매핑 카드 — 프로젝트명, auto_register 배지, 최근 이력, 등록 버튼 |

### LogicraftMappingModal 흐름

1. LogiCraft API key가 미저장이면 → key 입력 필드 표시
2. key 검증 성공 → 접근 가능한 LogiCraft 프로젝트 리스트 표시
3. LogiCraft 프로젝트 선택 + HRMS 프로젝트 선택 + auto_register/cron 설정
4. 등록

### LogicraftMappingCard

- 기존 MappingCard와 동일한 액션: 전일 등록, 당일 등록, 날짜 선택, 편집, 삭제
- 카드 상단에 "LogiCraft" 배지로 repo 카드와 시각 구분

## 5. 스케줄러 통합

기존 `src/scheduler/hrms-scheduler.ts`를 확장하여 LogiCraft 자동 등록 로직 추가.

### 추가 함수

| 함수 | 역할 |
|------|------|
| `refreshLogicraftJob(mappingId)` | LogiCraft 매핑용 cron job 갱신/중지 |
| `executeLogicraftRegistration(mappingId)` | LogiCraft 활동 수집 → Gemini 요약 → HRMS 등록 |

### executeLogicraftRegistration 흐름

1. 어제 날짜 기준 중복 체크 (`hasSuccessLog`)
2. LogiCraft 클라이언트로 활동 수집 (주요 ITEM 타입별 `listItems` + `listProposals`)
3. `updated_at`으로 해당일 수정 건 필터링
4. Gemini에 전달하여 업무 요약 생성 (LogiCraft 전용 프롬프트)
5. HRMS `createTask`로 등록
6. 감사 로그 기록

### Job 키 충돌 방지

기존 repo job과 구분을 위해 prefix 부여: `repo-{id}` / `logi-{id}`

### startHrmsScheduler 변경

기존 repo 매핑 로드에 더해 LogiCraft 매핑도 함께 로드하여 cron job 등록.

## 파일 구조 (신규/변경)

```
src/
├── infra/
│   └── logicraft/
│       └── logicraft-client.ts          # 신규 — MCP JSON-RPC 클라이언트
│   └── db/
│       ├── schema.ts                    # 변경 — 3개 테이블 추가
│       └── logicraft.ts                 # 신규 — LogiCraft DB 접근 함수
├── app/
│   ├── (dashboard)/hrms/page.tsx        # 변경 — LogiCraft 섹션 추가
│   └── api/logicraft/
│       ├── verify/route.ts              # 신규
│       ├── key/route.ts                 # 신규
│       ├── mappings/
│       │   ├── route.ts                 # 신규
│       │   └── [id]/route.ts            # 신규
│       ├── register/route.ts            # 신규
│       └── tasks/route.ts              # 신규
├── components/hrms/
│   ├── logicraft-key-form.tsx           # 신규
│   ├── logicraft-mapping-modal.tsx      # 신규
│   └── logicraft-mapping-card.tsx       # 신규
├── scheduler/
│   └── hrms-scheduler.ts               # 변경 — LogiCraft job 추가
└── core/
    └── types.ts                         # 변경 — LogiCraft 관련 타입 추가
```
