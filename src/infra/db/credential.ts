import Database from "better-sqlite3";

interface InsertCredentialInput {
  userId: string;
  provider: "git" | "notion";
  credential: string;
  label: string | null;
  metadata: string | null;
}

interface UpdateCredentialInput {
  credential: string;
  label: string | null;
  metadata: string | null;
}

export function insertCredential(db: Database.Database, input: InsertCredentialInput): void {
  db.prepare(
    "INSERT INTO user_credentials (user_id, provider, credential, label, metadata) VALUES (?, ?, ?, ?, ?)"
  ).run(input.userId, input.provider, input.credential, input.label, input.metadata);
}

export function getCredentialsByUser(db: Database.Database, userId: string) {
  return db.prepare("SELECT * FROM user_credentials WHERE user_id = ?").all(userId) as any[];
}

export function getCredentialByUserAndProvider(db: Database.Database, userId: string, provider: string) {
  return db.prepare(
    "SELECT * FROM user_credentials WHERE user_id = ? AND provider = ?"
  ).get(userId, provider) as any | undefined;
}

export function updateCredential(db: Database.Database, id: number, input: UpdateCredentialInput): void {
  db.prepare(
    "UPDATE user_credentials SET credential = ?, label = ?, metadata = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(input.credential, input.label, input.metadata, id);
}

export function deleteCredential(db: Database.Database, id: number): void {
  db.prepare("DELETE FROM user_credentials WHERE id = ?").run(id);
}
