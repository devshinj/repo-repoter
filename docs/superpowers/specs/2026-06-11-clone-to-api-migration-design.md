# Clone → API 전환 마이그레이션 설계

## 개요

저장소 로컬 클론(`git clone --bare`)을 완전 제거하고, Git 호스팅 프로바이더 REST API로 교체한다. 디스크 낭비, 클론 실패, 상태 관리 복잡도 등 현행 구조의 문제를 해결하고, commit_cache를 유일한 커밋 데이터 소스로 승격한다.

## 배경

현행 구조는 저장소 등록 시 `git clone --bare`로 전체 저장소를 로컬에 복제한다:

- 디스크 낭비: 큰 저장소는 수백 MB~GB
- 사용자별 중복 클론
- 클론 실패 빈번 (Gitea HTTP 405 등)
- clone_status 상태 관리 복잡도

서비스 목적은 커밋 기록 기반 업무 보고이므로 전체 git 오브젝트가 불필요하다. API로 커밋 메타데이터와 상세 정보만 조회하면 충분하다.

## 아키텍처 변경

### 변경 전

```
저장소 등록 → git clone --bare → 로컬 디스크
동기화      → git fetch → git log → commit_cache
보고서      → git log --numstat → Gemini
```

### 변경 후

```
저장소 등록 → API로 최근 6개월 커밋 조회 → commit_cache (상세 정보 포함)
동기화      → API로 증분 커밋 조회 → commit_cache
보고서      → commit_cache에서 직접 조회 → Gemini
```

### 레이어 변경 요약

| 레이어 | 변경 내용 |
|--------|-----------|
| `infra/git/` | `git-client.ts` 삭제, `parse-git-url.ts`에서 `buildAuthEnv()` 삭제 |
| `infra/github/` | `github-client.ts` 삭제 — git-provider로 통합 |
| `infra/git-provider/` | `GitProviderClient` 인터페이스 추가, 각 프로바이더에 커밋/브랜치/diff 조회 구현 |
| `infra/db/` | commit_cache에 `additions`, `deletions`, `files_changed` 컬럼 추가. `clone_path`/`clone_status` 제거 → `sync_status` 교체 |
| `scheduler/` | polling-manager, report-generator를 API/DB 기반으로 재작성 |
| `app/api/repos/` | 등록/삭제/동기화에서 clone 로직 제거 |
| `core/types.ts` | Repository 타입에서 `clonePath`/`cloneStatus` 제거, `syncStatus` 추가 |

## GitProviderClient 인터페이스

### 공통 타입

```typescript
// infra/git-provider/types.ts

interface ApiCommit {
  sha: string;
  message: string;
  author: string;
  date: string;           // ISO 8601
  additions: number;
  deletions: number;
  filesChanged: string[];
}

interface ApiBranch {
  name: string;
  isDefault: boolean;
}

interface GitProviderClient {
  listRepos(): Promise<RemoteRepository[]>;
  listBranches(owner: string, repo: string): Promise<ApiBranch[]>;
  listCommits(owner: string, repo: string, options: {
    branch?: string;
    since?: string;   // ISO 8601
    author?: string;
    perPage?: number;
    page?: number;
  }): Promise<ApiCommit[]>;
  getCommitDetail(owner: string, repo: string, sha: string): Promise<ApiCommit>;
  getCommitDiff(owner: string, repo: string, sha: string): Promise<string>;
  getRepoLanguage(owner: string, repo: string): Promise<string | null>;
}
```

### 프로바이더별 구현

| 프로바이더 | 파일 | 인증 | 커밋 상세 API |
|-----------|------|------|--------------|
| GitHub | `github-api.ts` | Octokit(`auth: token`) | `GET /repos/{owner}/{repo}/commits/{sha}` — files 배열 |
| Gitea | `gitea-api.ts` | `Authorization: token {token}` | `GET /repos/{owner}/{repo}/git/commits/{sha}` — stats 필드 |
| GitLab | `gitlab-api.ts` | `PRIVATE-TOKEN: {token}` | `GET /projects/{id}/repository/commits/{sha}/diff` |
| Bitbucket | `bitbucket-api.ts` | `Authorization: Basic {token}` | `GET /repositories/{owner}/{repo}/diffstat/{sha}` |

### 팩토리

```typescript
// infra/git-provider/index.ts
function createGitProvider(meta: GitProviderMeta, token: string): GitProviderClient
```

credential의 `metadata.type`으로 프로바이더를 판별하여 적절한 구현체를 반환한다.

## DB 스키마 변경

### commit_cache — 컬럼 추가

```sql
additions INTEGER NOT NULL DEFAULT 0,
deletions INTEGER NOT NULL DEFAULT 0,
files_changed TEXT  -- JSON 배열 문자열, e.g. '["src/foo.ts","src/bar.ts"]'
```

`files_changed`는 TEXT로 JSON 배열을 저장한다. 보고서 생성 시 한번에 읽어 Gemini에 넘기는 용도이므로 JSON 문자열로 충분하다.

### repositories — 컬럼 변경

```
제거: clone_path, clone_status
추가: sync_status TEXT NOT NULL DEFAULT 'pending'
      -- 'pending' | 'syncing' | 'ready' | 'error'
```

### 마이그레이션 전략

실 배포 전이므로 마이그레이션 코드 불필요. `createTables()`의 DDL을 직접 수정하고, 기존 DB 파일 삭제 후 재생성한다. `migrateSchema()`에서 clone 관련 마이그레이션 코드도 정리한다.

## 저장소 등록 흐름

### POST /api/repos

```
1. URL 파싱 (parseGitUrl) → owner, repo 추출
2. DB에 저장소 레코드 삽입 (sync_status: 'pending')
3. 즉시 201 응답 반환
4. 백그라운드 초기 동기화:
   a. sync_status → 'syncing'
   b. credential의 metadata로 프로바이더 판별
   c. createGitProvider(meta, token)
   d. listBranches() → 브랜치 목록 조회
   e. listCommits(branch, since: 6개월 전) → 페이지네이션으로 전체 수집
   f. 각 커밋 getCommitDetail() → additions/deletions/filesChanged (5개씩 병렬)
   g. commit_cache에 일괄 저장
   h. getRepoLanguage() → primary_language 저장
   i. sync_status → 'ready'
   j. 실패 시 sync_status → 'error'
```

### 커밋 상세 조회 최적화

6개월치 커밋이 수백 개일 수 있으므로 `listCommits()`에서 기본 정보를 먼저 받고, `getCommitDetail()`은 5개씩 병렬 실행하여 additions/deletions/filesChanged를 채운다. GitHub rate limit 5000/hour 내에서 충분하다.

### DELETE /api/repos

clone 디렉토리 삭제 로직 제거. DB 레코드 삭제만 수행 (CASCADE로 commit_cache도 정리).

## 증분 동기화

### polling-manager

```
1. 활성 사용자별 저장소 순회
2. credential + metadata로 프로바이더 클라이언트 생성
3. commit_cache에서 해당 저장소의 최신 committed_at 조회
4. listCommits(branch, since: 최신 committed_at) → 새 커밋만 조회
5. 새 커밋마다 getCommitDetail() → additions/deletions/filesChanged
6. commit_cache에 INSERT OR IGNORE
7. 모호한 커밋 보강: getCommitDiff() → Gemini 분석
8. 그룹핑 + Gemini 태스크 분석
9. sync_log 기록
```

### report-generator

`collectCommitsForDate()`를 commit_cache DB 조회로 교체한다.

```
변경 전: collectCommitsForDate(clonePath, cloneUrl, date) → git log --numstat
변경 후: collectCommitsForDate(repositoryId, date) → SELECT from commit_cache
```

commit_cache에 additions/deletions/files_changed가 저장되어 있으므로 보고서 생성 시 API 호출 없이 DB 조회만으로 완결된다.

### 수동 동기화 (POST /api/repos/[id]/sync)

polling-manager와 동일한 로직을 API 라우트에서 호출한다. clone/pull 대신 프로바이더 API 사용.

## API 라우트 변경

### 교체되는 라우트

| 라우트 | 변경 전 | 변경 후 |
|--------|--------|--------|
| `repos/[id]/branches` | `getBranches(clonePath)` | 프로바이더 `listBranches()` API 호출. commit_cache에는 커밋이 있는 브랜치만 있으므로 정확한 브랜치 목록은 API에서 조회 |
| `repos/[id]/commits` | `getRecentCommits(clonePath)` | commit_cache 조회 |
| `repos/[id]/sync` | `pullRepository(clonePath)` → git log | 프로바이더 API 증분 조회 |
| `reports/generate` | `collectCommitsForDate(clonePath)` | commit_cache 조회 |

## 삭제 대상

### 파일 삭제

| 파일 | 이유 |
|------|------|
| `src/infra/git/git-client.ts` | git CLI 의존 완전 제거 |
| `src/infra/github/github-client.ts` | git-provider로 통합 |

### 부분 삭제

| 파일 | 삭제 내용 |
|------|-----------|
| `src/infra/git/parse-git-url.ts` | `buildAuthEnv()` 삭제. `parseGitUrl()`은 유지 |
| `src/infra/db/schema.ts` | `createTables()`에서 `clone_path`, `clone_status` 컬럼 제거. `migrateSchema()`에서 clone 관련 코드 정리 |
| `src/infra/db/repository.ts` | `updateCloneStatus()` 등 clone 관련 함수 |
| `src/app/api/repos/route.ts` | POST: clone 로직, DELETE: `rm(clone_path)` |
| `src/core/types.ts` | Repository의 `clonePath`, `cloneStatus` |

## 테스트

| 대상 | 테스트 방법 |
|------|------------|
| GitProviderClient 구현 | 각 프로바이더 normalize/파싱 함수 단위 테스트 |
| commit_cache 확장 | DB 함수 단위 테스트 (additions/deletions/files_changed 포함) |
| report-generator | commit_cache 기반 collectCommitsForDate 단위 테스트 |
| E2E | 저장소 등록 → 동기화 → 캘린더 확인 → 보고서 생성 수동 테스트 |

## 초기 동기화 범위

최근 6개월. 서비스 목적이 일일 업무 기록이므로 충분하다. 이후 증분 동기화로 계속 쌓인다.

## 기존 저장소 마이그레이션

실 배포 전이므로 마이그레이션 없음. DB 삭제 후 재생성, 저장소 재등록.
