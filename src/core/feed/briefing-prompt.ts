import type { RssCommit } from "@/core/feed/feed-types";
import type { GroupSuggestion } from "@/core/feed/feed-types";
import type { Milestone } from "@/core/project/project-types";

export interface LogicraftActivity {
  type: string;
  title: string;
  updatedAt: string;
}

export interface BriefingPromptInput {
  scopeName: string;
  commits: RssCommit[];
  milestones: Milestone[];
  previousMilestoneSummary?: string;
  logicraftActivities?: LogicraftActivity[];
}

export interface MilestoneParseResult {
  title: string;
  deadline: string | null;
  suggestedScope: {
    type: "project" | "repository";
    id: number;
    name: string;
    confidence: "high" | "medium" | "low";
  } | null;
}

export function buildBriefingPrompt(input: BriefingPromptInput): string {
  const { scopeName, commits, milestones, previousMilestoneSummary, logicraftActivities } = input;

  // 작업자별 그룹핑
  const byAuthor = new Map<string, RssCommit[]>();
  for (const c of commits) {
    const list = byAuthor.get(c.authorName) ?? [];
    list.push(c);
    byAuthor.set(c.authorName, list);
  }

  const authorSections = Array.from(byAuthor.entries())
    .map(([author, authorCommits]) => {
      const lines = authorCommits
        .map((c) => `  - ${c.message} (${c.committedAt})`)
        .join("\n");
      return `### ${author}\n${lines}`;
    })
    .join("\n\n");

  const milestoneSection =
    milestones.length > 0
      ? `\n[활성 마일스톤]\n${milestones
          .map((m) => {
            const deadline = m.deadline ? ` (마감: ${m.deadline})` : "";
            return `- ${m.title}${deadline}`;
          })
          .join("\n")}\n`
      : "";

  const previousMilestoneSection =
    previousMilestoneSummary
      ? `\n[이전 마일스톤 현황]\n${previousMilestoneSummary}\n`
      : "";

  const logicraftSection =
    logicraftActivities && logicraftActivities.length > 0
      ? `\n[설계 산출물 변경 (LogiCraft)]\n${logicraftActivities
          .map((a) => `- [${a.type}] ${a.title} (${a.updatedAt})`)
          .join("\n")}\n`
      : "";

  return `업무 현황 브리핑을 작성하세요.

[프로젝트/저장소]
${scopeName}
${milestoneSection}${previousMilestoneSection}
[커밋 목록 — 작업자별]
${authorSections}
${logicraftSection}
[출력 규칙]
핵심 변경사항을 마크다운 불릿(-)으로 요약.
${logicraftActivities && logicraftActivities.length > 0 ? "- 설계 산출물 변경도 함께 요약에 포함." : ""}
- 각 항목은 한 문장으로 완결. 두 가지 이상의 작업을 콤마(,)나 접속사(~하고)로 이어붙이지 말 것.
- 3~5개 항목, 각 항목 1줄 이내.
- 커밋 메시지를 그대로 나열하지 말고 의미 단위로 묶어서 요약.
- 인사말·감상·칭찬·격려 금지. 사실 위주 간결체. 개조식 명사형 종결 (예: "API 구현", "버그 수정").
- 하위 불릿(중첩) 금지. 최상위 불릿만 사용.
- 한국어, 마크다운 불릿만 응답 (JSON/코드블록 불필요).`;
}

export interface LogicraftBriefingInput {
  projectName: string;
  activities: LogicraftActivity[];
}

export function buildLogicraftBriefingPrompt(input: LogicraftBriefingInput): string {
  const { projectName, activities } = input;

  const activityLines = activities
    .map((a) => `- [${a.type}] ${a.title} (${a.updatedAt})`)
    .join("\n");

  return `설계 프로젝트의 업무 현황 브리핑을 작성하세요.

[프로젝트]
${projectName}

[설계 산출물 변경 내역]
${activityLines}

[출력 규칙]
- 핵심 변경사항을 마크다운 불릿(-)으로 요약.
- 각 항목은 한 문장으로 완결. 두 가지 이상의 작업을 콤마(,)나 접속사(~하고)로 이어붙이지 말 것.
- 3~5개 항목, 각 항목 1줄 이내.
- 산출물 변경을 그대로 나열하지 말고 의미 단위로 묶어서 요약.
- 인사말·감상·칭찬·격려 금지. 사실 위주 간결체. 개조식 명사형 종결 (예: "API 설계 추가", "ERD 수정").
- 하위 불릿(중첩) 금지. 최상위 불릿만 사용.
- 한국어, 마크다운 불릿만 응답 (JSON/코드블록 불필요).`;
}

export interface MilestoneSummaryInput {
  milestones: Milestone[];
  commits: RssCommit[];
  currentDate: string;
  previousSummary?: string;
}

export function buildMilestoneSummaryPrompt(input: MilestoneSummaryInput): string {
  const { milestones, commits, currentDate, previousSummary } = input;

  const milestoneLines = milestones
    .map((m) => {
      const deadline = m.deadline ? ` (마감: ${m.deadline})` : "";
      return `- ${m.title}${deadline}`;
    })
    .join("\n");

  const commitLines = commits
    .slice(0, 30)
    .map((c) => `- ${c.message}`)
    .join("\n");

  const previousSection = previousSummary
    ? `\n[이전 현황]\n${previousSummary}\n`
    : "";

  return `각 마일스톤의 현재 상태를 판단하세요.

[현재 날짜]
${currentDate}

[활성 마일스톤]
${milestoneLines}
${previousSection}
[최근 커밋]
${commitLines}

[출력 규칙]
- 마일스톤별로 정확히 한 줄씩, 아래 형식을 엄격히 따를 것:
  마일스톤명 — 상태 · N일 남음 · 변화
- 상태(5가지 중 택1): 개발 중 / 수정·보완 / 활동 없음 / 지연 위험 / 완료 근접
- 남은 일수: 현재 날짜 기준 정확 계산. 0이면 "오늘 마감". 초과하면 "N일 초과".
- 변화: 이전 현황이 있으면 "진전 있음" / "변화 없음" / "후퇴" 중 택1. 없으면 생략.
- 구분자 "—"(em dash)와 "·"(가운뎃점)를 반드시 사용.
- 인사말·감상 금지. 형식 외 텍스트 추가 금지.
- 텍스트만 응답. 한국어로 작성.

출력 예시:
HRMS 연동 완료 — 수정·보완 · 3일 남음 · 진전 있음
UI 리뉴얼 — 개발 중 · 12일 남음`;
}

export function buildMilestoneParsePrompt(
  rawInput: string,
  currentDate: string,
  projects: Array<{ id: number; name: string }>,
  repositories: Array<{ id: number; name: string }>
): string {
  const projectList =
    projects.length > 0
      ? projects
          .map((p) => `  - id: ${p.id}, name: "${p.name}"`)
          .join("\n")
      : "  (없음)";
  const repoList =
    repositories.length > 0
      ? repositories
          .map((r) => `  - id: ${r.id}, name: "${r.name}"`)
          .join("\n")
      : "  (없음)";

  return `사용자의 자연어 목표를 구조화하세요.

[입력]
- 사용자 원문: "${rawInput}"
- 현재 날짜: ${currentDate}
- 등록된 프로젝트 목록:
${projectList}
- 등록된 저장소 목록:
${repoList}

[출력 JSON]
{
  "title": "명확하고 간결한 마일스톤 제목",
  "deadline": "YYYY-MM-DD 또는 null",
  "suggested_scope": {
    "type": "project 또는 repository",
    "id": 숫자,
    "name": "이름",
    "confidence": "high 또는 medium 또는 low"
  }
}

규칙:
- "다음 주 금요일"처럼 상대 날짜는 현재 날짜 기준으로 절대 날짜(YYYY-MM-DD)로 변환
- 입력에 날짜 언급이 없으면 deadline은 null
- 프로젝트/저장소 목록에서 관련성 높은 것을 추천. 확신 없으면 confidence를 "low"로
- 관련 프로젝트/저장소가 전혀 없으면 suggested_scope를 null
- JSON만 응답`;
}

export function parseMilestoneParseResponse(
  text: string
): MilestoneParseResult {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```(?:json)?\n?/, "")
      .replace(/\n?```$/, "");
  }
  const parsed = JSON.parse(cleaned);
  return {
    title: parsed.title,
    deadline: parsed.deadline || null,
    suggestedScope: parsed.suggested_scope
      ? {
          type: parsed.suggested_scope.type,
          id: parsed.suggested_scope.id,
          name: parsed.suggested_scope.name,
          confidence: parsed.suggested_scope.confidence,
        }
      : null,
  };
}

export function buildGroupSuggestionPrompt(
  repositories: Array<{
    id: number;
    name: string;
    language: string | null;
    recentMessages: string[];
  }>
): string {
  const repoLines = repositories
    .map((r) => {
      const msgs = r.recentMessages
        .slice(0, 5)
        .map((m) => `    - ${m}`)
        .join("\n");
      return `- id: ${r.id}, name: "${r.name}", language: ${
        r.language || "unknown"
      }\n  최근 커밋:\n${msgs}`;
    })
    .join("\n");

  return `아래 저장소들이 같은 프로젝트에 속할 가능성이 있는지 판단하세요.

[저장소 목록]
${repoLines}

관련성이 보이면 다음 JSON 형태로 응답:
{
  "suggestion": "프로젝트로 묶는 이유 설명",
  "repositories": [{"id": 숫자, "name": "이름"}, ...]
}

관련성이 없으면 null 만 응답하세요.
JSON 또는 null 만 응답.`;
}

export function parseGroupSuggestionResponse(
  text: string
): GroupSuggestion | null {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```(?:json)?\n?/, "")
      .replace(/\n?```$/, "");
  }
  if (cleaned === "null" || cleaned === "") return null;
  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed?.suggestion || !parsed?.repositories) return null;
    return {
      suggestion: parsed.suggestion,
      repositories: parsed.repositories,
    };
  } catch {
    return null;
  }
}
