// src/infra/gemini/gemini-client.ts
import { GoogleGenAI } from "@google/genai";
import type { CommitRecord, DailyTask } from "@/core/types";

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
      .map((c) => `- ${c.message}`)
      .join("\n");
    return `## ${repoName} (${commits.length}건)\n${commitLines}`;
  }).join("\n\n");

  return `아래 Git 커밋 메시지를 기반으로 ${date} 업무 내용을 작성해주세요.

[커밋 목록]
${repoSections}

추정 총 작업 시간: 약 ${estimatedMinutes}분

작성 규칙:
- 커밋 메시지에 나온 구체적인 작업 내용을 그대로 반영 (추상화·의역 금지)
- "feat:", "fix:", "refactor:" 등 prefix는 제거하고 내용만 기재
- 관련된 커밋은 하나의 항목으로 묶되, 서로 다른 작업은 별도 항목으로 분리
- 각 항목은 "- " 로 시작하는 개조식
- 마지막 줄에 "추정 작업 시간: 약 N시간 M분" 기재 (${estimatedMinutes}분 기준)
- 한국어, 텍스트만 응답 (JSON/마크다운 코드블록 불필요)
- 저장소명 언급 불필요

나쁜 예 (추상적): "프롬프트 엔지니어링 및 관련 로직 수정"
좋은 예 (구체적): "클립보드 복사 실패 시 안내 메시지 개선 및 보고서 기본 뷰를 preview로 변경"`;
}

export async function generateHrmsTaskDescription(
  projectName: string,
  date: string,
  repoCommits: Array<{ repoName: string; commits: CommitRecord[] }>,
  estimatedMinutes: number,
): Promise<string> {
  const genai = getClient();
  const prompt = buildHrmsTaskPrompt(projectName, date, repoCommits, estimatedMinutes);

  const result = await withRetry(() =>
    genai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: prompt,
    })
  );

  return result.text ?? "";
}
