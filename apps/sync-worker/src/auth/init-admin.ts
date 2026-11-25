import { hashPassword } from './password';

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,127}$/;
const MAX_PASSWORD_LENGTH = 256;

export interface AdminCredentials {
  readonly username: string;
  readonly password: string;
}

export interface AdminInitResult {
  readonly id: string;
  readonly username: string;
}

export const normalizeUsername = (value: string): string => value.trim().toLowerCase();

export const validateAdminCredentials = (
  credentials: AdminCredentials,
): string | undefined => {
  const username = normalizeUsername(credentials.username);
  if (!USERNAME_PATTERN.test(username)) return 'invalid_username';
  if (credentials.password.length < 8 || credentials.password.length > MAX_PASSWORD_LENGTH) {
    return 'invalid_password';
  }
  return undefined;
};

export const initializeAdmin = async (
  db: D1Database,
  credentials: AdminCredentials,
  now: Date,
): Promise<AdminInitResult> => {
  const username = normalizeUsername(credentials.username);
  const passwordHash = await hashPassword(credentials.password);
  const id = crypto.randomUUID();

  await db
    .prepare(
      'INSERT INTO admin_account (id, username_normalized, password_hash, created_at) VALUES (?, ?, ?, ?)',
    )
    .bind(id, username, JSON.stringify(passwordHash), now.toISOString())
    .run();

  return { id, username };
};
