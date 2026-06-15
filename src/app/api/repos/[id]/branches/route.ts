import { NextRequest, NextResponse } from "next/server";
import { getRepositoryByIdAndUser } from "@/infra/db/repository";
import { getCredentialById, getCredentialByUserAndProvider } from "@/infra/db/credential";
import { decrypt } from "@/infra/crypto/token-encryption";
import { createGitProvider, inferProviderMeta } from "@/infra/git-provider";
import type { GitProviderMeta } from "@/core/types";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  try {
    const repo = getRepositoryByIdAndUser(db, Number(id), session.user.id);
    if (!repo) return NextResponse.json({ error: "Repository not found" }, { status: 404 });

    const gitCred = repo.credential_id
      ? getCredentialById(db, repo.credential_id)
      : getCredentialByUserAndProvider(db, session.user.id, "git");
    if (!gitCred) return NextResponse.json({ error: "Git PAT not configured" }, { status: 400 });

    const token = decrypt(gitCred.credential);
    const meta: GitProviderMeta = gitCred.metadata
      ? JSON.parse(gitCred.metadata)
      : inferProviderMeta(repo.clone_url);

    const provider = createGitProvider(meta, token);
    const branches = await provider.listBranches(repo.owner, repo.repo);

    return NextResponse.json(branches.map(b => b.name));
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
