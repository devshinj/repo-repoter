export interface Project {
  id: number;
  userId: string;
  name: string;
  description?: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export interface ProjectWithRepos extends Project {
  repositoryIds: number[];
}

export interface Milestone {
  id: number;
  userId: string;
  projectId?: number; // optional
  repositoryId?: number; // optional
  title: string;
  rawInput?: string;
  deadline?: string; // ISO 8601 date
  status: "active" | "completed" | "cancelled";
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
