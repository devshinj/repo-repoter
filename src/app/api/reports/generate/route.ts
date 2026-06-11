import { NextRequest, NextResponse } from "next/server";
import { getRepositoryByIdAndUser } from "@/infra/db/repository";
import { insertReport, updateReportStatus } from "@/infra/db/report";
import { auth } from "@/lib/auth";
import { GoogleGenAI } from "@google/genai";
import { getDb } from "@/infra/db/connection";
import {
  CommitEntry,
  collectCommitsForDateFromCache,
  buildPrompt,
  parseGeneratedReport,
} from "@/scheduler/report-generator";

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
              const dayCommits = collectCommitsForDateFromCache(repo.id, d, authors);
              allCommits = allCommits.concat(dayCommits);
              current.setDate(current.getDate() + 1);
            }
          } else {
            allCommits = collectCommitsForDateFromCache(repo.id, date!, authors);
          }

          if (allCommits.length === 0) {
            updateReportStatus(db, pendingId, "error", { title: `[${displayName}] 업무 보고서`, content: "해당 기간에 커밋이 없습니다." });
            return;
          }

          const prompt = buildPrompt(repo.owner, repo.repo, repo.label, dateLabel, allCommits, isRange);
          const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
          const result = await genai.models.generateContent({
            model: "gemini-2.5-flash-lite",
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
        const dayCommits = collectCommitsForDateFromCache(repo.id, d, syncAuthors);
        allCommits = allCommits.concat(dayCommits);
        current.setDate(current.getDate() + 1);
      }
    } else {
      allCommits = collectCommitsForDateFromCache(repo.id, date!, syncAuthors);
    }

    if (allCommits.length === 0) {
      return NextResponse.json({ error: "해당 기간에 커밋이 없습니다." }, { status: 400 });
    }

    const prompt = buildPrompt(repo.owner, repo.repo, repo.label, dateLabel, allCommits, isRange);

    const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const result = await genai.models.generateContent({
      model: "gemini-2.5-flash-lite",
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
