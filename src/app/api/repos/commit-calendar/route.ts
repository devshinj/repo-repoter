import { NextRequest, NextResponse } from "next/server";
import { getRepositoriesByUser, getCommitCountsByDateRange } from "@/infra/db/repository";
import { auth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const since = searchParams.get("since") || undefined;
  const until = searchParams.get("until") || undefined;
  const repoIdsParam = searchParams.get("repoIds");

  try {
    let repos = await getRepositoriesByUser(session.user.id);

    if (repoIdsParam) {
      const repoIdSet = new Set(repoIdsParam.split(",").map(Number));
      repos = repos.filter((r: any) => repoIdSet.has(r.id));
    }

    const repoIds = repos.map((r: any) => r.id);
    if (repoIds.length === 0) return NextResponse.json({});

    const allAuthors: string[] = [];
    for (const repo of repos) {
      if (repo.git_author) {
        allAuthors.push(...repo.git_author.split(",").map((a: string) => a.trim()).filter(Boolean));
      }
    }

    const counts = await getCommitCountsByDateRange(
      repoIds,
      since || "1970-01-01",
      until || "2099-12-31",
      allAuthors.length > 0 ? allAuthors : undefined
    );

    return NextResponse.json(counts);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
