// src/infra/notion/notion-client.ts
import { Client } from "@notionhq/client";
import type { CommitRecord, DailyTask } from "@/core/types";

let notionClient: Client | null = null;

function getClient(): Client {
  if (!notionClient) {
    notionClient = new Client({ auth: process.env.NOTION_API_KEY });
  }
  return notionClient;
}

export function buildCommitLogProperties(commit: CommitRecord) {
  return {
    Title: { title: [{ text: { content: commit.message.slice(0, 100) } }] },
    Project: { select: { name: commit.repoName } },
    Date: { date: { start: commit.date } },
    Author: { rich_text: [{ text: { content: commit.author } }] },
    "Commit SHA": { rich_text: [{ text: { content: commit.sha } }] },
    "Files Changed": {
      rich_text: [{ text: { content: commit.filesChanged.join("\n").slice(0, 2000) } }],
    },
    Branch: { select: { name: commit.branch } },
  };
}

export function buildDailyTaskProperties(task: DailyTask) {
  return {
    "제목": { title: [{ text: { content: task.title } }] },
    "작업 설명": { rich_text: [{ text: { content: task.description.slice(0, 2000) } }] },
    "작업일": { date: { start: task.date } },
    "프로젝트": { select: { name: task.project } },
    "작업 복잡도": { select: { name: task.complexity } },
  };
}

export async function createCommitLogPage(commit: CommitRecord): Promise<string> {
  const client = getClient();
  const response = await client.pages.create({
    parent: { database_id: process.env.NOTION_COMMIT_DB_ID! },
    properties: buildCommitLogProperties(commit) as any,
  });
  return response.id;
}

export async function createDailyTaskPage(task: DailyTask): Promise<string> {
  const client = getClient();
  const response = await client.pages.create({
    parent: { database_id: process.env.NOTION_TASK_DB_ID! },
    properties: buildDailyTaskProperties(task) as any,
  });
  return response.id;
}

export async function isCommitAlreadySynced(sha: string): Promise<boolean> {
  const client = getClient();
  const response = await client.databases.query({
    database_id: process.env.NOTION_COMMIT_DB_ID!,
    filter: {
      property: "Commit SHA",
      rich_text: { equals: sha },
    },
  });
  return response.results.length > 0;
}

export async function isDailyTaskExists(project: string, date: string): Promise<string | null> {
  const client = getClient();
  const response = await client.databases.query({
    database_id: process.env.NOTION_TASK_DB_ID!,
    filter: {
      and: [
        { property: "프로젝트", select: { equals: project } },
        { property: "작업일", date: { equals: date } },
      ],
    },
  });
  return response.results.length > 0 ? response.results[0].id : null;
}

export async function updateDailyTaskPage(pageId: string, task: DailyTask): Promise<void> {
  const client = getClient();
  await client.pages.update({
    page_id: pageId,
    properties: buildDailyTaskProperties(task) as any,
  });
}
