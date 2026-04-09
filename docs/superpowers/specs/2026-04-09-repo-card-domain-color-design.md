# Repo Card Domain Color Design

## Overview

저장소 관리 페이지에서 Git URL 기반으로 저장소 카드에 도메인별 색상을 자동 부여한다. 같은 host+owner의 저장소는 같은 색조(hue), 같은 owner 내 다른 repo는 채도/명도로 구분한다.

## 색상 생성 알고리즘

### 1차 분류: host+owner → hue

`clone_url`에서 `host/owner` 문자열을 추출하고, 결정론적 해시 함수로 HSL hue(0~360)를 결정한다.

```
"https://github.com/my-company/web-app.git"
→ group key: "github.com/my-company"
→ hash → hue: 217
```

### 2차 분류: repo → saturation/lightness 변주

같은 owner 내에서 `repo` 이름을 해시하여 saturation과 lightness를 범위 내에서 변주한다.

- saturation: 40% ~ 70%
- lightness (light mode): 40% ~ 60%
- lightness (dark mode): 55% ~ 75%

```
"web-app" → saturation: 55%, lightness: 48%
"api-server" → saturation: 62%, lightness: 52%
```

### 해시 함수

간단한 문자열 해시 (djb2 등) 사용. 동일 입력에 항상 같은 결과를 보장한다.

## 적용 위치

`src/app/(dashboard)/repos/page.tsx`의 저장소 카드에 적용:

1. **아이콘 배경색**: 현재 `bg-primary/10` → `hsl(hue, sat%, light%/0.1)` 로 교체
2. **아이콘 색상**: 현재 `text-primary` → 도메인 색상으로 교체
3. **카드 좌측 바**: `border-left: 3px solid hsl(hue, sat%, light%)` 추가로 그룹핑 시각화

## 유틸 함수

`getRepoColor(cloneUrl: string)` 함수 하나를 `repos/page.tsx` 파일 내에 정의한다.

```ts
function getRepoColor(cloneUrl: string): { hue: number; saturation: number; lightness: number }
```

- `clone_url`을 파싱하여 host, owner, repo를 추출
- host+owner 해시 → hue
- repo 해시 → saturation, lightness 범위 내 값

## 다크모드 대응

Tailwind의 `dark:` prefix로 lightness를 조절한다. CSS 변수나 inline style에서 다크모드 감지 시 lightness 범위를 55~75%로 올린다.

## 변경 파일

- `src/app/(dashboard)/repos/page.tsx` — 카드 스타일 수정 + `getRepoColor` 함수 추가

## 범위 외

- DB 스키마 변경 없음
- API 변경 없음
- 새 컴포넌트 파일 생성 없음
