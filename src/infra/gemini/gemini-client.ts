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

  const totalCommits = repoCommits.reduce((s, r) => s + r.commits.length, 0);

  return `아래 Git 커밋 메시지와 변경 파일 정보를 기반으로 ${date} 업무 내용을 작성해주세요.
총 커밋: ${totalCommits}건

[커밋 목록]
${repoSections}

출력 형식:
첫 줄은 반드시 "TITLE: " 로 시작하는 업무 제목 (작업 내역을 아우르는 20자 이내 요약, 프로젝트명·날짜 포함 금지)
빈 줄 후 아래 마크다운 구조를 정확히 따라주세요:

## 📋 업무 요약

> - (핵심 업무 항목을 불릿으로 나열, 2~4줄)

---

## 📌 상세 업무 내용

### 1. (업무 카테고리 제목)

- (수행 항목)
- (수행 항목)
- 관련 파일: N개
- 변경량: +N / -N

### 2. (업무 카테고리 제목)

- (수행 항목)
- 관련 파일: N개
- 변경량: +N / -N

---

## 🔍 특이 사항

- (주목할 변경 사항이 있으면 불릿으로 기재. 없으면 이 섹션 생략)

작성 규칙:
- 📋 업무 요약은 당일 작업 전체를 관통하는 핵심을 blockquote 안 불릿(> -)으로 2~4줄
- 📌 상세 업무 내용은 관련 커밋을 업무 단위로 묶어 번호 매긴 카테고리로 정리, 2~5개가 적절
- 각 카테고리 끝에 "관련 파일: N개"와 "변경량: +N / -N" 표기 (해당 카테고리에 속한 커밋들의 합산)
- 커밋 메시지에 나온 구체적 작업 내용을 반영 (추상화·의역 금지)
- 어떤 모듈/컴포넌트를 수정했는지 구체적으로 언급하되, 파일 경로 전체를 나열하지 말고 모듈명 수준으로 축약
- "feat:", "fix:", "refactor:" 등 prefix는 제거하고 내용만 기재
- 문체: 간결한 개조식, 명사형·체언 종결 선호 (예: "API 구현", "모달 개발")
- "~했습니다/~됩니다" 존댓말, "~하였으며/~하고" 연결형 서술 금지
- 추정 작업 시간 기재 불필요
- 한국어, 마크다운으로 응답 (JSON/코드블록 불필요)
- 위 출력 형식의 괄호 안 지시문은 실제 내용으로 대체. 지시문 자체를 출력하지 말 것
- 섹션 구조와 이모지 헤더를 그대로 사용할 것

다중 저장소 규칙 (커밋 목록에 여러 저장소가 포함된 경우):
- 저장소별로 나누지 말고, 업무 목적 기준으로 카테고리를 구성할 것
- 예: 백엔드 API 수정 + 프론트엔드 화면 수정이 같은 기능이면 하나의 카테고리로 묶기
- 요약과 제목은 모든 저장소의 작업을 아우르는 통합 관점으로 작성
- 각 저장소 커밋이 완전히 다른 업무라면 별도 카테고리로 분리하되, 저장소명이 아닌 업무 내용을 카테고리 제목으로 사용

제목 예시:
- "HRMS 업무 자동 등록 기능 구현"
- "LogiCraft 통합 및 HRMS 기능 고도화"

나쁜 본문 예 (저장소별 분리):
### 1. cudo_cuvia_backend 작업
- 영상 업로드 API 응답 스키마 변경

### 2. cudo_cuvia_frontend 작업
- 영상 업로드 폼 연동

좋은 본문 예 (업무 단위 통합):
## 📋 업무 요약

> - 영상 업로드 유효성 검증 강화 및 결과 화면 개선
> - 에러 상태별 안내 메시지 분기 처리

---

## 📌 상세 업무 내용

### 1. 영상 업로드 유효성 검증 강화

- API 응답 스키마에 검증 결과 필드 추가
- 프론트엔드 업로드 폼에 실시간 유효성 검사 연동
- 관련 파일: 6개
- 변경량: +210 / -35

### 2. 업로드 결과 화면 개선

- API 응답 구조 변경에 맞춰 결과 표시 컴포넌트 수정
- 에러 상태별 안내 메시지 분기 처리
- 관련 파일: 3개
- 변경량: +85 / -20`;
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
  // 타입별 그룹핑
  const grouped = new Map<string, LogicraftItemSummary[]>();
  for (const item of items) {
    const list = grouped.get(item.type) ?? [];
    list.push(item);
    grouped.set(item.type, list);
  }

  const groupedLines = Array.from(grouped.entries())
    .map(([type, typeItems]) => {
      const details = typeItems
        .map((item) => {
          const summary = item.change_summary ? ` — ${item.change_summary}` : "";
          return `  · ${item.id} ${item.title}${summary}`;
        })
        .join("\n");
      return `[${type}] ${typeItems.length}건\n${details}`;
    })
    .join("\n\n");

  const proposalLines = proposals.length > 0
    ? proposals
        .map((p) => `  · ${p.itemId} (${p.status}): ${p.rationale}`)
        .join("\n")
    : "";

  return `아래는 ${date} "${logicraftProjectName}" 프로젝트의 설계 산출물 변경 이력이다.
이 이력을 바탕으로 당일 수행한 업무 내용을 요약해주세요.

${groupedLines}
${proposalLines ? `\n[변경 제안 ${proposals.length}건]\n${proposalLines}` : ""}

출력 형식:
첫 줄은 반드시 "TITLE: " 로 시작하는 업무 제목 (핵심 작업을 20자 이내로 요약, 프로젝트명·날짜 포함 금지)
다음 줄부터 업무 상세 내용

작성 규칙:
- 같은 목적의 작업은 하나의 항목으로 묶어서 "무엇을 왜 했는지" 중심으로 기술
- change_summary가 있으면 그 내용을 반영하여 구체적으로 작성
- ID를 일일이 나열하지 말고, 대표 ID 1~2개만 언급하고 나머지는 "외 N건" 처리
- 본문 첫 줄에 "프로젝트: ${logicraftProjectName}" 을 명시
- 각 항목은 "- " 로 시작하는 개조식, 3~6개 항목이 적절
- 한국어, 텍스트만 응답 (JSON/마크다운 코드블록 불필요)

나쁜 예 (ID 나열):
- FEAT-001, FEAT-002, FEAT-003, FEAT-004 Feature를 v2로 업데이트했습니다.

좋은 예 (의미 중심):
- 영상 관리 도메인 Feature 4건(FEAT-001 외 3건) 상세 설계: 업로드 워크플로·메타데이터 검증·배치 처리 흐름 구체화
- CCTV 자원 관리 API 12건(API-050 외 11건) 엔드포인트 설계: 요청/응답 스키마·인증·에러 코드 정의`;
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
