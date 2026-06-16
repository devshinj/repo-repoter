# 관리자 페이지 설계

## 개요

AutoBriify 서비스의 관리자 전용 페이지. 사용자 관리와 시스템 모니터링 기능을 제공한다.
기존 대시보드와 완전히 분리된 독립 라우트(`/admin`)로, 환경변수 암호 인증을 통해 진입한다.

## 인증

### 진입 방식
- **경로**: `/admin` (독립 라우트 — `(dashboard)` 그룹 밖)
- **인증**: 환경변수 `ADMIN_PASSWORD`에 설정된 암호 입력
- **세션 유지**: 브라우저 세션 동안 유지 (탭 닫으면 만료)
  - 서버에서 암호 검증 후 세션 토큰 발급 → 쿠키(sessionStorage 또는 httpOnly 쿠키) 저장
  - 관리자 API 요청 시 토큰 검증
- **기존 인증과 독립**: NextAuth 세션과 무관하게 동작

### 인증 흐름
1. 사용자가 `/admin` 접근
2. 세션 토큰이 없거나 유효하지 않으면 → 암호 입력 폼 표시
3. 암호 입력 → `POST /api/admin/auth` → `ADMIN_PASSWORD`와 비교
4. 일치하면 세션 토큰 발급 → 관리자 화면 표시
5. 불일치하면 에러 메시지 표시

## 페이지 구조

### 레이아웃
- 독립 layout.tsx (`src/app/admin/layout.tsx`)
- 상단 네비게이션 바: "AutoBriify Admin" 로고 + 탭 메뉴 + 로그아웃 버튼
- 기존 대시보드 사이드바 없음

### 탭 구성 (4개)

| 탭 | 경로 | 설명 |
|----|------|------|
| 사용자 관리 | `/admin` (기본) | 사용자 목록, 비활성화, 삭제 |
| 스케줄러 | `/admin/scheduler` | 크론 상태, 저장소별 자동화 토글 |
| 동기화 로그 | `/admin/sync-logs` | 동기화 이력 조회 |
| HRMS 로그 | `/admin/hrms-logs` | HRMS 업무 등록 이력 조회 |

## 기능 상세

### 1. 사용자 관리 (`/admin`)

**통계 카드**
- 전체 사용자 수
- 활성 사용자 수
- 비활성 사용자 수

**사용자 테이블**

| 컬럼 | 소스 |
|------|------|
| 이름 | `users.name` |
| 이메일 | `users.email` |
| 로그인 방식 | `users.provider` (HRMS / Credentials 배지) |
| 저장소 수 | `repositories` COUNT by `user_id` |
| 가입일 | `users.created_at` |
| 상태 | `users.is_active` (활성/비활성 배지) |
| 작업 | 비활성화/활성화 토글, 삭제 버튼 |

**액션**
- **비활성화/활성화**: `users.is_active` 토글 — 비활성화된 사용자는 로그인 불가, 스케줄러에서 제외
- **삭제**: 사용자 및 관련 데이터(저장소, 보고서, 동기화 로그, 커밋 캐시, HRMS 설정 등) 전체 삭제. 확인 다이얼로그 필수

**DB 변경 필요**
- `users` 테이블에 `is_active` 컬럼 추가 (INTEGER DEFAULT 1)

### 2. 스케줄러 (`/admin/scheduler`)

**스케줄러 상태 카드**
- 크론 스케줄러 동작 여부 (Running / Stopped)
- 마지막 실행 시각
- 다음 실행 예정 시각

**저장소별 스케줄링 관리 테이블**

| 컬럼 | 소스 |
|------|------|
| 사용자 | `users.name`, `users.email` |
| 저장소 | `repositories.repo`, branch, `polling_interval_min` |
| 마지막 동기화 | `repositories.last_synced_sha` 기반 최근 sync_logs |
| 동기화 상태 | 최근 `sync_logs.status` |
| 동기화 토글 | `repositories.is_active` |
| HRMS 자동 등록 토글 | `hrms_project_mappings.auto_register` |
| LogiCraft 자동 등록 토글 | `hrms_logicraft_mappings.auto_register` |
| 보고서 자동 생성 토글 | `repositories.auto_report_enabled` |

**토글 색상 구분**
- 파란색: 동기화
- 보라색: HRMS 자동 등록 (활성 시 cron_time 표시)
- 핑크색: LogiCraft 자동 등록 (활성 시 cron_time 표시)
- 노란색: 보고서 자동 생성

**액션**
- 각 토글 클릭 시 해당 설정 즉시 변경 (PATCH API)

**실제 데이터 반영 원칙**
- 관리자의 토글 변경은 각 사용자의 실제 DB 레코드를 직접 수정한다.
  - 동기화 토글 → `repositories.is_active` 변경 → 사용자 대시보드의 저장소 상태에 즉시 반영
  - HRMS 자동 등록 토글 → `hrms_project_mappings.auto_register` 변경 → 사용자의 HRMS 연동 페이지에 반영
  - LogiCraft 자동 등록 토글 → `hrms_logicraft_mappings.auto_register` 변경 → 사용자의 LogiCraft 매핑에 반영
  - 보고서 자동 생성 토글 → `repositories.auto_report_enabled` 변경 → 사용자의 저장소 설정에 반영
- 즉, 관리자 전용 복사본이 아니라 원본 데이터를 수정하므로, 사용자가 자신의 대시보드에서 변경된 상태를 즉시 확인할 수 있다.
- 사용자 비활성화(`users.is_active = 0`) 시에도 해당 사용자의 모든 자동화가 스케줄러에서 건너뛰어진다.

### 3. 동기화 로그 (`/admin/sync-logs`)

**필터**
- 사용자 (전체 / 특정 사용자)
- 저장소 (전체 / 특정 저장소)
- 상태 (전체 / success / error)

**로그 테이블**

| 컬럼 | 소스 |
|------|------|
| 시각 | `sync_logs.completed_at` |
| 저장소 | `repositories.repo` (JOIN) |
| 사용자 | `users.name` (JOIN) |
| 상태 | `sync_logs.status` |
| 커밋 수 | `sync_logs.commits_processed` |
| 태스크 생성 | `sync_logs.tasks_created` |
| 에러 | `sync_logs.error_message` |

### 4. HRMS 로그 (`/admin/hrms-logs`)

**통계 카드**
- 오늘 등록 시도 건수
- 성공 건수
- 실패 건수
- 건너뜀(skipped) 건수

**필터**
- 사용자 (전체 / 특정 사용자)
- HRMS 프로젝트 (전체 / 특정 프로젝트)
- 상태 (전체 / success / error / skipped)
- 날짜

**로그 테이블**

| 컬럼 | 소스 |
|------|------|
| 시각 | `hrms_task_logs.created_at` |
| 사용자 | `users.name` (JOIN via mapping) |
| HRMS 프로젝트 | `hrms_project_mappings.hrms_project_name` |
| 대상일 | `hrms_task_logs.target_date` |
| 업무 제목 | `hrms_task_logs.title` |
| 상태 | `hrms_task_logs.status` |
| 에러 | `hrms_task_logs.error_message` |

## API 엔드포인트

### 인증
| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/admin/auth` | 관리자 암호 검증, 세션 토큰 발급 |

### 사용자 관리
| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/admin/users` | 전체 사용자 목록 + 통계 |
| PATCH | `/api/admin/users/[id]` | 사용자 활성화/비활성화 |
| DELETE | `/api/admin/users/[id]` | 사용자 삭제 (cascade) |

### 스케줄러
| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/admin/scheduler` | 스케줄러 상태 + 전체 저장소 자동화 현황 |
| PATCH | `/api/admin/scheduler/repos/[id]` | 저장소 동기화 활성화/비활성화 |
| PATCH | `/api/admin/scheduler/hrms-mappings/[id]` | HRMS 자동 등록 토글 |
| PATCH | `/api/admin/scheduler/logicraft-mappings/[id]` | LogiCraft 자동 등록 토글 |
| PATCH | `/api/admin/scheduler/repos/[id]/auto-report` | 보고서 자동 생성 토글 |

### 로그
| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/admin/sync-logs` | 동기화 로그 (필터 쿼리 파라미터) |
| GET | `/api/admin/hrms-logs` | HRMS 등록 로그 (필터 쿼리 파라미터) |

## 파일 구조

```
src/app/admin/
├── layout.tsx              # 관리자 독립 레이아웃 (탑 네비게이션)
├── page.tsx                # 사용자 관리 (기본 탭)
├── scheduler/
│   └── page.tsx            # 스케줄러 관리
├── sync-logs/
│   └── page.tsx            # 동기화 로그
└── hrms-logs/
    └── page.tsx            # HRMS 로그

src/app/api/admin/
├── auth/
│   └── route.ts            # 관리자 인증
├── users/
│   ├── route.ts            # GET 사용자 목록
│   └── [id]/
│       └── route.ts        # PATCH 비활성화, DELETE 삭제
├── scheduler/
│   ├── route.ts            # GET 스케줄러 전체 현황
│   ├── repos/
│   │   └── [id]/
│   │       ├── route.ts    # PATCH 동기화 토글
│   │       └── auto-report/
│   │           └── route.ts # PATCH 보고서 토글
│   ├── hrms-mappings/
│   │   └── [id]/
│   │       └── route.ts    # PATCH HRMS 자동 등록 토글
│   └── logicraft-mappings/
│       └── [id]/
│           └── route.ts    # PATCH LogiCraft 자동 등록 토글
├── sync-logs/
│   └── route.ts            # GET 동기화 로그
└── hrms-logs/
    └── route.ts            # GET HRMS 로그

src/components/admin/
├── admin-nav.tsx           # 상단 네비게이션 바
├── admin-auth-gate.tsx     # 암호 입력 폼 + 세션 검증
├── user-table.tsx          # 사용자 목록 테이블
├── scheduler-table.tsx     # 스케줄러 관리 테이블
├── sync-log-table.tsx      # 동기화 로그 테이블
└── hrms-log-table.tsx      # HRMS 로그 테이블
```

## DB 변경

### users 테이블
```sql
ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
```

비활성화된 사용자(`is_active = 0`)는:
- 로그인 시도 시 거부 (auth.ts signIn 콜백에서 체크)
- 스케줄러에서 해당 사용자의 저장소 동기화 건너뜀

## 환경변수

```
ADMIN_PASSWORD    # 관리자 진입 암호 (필수)
```

## 목업 참조

브라우저 목업 파일: `.superpowers/brainstorm/1779-1781576630/content/admin-layout-v3.html`
