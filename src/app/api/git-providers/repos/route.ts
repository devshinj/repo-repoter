import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { getCredentialById } from "@/infra/db/credential";
import { decrypt } from "@/infra/crypto/token-encryption";
import { listGitHubRepos } from "@/infra/git-provider/github-api";
import { listGiteaRepos } from "@/infra/git-provider/gitea-api";
import { listGitLabRepos } from "@/infra/git-provider/gitlab-api";
import { listBitbucketRepos } from "@/infra/git-provider/bitbucket-api";
import type { GitProviderMeta } from "@/core/types";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const credentialId = request.nextUrl.searchParams.get("credentialId");
  if (!credentialId) {
    return NextResponse.json({ error: "credentialId is required" }, { status: 400 });
  }

  const db = getDb();
  const cred = getCredentialById(db, Number(credentialId));
  if (!cred) {
    return NextResponse.json({ error: "Credential not found" }, { status: 404 });
  }
  if (cred.user_id !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const meta: GitProviderMeta | null = cred.metadata ? JSON.parse(cred.metadata) : null;
  if (!meta?.type) {
    return NextResponse.json({ error: "Credential has no provider metadata" }, { status: 400 });
  }

  const token = decrypt(cred.credential);

  try {
    if (meta.type === "github") {
      const repos = await listGitHubRepos(token);
      return NextResponse.json(repos);
    }
    if (meta.type === "gitea") {
      const repos = await listGiteaRepos(meta.apiBase, token);
      return NextResponse.json(repos);
    }
    if (meta.type === "gitlab") {
      const repos = await listGitLabRepos(meta.apiBase, token);
      return NextResponse.json(repos);
    }
    if (meta.type === "bitbucket") {
      const repos = await listBitbucketRepos(meta.apiBase, token);
      return NextResponse.json(repos);
    }
    return NextResponse.json({ error: `Unsupported provider type: ${meta.type}` }, { status: 400 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
