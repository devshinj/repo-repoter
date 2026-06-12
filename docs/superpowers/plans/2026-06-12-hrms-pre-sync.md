# HRMS 업무 등록 전 자동 동기화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HRMS 업무 등록 API 호출 시 매핑된 저장소를 자동 동기화하여 커밋 누락을 방지하고, 클라이언트에 단계별 프로그레스를 표시한다.

**Architecture:** `POST /api/hrms/register`의 커밋 조회 직전에 `syncOneRepo()`를 호출하는 동기화 단계를 삽입한다. 클라이언트는 저장소 수를 기반으로 시간 시뮬레이션 프로그레스를 표시한다.

**Tech Stack:** Next.js API Route, syncOneRepo (polling-manager), React state 기반 프로그레스

---

## File Structure

| 파일 | 역할 | 변경 |
|------|------|------|
| `src/app/api/hrms/register/route.ts` | 업무 등록 API | 동기화 단계 삽입, 응답에 syncResults 추가 |
| `src/components/hrms/mapping-card.tsx` | 매핑 카드 UI | 프로그레스 상태 표시 추가 |

---

### Task 1: 서버 — register API에 동기화 단계 삽입

**Files:**
- Modify: `src/app/api/hrms/register/route.ts:1-214`

- [ ] **Step 1: syncOneRepo import 추가**

`src/app/api/hrms/register/route.ts` 상단에 import를 추가한다:

```typescript
import { syncOneRepo } from "@/scheduler/polling-manager";
```

기존 import 블록 (`import { getDb } from "@/infra/db/connection";` 아래)에 추가한다.

- [ ] **Step 2: 동기화 로직 삽입**

`src/app/api/hrms/register/route.ts`에서 중복 체크 블록 (`if (hasSuccessLog(...)`) 이후, 커밋 조회 (`const repoIds = mapping.repos.map(...)`) 이전에 동기화 단계를 삽입한다.

기존 코드:

```typescript
  const repoIds = mapping.repos.map((r: any) => r.id);
  const cacheCommits = getCommitsByDateRange(db, repoIds, date, date) as any[];
```

변경 후:

```typescript
  // 등록 전 자동 동기화: 매핑된 저장소를 순차 동기화
  const syncResults: { repo: string; commitsProcessed: number }[] = [];
  for (const repo of mapping.repos) {
    const repoLabel = repo.label || `${repo.owner}/${repo.repo}`;
    try {
      const result = await syncOneRepo(db, session.user.id, repo);
      if (result === null) {
        return NextResponse.json(
          { error: `동기화 실패: ${repoLabel}이(가) 이미 동기화 중입니다. 잠시 후 다시 시도해주세요.`, failedRepo: repoLabel },
          { status: 409 },
        );
      }
      syncResults.push({ repo: repoLabel, commitsProcessed: result.commitsProcessed });
    } catch (err: any) {
      return NextResponse.json(
        { error: `동기화 실패: ${repoLabel}`, failedRepo: repoLabel, detail: err.message },
        { status: 500 },
      );
    }
  }

  const repoIds = mapping.repos.map((r: any) => r.id);
  const cacheCommits = getCommitsByDateRange(db, repoIds, date, date) as any[];
```

- [ ] **Step 3: 성공 응답에 syncResults 추가**

기존 성공 응답(약 195~201줄)에 `syncResults`를 추가한다.

기존:

```typescript
    return NextResponse.json({
      message: action === "updated" ? "Task updated" : "Task registered",
      hrmsTaskId,
      title,
      estimatedMinutes,
      action,
    }, { status: 201 });
```

변경:

```typescript
    return NextResponse.json({
      message: action === "updated" ? "Task updated" : "Task registered",
      hrmsTaskId,
      title,
      estimatedMinutes,
      action,
      syncResults,
    }, { status: 201 });
```

- [ ] **Step 4: 수동 테스트**

dev 서버에서 HRMS 업무 등록을 실행하여 동기화가 먼저 수행되는지 확인한다. 브라우저 개발자 도구 Network 탭에서 응답에 `syncResults`가 포함되는지 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/hrms/register/route.ts
git commit -m "feat: HRMS 업무 등록 전 자동 동기화 단계 추가"
```

---

### Task 2: 클라이언트 — 매핑 카드에 단계별 프로그레스 표시

**Files:**
- Modify: `src/components/hrms/mapping-card.tsx:68-101`

- [ ] **Step 1: 프로그레스 상태 타입과 state 추가**

`src/components/hrms/mapping-card.tsx`의 `MappingCard` 컴포넌트 내부, 기존 state 선언부(`const [registering, setRegistering] = useState(false);`) 주변에 추가한다:

```typescript
  const [progressStep, setProgressStep] = useState<string | null>(null);
```

- [ ] **Step 2: handleRegister에 시뮬레이션 로직 추가**

기존 `handleRegister` 함수:

```typescript
  async function handleRegister(targetDate?: string) {
    setRegistering(true);
    try {
      await onRegister(mapping.id, targetDate);
    } finally {
      setRegistering(false);
      setShowDatePicker(false);
    }
  }
```

변경:

```typescript
  async function handleRegister(targetDate?: string) {
    setRegistering(true);
    const repoCount = mapping.repos?.length ?? 1;

    // 시뮬레이션 프로그레스: 동기화 → 생성 → 등록
    const steps: string[] = [];
    for (let i = 1; i <= repoCount; i++) {
      steps.push(`저장소 동기화 중... (${i}/${repoCount})`);
    }
    steps.push("업무 내용 생성 중...");
    steps.push("HRMS 등록 중...");

    let stepIndex = 0;
    setProgressStep(steps[0]);
    const interval = setInterval(() => {
      stepIndex++;
      if (stepIndex < steps.length) {
        setProgressStep(steps[stepIndex]);
      }
    }, 2000);

    try {
      await onRegister(mapping.id, targetDate);
      setProgressStep(null);
    } catch {
      setProgressStep(null);
    } finally {
      clearInterval(interval);
      setRegistering(false);
      setShowDatePicker(false);
    }
  }
```

- [ ] **Step 3: 프로그레스 UI 렌더링 추가**

`src/components/hrms/mapping-card.tsx`에서 업무 등록 버튼 영역(`<div className="pt-3 border-t ...">`) 바로 위에, `registering && progressStep`일 때 프로그레스를 표시한다.

기존 코드:

```tsx
        {/* 업무 등록 버튼 */}
        <div className="pt-3 border-t border-black/5 dark:border-white/5 space-y-2.5">
```

변경:

```tsx
        {/* 프로그레스 표시 */}
        {registering && progressStep && (
          <div className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" />
            <span>{progressStep}</span>
          </div>
        )}

        {/* 업무 등록 버튼 */}
        <div className="pt-3 border-t border-black/5 dark:border-white/5 space-y-2.5">
```

- [ ] **Step 4: 수동 테스트**

브라우저에서 HRMS 업무 등록 버튼을 클릭하여:
1. 프로그레스가 "저장소 동기화 중... (1/N)" → "업무 내용 생성 중..." → "HRMS 등록 중..." 순서로 표시되는지 확인
2. 등록 완료 후 프로그레스가 사라지는지 확인
3. 에러 발생 시 프로그레스가 사라지고 toast 에러가 표시되는지 확인

- [ ] **Step 5: 커밋**

```bash
git add src/components/hrms/mapping-card.tsx
git commit -m "feat: HRMS 업무 등록 시 단계별 프로그레스 표시 추가"
```
