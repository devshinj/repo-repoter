import { NextRequest, NextResponse } from "next/server";
import { getRepositoryByIdAndUser } from "@/infra/db/repository";
import { insertReport, updateReportStatus } from "@/infra/db/report";
import { getDetailedCommitsForDate, getBranches } from "@/infra/git/git-client";
import { auth } from "@/lib/auth";
import { GoogleGenAI } from "@google/genai";
import { getDb } from "@/infra/db/connection";

interface CommitEntry {
  branch: string;
  sha: string;
  message: string;
  author: string;
  date: string;
  filesChanged: string[];
  additions: number;
  deletions: number;
  commitDate?: string; // the calendar date (YYYY-MM-DD), used for range mode
}

async function collectCommitsForDate(
  clonePath: string,
  cloneUrl: string,
  date: string,
  authors?: string[]
): Promise<CommitEntry[]> {
  const branches = await getBranches(clonePath);
  const seenShas = new Set<string>();
  const commits: CommitEntry[] = [];

  for (const branch of branches) {
    try {
      const branchCommits = await getDetailedCommitsForDate(clonePath, branch, cloneUrl, date, authors);
      for (const c of branchCommits) {
        if (seenShas.has(c.sha)) continue;
        seenShas.add(c.sha);
        commits.push({
          branch,
          sha: c.sha,
          message: c.message,
          author: c.author,
          date: c.date,
          filesChanged: c.filesChanged,
          additions: c.additions,
          deletions: c.deletions,
          commitDate: date,
        });
      }
    } catch {
      // 브랜치 오류 무시
    }
  }

  return commits;
}

function buildPrompt(
  repoOwner: string,
  repoName: string,
  repoLabel: string | null,
  dateLabel: string,
  allCommits: CommitEntry[],
  isRange: boolean
): string {
  const displayName = repoLabel || `${repoOwner}/${repoName}`;
  const commitDetails = allCommits
    .map((c) => {
      const time = new Date(c.date).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
      const files = c.filesChanged.length > 0 ? c.filesChanged.join(", ") : "(파일 정보 없음)";
      const datePrefix = isRange && c.commitDate ? `[${c.commitDate}] ` : "";
      return `${datePrefix}[${c.branch}] ${time} - ${c.message}
  변경 파일: ${files}
  변경량: +${c.additions} / -${c.deletions}`;
    })
    .join("\n\n");

  const totalAdditions = allCommits.reduce((s, c) => s + c.additions, 0);
  const totalDeletions = allCommits.reduce((s, c) => s + c.deletions, 0);
  const branchSet = [...new Set(allCommits.map((c) => c.branch))];

  const periodLabel = isRange ? "기간" : "날짜";
  const rule4 = isRange
    ? `4. **일자별 정리**: 날짜별로 업무를 구분하여 정리해주세요.`
    : "";

  return `당신은 소프트웨어 개발팀의 업무 보고서 작성 도우미입니다.
아래 Git 커밋 데이터를 분석하여 ${isRange ? "해당 기간의" : "해당일의"} **업무 보고서**를 작성해주세요. (구어체 사용 금지)

**추가로, 보고서 내용을 함축하는 짧은 제목(20자 이내)을 한 줄로 생성해주세요.**
제목은 반드시 응답의 첫 줄에 \`TITLE: \`로 시작하세요. 제목에 프로젝트명이나 날짜는 포함하지 마세요.
예시: \`TITLE: OAuth 인증 흐름 구현 및 세션 관리\`
제목 다음 줄부터 보고서 본문을 작성하세요.

## 기본 정보
- 프로젝트: ${displayName}
- ${periodLabel}: ${dateLabel}
- 총 커밋: ${allCommits.length}건
- 총 변경량: +${totalAdditions} / -${totalDeletions}
- 작업 브랜치: ${branchSet.join(", ")}

## 커밋 상세
${commitDetails}

## 보고서 출력 형식 (아래 마크다운 구조를 정확히 따라주세요)

\`\`\`
## 📋 업무 요약

> - (핵심 업무 항목을 불릿으로 나열, 4줄 이내)

---

## 📌 상세 업무 내용

### 1. (업무 제목)

- (수행 항목을 불릿으로 나열)
- 관련 파일: N개
- 변경량: +N / -N

### 2. (다음 업무 제목)

...

---

## 🔍 특이 사항

- (주목할 변경 사항이 있으면 불릿으로 기재. 없으면 이 섹션 생략)
\`\`\`
${rule4}

## 작성 규칙
- 한국어로 작성
- **문체**: 간결한 개조식(불릿 나열형) 사용. 긴 문장 서술 금지
  - 좋은 예: "관리자 페이지 신설, 사용자 목록 조회·활성화/비활성화 API 구현"
  - 나쁜 예: "관리자 페이지를 신설하고 사용자 목록 조회, 활성화/비활성화 API를 구현함"
- **종결**: "~함", "~완료" 등 종결 어미 대신, 명사형·체언 종결 선호 (예: "API 구현", "모달 개발", "테이블 마이그레이션 적용")
- **금지**: "~했습니다/~됩니다" 존댓말, "~하였으며/~하고" 연결형 서술, "크게 향상/대폭 개선" 등 과장 형용사
- 수치로 표현 가능한 내용은 수치 사용 (예: "성능 향상" → "응답 시간 30% 단축")
- 관련 커밋들을 묶어서 **업무 단위**로 정리 (커밋 1:1 나열 금지)
- 관련 파일은 개수만 표기 (파일 경로 나열 금지)
- 보고서 제목(h1)이나 날짜 헤더는 포함하지 마세요 — 본문만 작성
- 위 출력 형식의 괄호 안 지시문은 실제 내용으로 대체하세요. 지시문 자체를 출력하지 마세요
- 위 출력 형식의 섹션 구조와 이모지 헤더를 그대로 사용하세요`;
}

function parseGeneratedReport(text: string, displayName: string): { title: string; content: string } {
  const lines = text.split("\n");
  let title = `[${displayName}] 업무 보고서`;
  let contentStartIndex = 0;

  if (lines[0]?.startsWith("TITLE:")) {
    title = `[${displayName}] ${lines[0].replace("TITLE:", "").trim()}`;
    contentStartIndex = 1;
    // 빈 줄 스킵
    while (contentStartIndex < lines.length && lines[contentStartIndex].trim() === "") {
      contentStartIndex++;
    }
  }

  return { title, content: lines.slice(contentStartIndex).join("\n") };
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const {
    repoId,
    date,
    dateRange,
    async: asyncMode,
  }: {
    repoId: number;
    date?: string;
    dateRange?: { since: string; until: string };
    async?: boolean;
  } = body;

  if (!repoId) {
    return NextResponse.json({ error: "repoId is required" }, { status: 400 });
  }
  if (!date && !dateRange) {
    return NextResponse.json({ error: "date or dateRange is required" }, { status: 400 });
  }

  const db = getDb();
  try {
    const repo = getRepositoryByIdAndUser(db, Number(repoId), session.user.id);
    if (!repo) return NextResponse.json({ error: "Repository not found" }, { status: 404 });
    if (!repo.clone_path) return NextResponse.json({ error: "Repository not yet cloned" }, { status: 400 });

    const isRange = Boolean(dateRange);
    const dateLabel = isRange ? `${dateRange!.since} ~ ${dateRange!.until}` : date!;
    const displayName = repo.label || `${repo.owner}/${repo.repo}`;

    if (asyncMode) {
      // 비동기 모드: pending 상태로 먼저 저장 후 백그라운드에서 생성
      const reportDate = isRange ? dateRange!.since : date!;
      const pendingId = insertReport(db, {
        userId: session.user.id,
        repositoryId: Number(repoId),
        project: displayName,
        date: reportDate,
        title: `[${displayName}] 업무 보고서`,
        content: "",
        dateStart: isRange ? dateRange!.since : undefined,
        dateEnd: isRange ? dateRange!.until : undefined,
        status: "pending",
      });

      // 백그라운드 생성 (await 하지 않음)
      const authors = repo.git_author ? repo.git_author.split(",").map((a: string) => a.trim()).filter(Boolean) : undefined;
      (async () => {
        try {
          // 커밋 수집
          let allCommits: CommitEntry[] = [];
          if (isRange) {
            const current = new Date(dateRange!.since);
            const end = new Date(dateRange!.until);
            while (current <= end) {
              const d = current.toISOString().slice(0, 10);
              const dayCommits = await collectCommitsForDate(repo.clone_path!, repo.clone_url, d, authors);
              allCommits = allCommits.concat(dayCommits);
              current.setDate(current.getDate() + 1);
            }
          } else {
            allCommits = await collectCommitsForDate(repo.clone_path!, repo.clone_url, date!, authors);
          }

          if (allCommits.length === 0) {
            updateReportStatus(db, pendingId, "error", { title: `[${displayName}] 업무 보고서`, content: "해당 기간에 커밋이 없습니다." });
            return;
          }

          const prompt = buildPrompt(repo.owner, repo.repo, repo.label, dateLabel, allCommits, isRange);
          const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
          const result = await genai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
          });
          const parsed = parseGeneratedReport(result.text ?? "", displayName);
          updateReportStatus(db, pendingId, "completed", parsed);
        } catch (err: any) {
          updateReportStatus(db, pendingId, "error", {
            title: `[${displayName}] 업무 보고서`,
            content: err?.message ?? "보고서 생성 중 오류 발생",
          });
        }
      })();

      return NextResponse.json({ id: pendingId, status: "pending" }, { status: 202 });
    }

    // 동기 모드: 기존 동작 + 기간 지원
    const syncAuthors = repo.git_author ? repo.git_author.split(",").map((a: string) => a.trim()).filter(Boolean) : undefined;
    let allCommits: CommitEntry[] = [];
    if (isRange) {
      const current = new Date(dateRange!.since);
      const end = new Date(dateRange!.until);
      while (current <= end) {
        const d = current.toISOString().slice(0, 10);
        const dayCommits = await collectCommitsForDate(repo.clone_path, repo.clone_url, d, syncAuthors);
        allCommits = allCommits.concat(dayCommits);
        current.setDate(current.getDate() + 1);
      }
    } else {
      allCommits = await collectCommitsForDate(repo.clone_path, repo.clone_url, date!, syncAuthors);
    }

    if (allCommits.length === 0) {
      return NextResponse.json({ error: "해당 기간에 커밋이 없습니다." }, { status: 400 });
    }

    const prompt = buildPrompt(repo.owner, repo.repo, repo.label, dateLabel, allCommits, isRange);

    const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const result = await genai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const parsed = parseGeneratedReport(result.text ?? "", displayName);
    const totalAdditions = allCommits.reduce((s, c) => s + c.additions, 0);
    const totalDeletions = allCommits.reduce((s, c) => s + c.deletions, 0);
    const branchSet = [...new Set(allCommits.map((c) => c.branch))];

    return NextResponse.json({
      title: parsed.title,
      content: parsed.content,
      meta: {
        totalCommits: allCommits.length,
        totalAdditions,
        totalDeletions,
        branches: branchSet,
        date: dateLabel,
      },
    });
  } catch (error: any) {
    console.error("[Report Generate]", error);
    return NextResponse.json({ error: error.message || "보고서 생성 실패" }, { status: 500 });
  }
}
