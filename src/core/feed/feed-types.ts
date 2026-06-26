export interface RssCommit {
  repositoryId: number;
  sha: string;
  authorName: string;
  message: string;
  committedAt: string; // ISO 8601
}

export interface GroupSuggestion {
  suggestion: string;
  repositories: Array<{ id: number; name: string }>;
}

export interface FeedEntry {
  id: number;
  userId: string;
  scopeType: "project" | "repository" | "logicraft";
  scopeId: number;
  briefing?: string;
  milestoneSummary?: string;
  commitShas: string[]; // parsed from JSON
  groupSuggestion?: GroupSuggestion; // parsed from JSON
  periodStart: string; // ISO 8601 date
  periodEnd: string; // ISO 8601 date
  createdAt: string; // ISO 8601
}
