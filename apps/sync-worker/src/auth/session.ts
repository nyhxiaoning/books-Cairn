const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;

export interface Session {
  readonly adminId: string;
  readonly expiresAt: string;
  readonly lastUsedAt: string;
}

interface SessionRow {
  readonly admin_id: string;
  readonly expires_at: string;
  readonly last_used_at: string;
}

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');

const digestToken = async (token: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const createSession = async (
  db: D1Database,
  adminId: string,
  now: Date,
): Promise<{ token: string; expiresAt: string }> => {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  const tokenHash = await digestToken(token);

  await db
    .prepare(
      'INSERT INTO sessions (token_hash, admin_id, expires_at, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(tokenHash, adminId, expiresAt, now.toISOString(), now.toISOString())
    .run();

  return { token, expiresAt };
};

export const readSession = async (
  db: D1Database,
  token: string,
  now: Date,
): Promise<Session | undefined> => {
  const tokenHash = await digestToken(token);
  const row = await db
    .prepare(
      'SELECT admin_id, expires_at, last_used_at FROM sessions WHERE token_hash = ? AND expires_at > ?',
    )
    .bind(tokenHash, now.toISOString())
    .first<SessionRow>();

  if (!row) return undefined;

  await db
    .prepare('UPDATE sessions SET last_used_at = ? WHERE token_hash = ?')
    .bind(now.toISOString(), tokenHash)
    .run();

  return {
    adminId: row.admin_id,
    expiresAt: row.expires_at,
    lastUsedAt: now.toISOString(),
  };
};

export const revokeSession = async (db: D1Database, token: string): Promise<void> => {
  await db
    .prepare('DELETE FROM sessions WHERE token_hash = ?')
    .bind(await digestToken(token))
    .run();
};
