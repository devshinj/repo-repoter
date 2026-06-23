import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { getProjectsByUser } from "@/infra/db/project-repository";
import { getRepositoriesByUser } from "@/infra/db/repository";
import { buildMilestoneParsePrompt, parseMilestoneParseResponse } from "@/core/feed/briefing-prompt";
import { generateText } from "@/infra/llm/llm-client";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body.rawInput) {
    return NextResponse.json({ error: "rawInput required" }, { status: 400 });
  }

  const userId = String(session.user.id);
  const db = getDb();
  const projects = getProjectsByUser(db, userId).map((p: any) => ({ id: p.id, name: p.name }));
  const repos = getRepositoriesByUser(db, userId).map((r: any) => ({ id: r.id, name: `${r.owner}/${r.repo}` }));

  const today = new Date().toISOString().split("T")[0];
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
