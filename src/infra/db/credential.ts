import { sql } from "@/infra/db/connection";

interface InsertCredentialInput {
  userId: string;
  provider: string;
  credential: string;
  label: string | null;
  metadata: string | null;
}

interface UpdateCredentialInput {
  credential: string;
  label: string | null;
  metadata: string | null;
}

export async function insertCredential(input: InsertCredentialInput): Promise<void> {
  const metadataValue = input.metadata ? sql.json(JSON.parse(input.metadata)) : null;
  await sql`
    INSERT INTO user_credentials (user_id, provider, credential, label, metadata)
    VALUES (${input.userId}, ${input.provider}, ${input.credential}, ${input.label}, ${metadataValue})
  `;
}

export async function getCredentialsByUser(userId: string): Promise<any[]> {
  return await sql`
    SELECT id, user_id, provider, credential, label, metadata, created_at, updated_at
    FROM user_credentials
    WHERE user_id = ${userId}
  `;
}

export async function getCredentialByUserAndProvider(userId: string, provider: string): Promise<any | undefined> {
  const [row] = await sql`
    SELECT id, user_id, provider, credential, label, metadata, created_at, updated_at
    FROM user_credentials
    WHERE user_id = ${userId} AND provider = ${provider}
  `;
  return row;
}

export async function getCredentialsByUserAndProvider(userId: string, provider: string): Promise<any[]> {
  return await sql`
    SELECT id, user_id, provider, credential, label, metadata, created_at, updated_at
    FROM user_credentials
    WHERE user_id = ${userId} AND provider = ${provider}
  `;
}

export async function getCredentialById(id: number): Promise<any | undefined> {
  const [row] = await sql`
    SELECT id, user_id, provider, credential, label, metadata, created_at, updated_at
    FROM user_credentials
    WHERE id = ${id}
  `;
  return row;
}

export async function updateCredential(id: number, input: UpdateCredentialInput): Promise<void> {
  const metadataValue = input.metadata ? sql.json(JSON.parse(input.metadata)) : null;
  await sql`
    UPDATE user_credentials
    SET credential = ${input.credential},
        label = ${input.label},
        metadata = ${metadataValue},
        updated_at = NOW()
    WHERE id = ${id}
  `;
}

export async function deleteCredential(id: number): Promise<void> {
  await sql`DELETE FROM user_credentials WHERE id = ${id}`;
}
