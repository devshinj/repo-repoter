# Pixel Growth Tree Widget — Design Spec

**Date:** 2026-04-16
**Status:** Approved for implementation planning
**Location:** Dashboard (`src/app/(dashboard)/page.tsx`) — 히트맵 우측

## 1. Overview

대시보드 히트맵 우측에 사용자 개인의 Git 활동을 픽셀 아트 나무로 시각화하는 위젯을 추가한다. 나무는 커밋이 쌓이면 자라고, 꾸준함에 반딧불이가 붙고, 방치하면 시든다. 캐릭터가 매일 커밋 여부에 따라 물을 주거나 기다린다.

### Goals
- 대시보드 재방문 동기 부여
- 수치 기반 StatCard 옆에 감성적/게임적 요소 추가
- 숫자 대시보드와 독립적으로 정보 가치를 지닌 "한눈 상태" 뷰

### Non-Goals (YAGNI)
- 나무 커스터마이징 (종류/색 선택)
- 소셜·랭킹·타 유저 비교
- 스크린샷 공유
- 업적/뱃지 시스템

## 2. Indicator Mapping

| 지표 | 계산 방식 | 나무 속성 | 시각 표현 |
|-----|---------|---------|---------|
| 누적 커밋 수 (본인) | `commit_cache.author = repo.git_author` 총합 | 성장 단계 (7) | 0 / 1-10 / 11-30 / 31-100 / 101-300 / 301-700 / 701+ → 씨앗→떡잎→묘목→어린나무→중간나무→큰나무→거목 |
| 현재 streak | 오늘부터 거슬러 커밋 있는 연속 일수 (heatmap 기반) | 반딧불이 개수 | 0=없음, 3-6일=1, 7-13일=2, 14-29일=3, 30일+=4 |
| 등록 저장소 수 | `repositories.is_active=1` count | 열매 개수 & 색 | 저장소 1개당 열매 1개, 색은 primary_language 매핑 (상위 10개, created_at 최신순) |
| 오늘 커밋 여부 | `stats.todayCommits > 0` | 캐릭터 상태 | O=물 주는 루프, X=idle (물뿌리개 들고 기다림) |
| 무커밋 기간 | 오늘부터 가장 최근 커밋일까지 일수 | 잎 채도 & 낙엽 | 0-2일=정상, 3-6일=채도 -20%, 7일+=채도 -40% + 낙엽 1-2장. 커밋 1회로 즉시 회복 |
| 역대 최대 일일 커밋 (본인) | `commit_cache` GROUP BY date, MAX (author 필터) | 줄기 두께 | 1 / 2-4 / 5-9 / 10-19 / 20+ → 1~5px 오버레이 |

### 본인 커밋 기준
- `repositories.git_author`가 설정된 저장소의 `commit_cache.author == git_author` 커밋만 카운트
- `git_author` 미설정 저장소의 커밋은 제외 (자연스러운 필터 결과, 별도 안내 없음)

## 3. Data Flow

### 서버 변경
- `src/app/api/dashboard/stats/route.ts`: 응답 스키마에 2개 필드 추가
  - `totalCommits: number` — 본인 누적 커밋 수
  - `maxDailyCommits: number` — 역대 최대 일일 커밋 수
- 쿼리는 `repositories JOIN commit_cache ON repository_id, author = git_author` 기반
- 그 외 엔드포인트는 변경 없음

### 클라이언트 데이터 수집
1. 기존 `/api/dashboard/stats` — `todayCommits`, `totalCommits`, `maxDailyCommits`
2. 기존 `/api/repos` — 저장소 목록 + `primary_language`
3. 기존 `/api/commits/heatmap?months=6` — heatmap 데이터에서 `currentStreak`, `inactiveDays` 클라이언트 계산

## 4. Component Structure

```
src/components/growth-tree/
├── growth-tree.tsx              # 카드 컨테이너 (props → 레이아웃)
├── tree-canvas.tsx              # Canvas 렌더러 (rAF 루프, 순수 렌더)
├── sprites/
│   ├── tree-stages.ts           # 7단계 나무 스프라이트 (32×48 그리드)
│   ├── character.ts             # 캐릭터 2상태 × N프레임
│   ├── fruit.ts                 # 열매 단일 스프라이트 (색 런타임 주입)
│   ├── firefly.ts               # 반딧불이 (8×8)
│   ├── leaf-fallen.ts           # 낙엽
│   └── pot.ts                   # 빈 화분 (저장소 0개)
├── palette.ts                   # 색 상수 + desaturate 함수
└── hooks/
    ├── use-tree-metrics.ts      # heatmap → streak/inactiveDays 계산
    └── use-animation-frame.ts   # rAF 루프 훅 (delta time 제공)
```

### 경계 원칙
- `growth-tree.tsx` — 데이터 수집(props) + 레이아웃. Canvas 로직 없음.
- `tree-canvas.tsx` — 지표를 props로 받아 Canvas에 순수 렌더. fetch 없음.
- `sprites/*.ts` — 픽셀 색 배열 데이터(code-as-data). 로직 없음, 상수만 export.
- `hooks/use-tree-metrics.ts` — heatmap `Record<string, number>` → `{ streak, inactiveDays }` 계산. 순수 함수.

### 레이어 배치 근거
- 모두 `src/components/` 아래. streak/inactiveDays 계산은 도메인 로직이지만 heatmap 클라이언트 가공에만 쓰이는 사적 유틸이라 hooks/ 내부에 배치하는 편이 응집도가 높다.

### 기존 로직 통합
- [contribution-heatmap.tsx](src/components/data-display/contribution-heatmap.tsx) 내부의 `calcStreak`, `calcBusiestDay`, `formatDate` 유틸이 이미 heatmap 데이터 기반으로 작성되어 있다. 나무 위젯의 `calcStreak`은 동일한 로직이므로 중복 구현 대신 **내부 유틸을 `src/components/growth-tree/hooks/use-tree-metrics.ts`로 이동**하여 두 컴포넌트가 공유한다. heatmap 컴포넌트는 공유 유틸을 import하도록 수정한다.
- `calcBusiestDay`는 나무 위젯에서 사용하지 않지만 heatmap 자체에서 계속 필요하므로 함께 이동한다.
- 같은 기회에 `formatDate`도 공유 유틸로 옮긴다.

### 공유 타입 (`src/core/types.ts`에 추가)

```ts
export interface TreeMetrics {
  totalCommits: number;
  currentStreak: number;
  inactiveDays: number;
  todayCommitted: boolean;
  maxDailyCommits: number;
  repos: Array<{ id: number; language: string | null }>;
}
```

## 5. Layout

히트맵 카드와 나란히 배치한다.

```tsx
<div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-4 mb-6">
  <ContributionHeatmap data={heatmapData} months={6} />
  <GrowthTree metrics={treeMetrics} />
</div>
```

- 카드 크기: 280×260px (고정 폭, 높이는 Canvas + 헤더에 맞춰)
- 모바일(`md` 미만): 세로 스택 (grid-cols-1)
- 히트맵 폭은 줄어들지만 6개월 기준이라 충분히 표시 가능

## 6. Rendering

### Canvas 스펙
- 내부 그리드: 120×140 픽셀 기준
- Canvas 실제 크기: 240×280px (2배 확대)
- `ctx.imageSmoothingEnabled = false` — 픽셀 선명도 유지
- devicePixelRatio 대응 (고DPI 화면 선명)

### 스프라이트 정의

각 스프라이트는 2D 배열. 값은 팔레트 인덱스. `0`은 투명.

```ts
export const stage3_sapling = {
  width: 16,
  height: 24,
  pixels: [
    [0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,2,2,3,2,0,0,0,0,0,0,0],
    // ...
  ],
};

export const palette = {
  0: "transparent",
  1: "#6b3f1d",  // 줄기 진한
  2: "#9d6b3d",  // 줄기 연한
  3: "#3a7d2b",  // 잎 진한
  4: "#5fa347",  // 잎 중간
  5: "#8fc76e",  // 잎 연한
};
```

### 렌더 파이프라인 (매 프레임, ~60fps)

1. 배경 클리어
2. **나무** — `totalCommits` → stage 스프라이트. 시듦 상태면 잎 팔레트를 `desaturate()`로 변환. 바람 흔들림: `x += Math.sin(t / 1000)`
3. **줄기 두께 오버레이** — `maxDailyCommits` 레벨에 따라 stage 줄기 픽셀 위치에 추가 픽셀
4. **열매** — 나무 가지 위 고정 슬롯 좌표 배열 중 `repos.length`개에 열매 스프라이트. 색상은 `languageColor(repo.language)` 주입 (기존 [language-badge.tsx](src/components/data-display/language-badge.tsx) 색 규칙 재사용)
5. **반딧불이** — `currentStreak` 임계값별 개수. sin/cos 궤도 이동 + 알파 깜빡임
6. **낙엽** — `inactiveDays >= 7`이면 화분 아래 정적 1-2장 + 떨어지는 루프 1장
7. **캐릭터** — 나무 옆 고정 좌표. `todayCommitted` O면 물주기 프레임 시퀀스 (예: 4프레임 × 200ms), X면 idle 시퀀스
8. **화분** — 항상 바닥에

### 애니메이션 톤 (중간 단계)
- 나무 전체 미세한 좌우 흔들림 (바람, 3-4초 주기)
- 나뭇잎 2-3장이 각각 다른 주기로 팔랑임
- 캐릭터 idle 숨쉬기 (1-2px 위아래)
- 반딧불이 느린 궤도 + 깜빡임
- 시든 상태일 때 낙엽 천천히 낙하 루프
- 열매/배경 파티클 등은 추가하지 않음 (과하면 주의 분산)

### 프레임 관리
- `use-animation-frame.ts`가 rAF 루프를 돌리고 delta time을 `tree-canvas`의 render 함수로 전달
- 탭 비활성 시 브라우저가 rAF 자동 일시정지 (별도 처리 불필요)

### 색 변환 (시듦 구현)
- `palette.ts`의 `desaturate(hex, percent)` 유틸이 잎 팔레트 인덱스에만 HSL 변환 적용
- 잎 인덱스(3/4/5 등)는 팔레트 메타데이터에 "leaf" 플래그로 표시

## 7. Edge Cases

| 케이스 | 처리 |
|-------|-----|
| 저장소 0개 | 빈 갈색 화분 + 중앙에 "저장소를 등록하고 나무를 키워보세요" 텍스트 + 작은 화살표. 캐릭터는 idle로 상시 표시 |
| 초기 로딩 | `bg-muted animate-pulse` 스켈레톤 1개 (기존 대시보드 패턴과 동일) |
| `git_author` 미설정 저장소 | 해당 저장소 커밋은 누적/최대에서 자동 제외. 별도 안내 없음 |
| 저장소 모두 삭제됨 (누적 커밋 > 0) | 저장소 0개 우선 → 빈 화분 상태 (열매 열릴 곳 없음) |
| heatmap과 stats 불일치 (일시적) | todayCommitted는 stats 기반 우선. streak/inactiveDays는 heatmap 기반. 다음 폴링 사이클에서 해소 |
| Canvas 미지원 브라우저 | 무시 (내부 팀 서비스, 최신 브라우저 가정) |
| 언어 매핑에 없는 언어 | `languageColor()` fallback 회색 (기존 language-badge 규칙 재사용) |
| 저장소 11개 이상 | created_at 최신순 상위 10개 표시. 11번째부터 미표시 (+N 뱃지 없음) |
| 스케줄러 에러로 데이터 stale | 나무는 DB 데이터만 본다. 스케줄러 상태는 기존 헤더 표시기가 담당 |

## 8. Testing Strategy

### 단위 테스트 (Vitest)

`src/__tests__/components/growth-tree/`:
- **use-tree-metrics.test.ts**
  - `calcStreak(heatmap, today)`: 오늘 포함/미포함, 주말 공백, 전체 공백, 단일 날짜
  - `calcInactiveDays(heatmap, today)`: 0일, 2일, 7일, 30일+, 빈 데이터
  - `stageFromCommits(n)`: 각 경계값 (0, 1, 10, 11, 30, 31, 100, 101, 300, 301, 700, 701)
  - `thicknessFromMax(n)`: 각 경계값
- **palette.test.ts**
  - `desaturate(hex, 0)` → 원본 유지
  - `desaturate(hex, 0.2)`, `desaturate(hex, 0.4)` → 채도만 감소, 명도 유지

### infra 테스트
- 새 stats 쿼리 단위 테스트는 생략 (infra 규칙: API 호출 자체 테스트 안 함, 변환 로직 없음)

### 수동 E2E (로컬 dev 서버)
1. 신규 유저 (저장소 0개) → 빈 화분 + CTA
2. 저장소 1개 + 커밋 0 → 씨앗, 열매 없음
3. 저장소 3개 + 누적 50 + streak 5 + today O → 묘목 + 반딧불이 1마리 + 열매 3개 + 물주는 캐릭터
4. 저장소 2개 + 누적 500 + streak 0 + 무커밋 10일 → 큰나무 시듦 + 낙엽 + idle 캐릭터
5. 다크모드 전환 시 팔레트 자연스러움

### 도입하지 않음
- Canvas 시각 회귀 테스트 (YAGNI, 팀 프로토타입 단계)

### 구조 테스트
- 기존 레이어 의존 규칙 테스트가 growth-tree 경로도 자동 검사

## 9. References

- `src/app/(dashboard)/page.tsx` — 위젯이 들어갈 대시보드
- `src/components/data-display/contribution-heatmap.tsx` — 나란히 배치될 기존 위젯
- `src/components/data-display/language-badge.tsx` — 언어별 색상 매핑 재사용
- `src/infra/db/schema.ts` — `commit_cache.author`, `repositories.git_author` 필드 활용
