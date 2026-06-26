import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { initDb, sql, closeSql } from "@/infra/db/connection";
import {
  insertCredential,
  getCredentialsByUser,
  getCredentialByUserAndProvider,
  getCredentialsByUserAndProvider,
  getCredentialById,
  updateCredential,
  deleteCredential,
} from "@/infra/db/credential";

describe("credential repository", () => {
  beforeAll(async () => {
    await initDb();
  });

  afterEach(async () => {
    await sql`DO $$ DECLARE r RECORD; BEGIN FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE'; END LOOP; END $$`;
  });

  afterAll(async () => {
    await closeSql();
  });

  it("should insert and retrieve a credential", async () => {
    await insertCredential({
      userId: "user1",
      provider: "git",
      credential: "encrypted-token",
      label: "GitHub PAT",
      metadata: null,
    });

    const creds = await getCredentialsByUser("user1");
    expect(creds).toHaveLength(1);
    expect(creds[0].provider).toBe("git");
    expect(creds[0].credential).toBe("encrypted-token");
    expect(creds[0].label).toBe("GitHub PAT");
  });

  it("should get credential by user and provider", async () => {
    await insertCredential({
      userId: "user1",
      provider: "git",
      credential: "encrypted-git",
      label: null,
      metadata: null,
    });
    await insertCredential({
      userId: "user1",
      provider: "notion",
      credential: "encrypted-notion",
      label: null,
      metadata: JSON.stringify({ notionCommitDbId: "db1", notionTaskDbId: "db2" }),
    });

    const git = await getCredentialByUserAndProvider("user1", "git");
    expect(git?.credential).toBe("encrypted-git");

    const notion = await getCredentialByUserAndProvider("user1", "notion");
    expect(notion?.credential).toBe("encrypted-notion");
    // PostgreSQL JSONB stores parsed objects, so compare parsed form
    expect(notion?.metadata).toEqual({ notionCommitDbId: "db1", notionTaskDbId: "db2" });
  });

  it("should update a credential", async () => {
    await insertCredential({
      userId: "user1",
      provider: "git",
      credential: "old-token",
      label: null,
      metadata: null,
    });

    const cred = (await getCredentialByUserAndProvider("user1", "git"))!;
    await updateCredential(cred.id, {
      credential: "new-token",
      label: "Updated PAT",
      metadata: null,
    });

    const updated = (await getCredentialByUserAndProvider("user1", "git"))!;
    expect(updated.credential).toBe("new-token");
    expect(updated.label).toBe("Updated PAT");
  });

  it("should delete a credential", async () => {
    await insertCredential({
      userId: "user1",
      provider: "git",
      credential: "token",
      label: null,
      metadata: null,
    });

    const cred = (await getCredentialByUserAndProvider("user1", "git"))!;
    await deleteCredential(cred.id);

    const result = await getCredentialsByUser("user1");
    expect(result).toHaveLength(0);
  });

  it("should get all credentials by user and provider", async () => {
    await insertCredential({
      userId: "user1",
      provider: "git",
      credential: "token1",
      label: "회사",
      metadata: null,
    });
    await insertCredential({
      userId: "user1",
      provider: "git",
      credential: "token2",
      label: "개인",
      metadata: null,
    });

    const creds = await getCredentialsByUserAndProvider("user1", "git");
    expect(creds).toHaveLength(2);
  });

  it("should get credential by id", async () => {
    await insertCredential({
      userId: "user1",
      provider: "git",
      credential: "token1",
      label: "테스트",
      metadata: null,
    });

    const all = await getCredentialsByUser("user1");
    const cred = await getCredentialById(all[0].id);
    expect(cred).toBeDefined();
    expect(cred!.credential).toBe("token1");
  });

  it("should allow multiple credentials for same user and provider", async () => {
    await insertCredential({
      userId: "user1",
      provider: "git",
      credential: "token1",
      label: "회사 GitHub",
      metadata: null,
    });
    await insertCredential({
      userId: "user1",
      provider: "git",
      credential: "token2",
      label: "개인 GitHub",
      metadata: null,
    });

    const creds = await getCredentialsByUser("user1");
    expect(creds).toHaveLength(2);
    expect(creds.map((c: any) => c.label)).toContain("회사 GitHub");
    expect(creds.map((c: any) => c.label)).toContain("개인 GitHub");
  });
});
