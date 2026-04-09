import { NextRequest, NextResponse } from "next/server";
import { Client } from "@notionhq/client";
import { auth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const project = searchParams.get("project");
  const date = searchParams.get("date");

  const notion = new Client({ auth: process.env.NOTION_API_KEY });

  const filters: any[] = [];
  if (project) filters.push({ property: "프로젝트", select: { equals: project } });
  if (date) filters.push({ property: "작업일", date: { equals: date } });

  const response = await notion.databases.query({
    database_id: process.env.NOTION_TASK_DB_ID!,
    filter: filters.length > 0 ? { and: filters } : undefined,
    sorts: [{ property: "작업일", direction: "descending" }],
  });

  return NextResponse.json(response.results);
}
