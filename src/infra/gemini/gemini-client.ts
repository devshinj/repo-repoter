// src/infra/gemini/gemini-client.ts
import { GoogleGenAI } from "@google/genai";
import type { CommitRecord, DailyTask, LogicraftItemSummary, LogicraftProposal } from "@/core/types";

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  }
  return client;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 2000
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const status = error?.status ?? error?.httpStatusCode;
      const isRetryable = status === 429 || status === 503 || status >= 500;

      if (!isRetryable || attempt === maxRetries) throw error;

      const delay = baseDelayMs * Math.pow(2, attempt);
      console.warn(`[Gemini] ${status} error, retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

export function buildAnalysisPrompt(commits: CommitRecord[], project: string, date: string): string {
  const commitSummaries = commits
    .map(
      (c) =>
        `- [${c.sha.slice(0, 7)}] ${c.message} (files: ${c.filesChanged.join(", ") || "none"}, +${c.additions}/-${c.deletions})`
    )
    .join("\n");

  return `프로젝트 "${project}"에서 ${date}에 수행된 커밋들을 분석하여 일일 업무 태스크로 정리해주세요.

커밋 목록:
${commitSummaries}

다음 JSON 형식으로 응답해주세요:
{
  "tasks": [
    {
      "title": "태스크 제목 (한 줄 요약)",
      "description": "수행한 작업의 상세 설명 (2-3문장)",
      "complexity": "Low | Medium | High | Critical"
    }
  ]
}

규칙:
- 관련된 커밋들은 하나의 태스크로 묶어주세요
- 복잡도는 변경 규모와 난이도를 고려하여 추정해주세요
- 제목과 설명은 한국어로 작성해주세요
- JSON만 응답해주세요`;
}

export function parseAnalysisResponse(
  response: string,
  project: string,
  date: string,
  commitShas: string[]
): DailyTask[] {
  // Markdown code fence 제거
  let cleaned = response.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const parsed = JSON.parse(cleaned);
  const validComplexities = ["Low", "Medium", "High", "Critical"];

  return parsed.tasks.map((t: { title: string; description: string; complexity: string }) => ({
    title: t.title,
    description: t.description,
    date,
    project,
    complexity: validComplexities.includes(t.complexity)
      ? (t.complexity as DailyTask["complexity"])
      : "Medium",
    commitShas,
  }));
}

export async function analyzeCommits(
  commits: CommitRecord[],
  project: string,
  date: string
): Promise<DailyTask[]> {
  const genai = getClient();
  const prompt = buildAnalysisPrompt(commits, project, date);

  const result = await withRetry(() =>
    genai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: prompt,
    })
  );

  const text = result.text ?? "";
  const shas = commits.map((c) => c.sha);
  return parseAnalysisResponse(text, project, date, shas);
}

export async function analyzeCommitWithDiff(
  commit: CommitRecord,
  diff: string
): Promise<string> {
  const genai = getClient();

  const prompt = `다음 Git 커밋의 코드 변경을 분석하여, 이 커밋이 무엇을 했는지 한 줄로 요약해주세요.

커밋 메시지: ${commit.message}
변경된 파일: ${commit.filesChanged.join(", ")}

Diff (일부):
${diff.slice(0, 3000)}

한국어로 한 줄 요약만 응답해주세요.`;

  const result = await withRetry(() =>
    genai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: prompt,
    })
  );

  return result.text ?? commit.message;
}

export function buildHrmsTaskPrompt(
  projectName: string,
  date: string,
  repoCommits: Array<{ repoName: string; commits: CommitRecord[] }>,
  estimatedMinutes: number,
): string {
  const repoSections = repoCommits.map(({ repoName, commits }) => {
    const commitLines = commits
      .map((c) => {
        const files = c.filesChanged.length > 0
          ? `\n  변경 파일: ${c.filesChanged.slice(0, 10).join(", ")}${c.filesChanged.length > 10 ? ` 외 ${c.filesChanged.length - 10}건` : ""}`
          : "";
        const stats = (c.additions > 0 || c.deletions > 0) ? ` (+${c.additions}/-${c.deletions})` : "";
        return `- ${c.message}${stats}${files}`;
      })
      .join("\n");
    return `## ${repoName} (${commits.length}건)\n${commitLines}`;
  }).join("\n\n");

  return `아래 Git 커밋 메시지와 변경 파일 정보를 기반으로 ${date} 업무 내용을 작성해주세요.

[커밋 목록]
${repoSections}

출력 형식:
첫 줄은 반드시 "TITLE: " 로 시작하는 업무 제목 (작업 내역을 아우르는 20자 이내 요약, 프로젝트명·날짜 포함 금지)
다음 줄부터 업무 상세 내용

작성 규칙:
- 커밋 메시지와 변경 파일명에 나온 구체적인 작업 내용을 그대로 반영 (추상화·의역 절대 금지)
- 변경 파일 경로에서 어떤 모듈/컴포넌트를 수정했는지 구체적으로 언급
- "feat:", "fix:", "refactor:" 등 prefix는 제거하고 내용만 기재
- 관련된 커밋은 하나의 항목으로 묶되, 서로 다른 작업은 별도 항목으로 분리
- 각 항목은 "- " 로 시작하는 개조식
- 추정 작업 시간은 기재하지 않음
- 한국어, 텍스트만 응답 (JSON/마크다운 코드블록 불필요)
- 저장소명 언급 불필요

제목 예시:
- "HRMS 업무 자동 등록 기능 구현"
- "클립보드 복사 개선 및 보고서 뷰 변경"

나쁜 본문 예 (추상적): "API 연동 및 UI 개선 작업", "프롬프트 엔지니어링 및 관련 로직 수정"
좋은 본문 예 (구체적): "HRMS 매핑 카드에 최근 등록 업무 표시 기능 추가 (hrms-client.ts의 listTasks 활용, mapping-card.tsx에 최근 3건 표시)"`;
}

export function parseHrmsTaskResponse(text: string): { title: string; description: string } {
  const lines = text.split("\n");
  let title = "업무 수행";
  let contentStartIndex = 0;

  if (lines[0]?.startsWith("TITLE:")) {
    title = lines[0].replace("TITLE:", "").trim();
    contentStartIndex = 1;
    while (contentStartIndex < lines.length && lines[contentStartIndex].trim() === "") {
      contentStartIndex++;
    }
  }

  return { title, description: lines.slice(contentStartIndex).join("\n").trim() };
}

export async function generateHrmsTaskContent(
  projectName: string,
  date: string,
  repoCommits: Array<{ repoName: string; commits: CommitRecord[] }>,
  estimatedMinutes: number,
): Promise<{ title: string; description: string }> {
  const genai = getClient();
  const prompt = buildHrmsTaskPrompt(projectName, date, repoCommits, estimatedMinutes);

  const result = await withRetry(() =>
    genai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: prompt,
    })
  );

  return parseHrmsTaskResponse(result.text ?? "");
}

export function buildLogicraftTaskPrompt(
  projectName: string,
  logicraftProjectName: string,
  date: string,
  items: LogicraftItemSummary[],
  proposals: LogicraftProposal[],
): string {
  const itemLines = items
    .map((item) => `- [${item.id}] ${item.type}: ${item.title} (상태: ${item.status}, v${item.version})`)
    .join("\n");

  const proposalLines = proposals.length > 0
    ? proposals
        .map((p) => `- [${p.target_id}] ${p.status}: ${p.rationale}`)
        .join("\n")
    : "없음";

  return `아래 LogiCraft 설계 산출물 수정 이력을 기반으로 ${date} 업무 내용을 작성해주세요.

[프로젝트: ${logicraftProjectName}]

[수정된 ITEM 목록 (${items.length}건)]
${itemLines || "없음"}

[변경 제안 (${proposals.length}건)]
${proposalLines}

출력 형식:
첫 줄은 반드시 "TITLE: " 로 시작하는 업무 제목 (작업 내역을 아우르는 20자 이내 요약, 프로젝트명·날짜 포함 금지)
다음 줄부터 업무 상세 내용

작성 규칙:
- ITEM ID와 타입을 구체적으로 언급 (예: "REQ-005 요구사항 정의", "FEAT-012 기능 상세화")
- 어떤 설계 산출물을 어떻게 변경했는지 구체적으로 기재
- 관련된 ITEM 수정은 하나의 항목으로 묶되, 서로 다른 작업은 별도 항목으로 분리
- 각 항목은 "- " 로 시작하는 개조식
- 한국어, 텍스트만 응답 (JSON/마크다운 코드블록 불필요)

제목 예시:
- "도메인 모델 요구사항 정의"
- "API 엔드포인트 설계 및 시퀀스 다이어그램 작성"`;
}

export async function generateLogicraftTaskContent(
  projectName: string,
  logicraftProjectName: string,
  date: string,
  items: LogicraftItemSummary[],
  proposals: LogicraftProposal[],
): Promise<{ title: string; description: string }> {
  const genai = getClient();
  const prompt = buildLogicraftTaskPrompt(projectName, logicraftProjectName, date, items, proposals);

  const result = await withRetry(() =>
    genai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: prompt,
    }),
  );

  return parseHrmsTaskResponse(result.text ?? "");
}
