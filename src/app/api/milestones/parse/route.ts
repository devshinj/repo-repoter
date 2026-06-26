import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProjectsByUser } from "@/infra/db/project-repository";
import { getRepositoriesByUser } from "@/infra/db/repository";
import { buildMilestoneParsePrompt, parseMilestoneParseResponse } from "@/core/feed/briefing-prompt";
import { generateText } from "@/infra/llm/llm-client";
import { getKstToday } from "@/core/date-utils";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body.rawInput) {
    return NextResponse.json({ error: "rawInput required" }, { status: 400 });
  }

  const userId = String(session.user.id);
  const [projectsRaw, reposRaw] = await Promise.all([
    getProjectsByUser(userId),
    getRepositoriesByUser(userId),
  ]);
  const projects = projectsRaw.map((p: any) => ({ id: p.id, name: p.name }));
  const repos = reposRaw.map((r: any) => ({ id: r.id, name: `${r.owner}/${r.repo}` }));

  const today = getKstToday();
  const prompt = buildMilestoneParsePrompt(body.rawInput, today, projects, repos);

  try {
    const text = await generateText(prompt);
    const result = parseMilestoneParseResponse(text);
    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
