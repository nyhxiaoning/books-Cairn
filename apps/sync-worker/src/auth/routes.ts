import {
  initializeAdmin,
  normalizeUsername,
  validateAdminCredentials,
  type AdminCredentials,
} from './init-admin';
import { verifyPassword, type PasswordHash } from './password';
import { createSession, readSession, revokeSession } from './session';

const SESSION_COOKIE = 'cairn_session';
const INIT_SECRET_HEADER = 'x-admin-init-secret';
const MAX_BODY_BYTES = 8 * 1024;
const MAX_INIT_SECRET_LENGTH = 256;

export interface AuthEnv {
  readonly DB: D1Database;
  readonly ADMIN_INIT_SECRET?: string;
}

interface AdminRow {
  readonly id: string;
  readonly username_normalized: string;
  readonly password_hash: string;
}

interface CredentialsBody {
  readonly username?: unknown;
  readonly password?: unknown;
}

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };

const json = (body: unknown, status = 200, headers?: HeadersInit): Response => {
  const responseHeaders = new Headers(jsonHeaders);
  if (headers) {
    new Headers(headers).forEach((value, key) => responseHeaders.set(key, value));
  }
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
};

const error = (code: string, message: string, status: number): Response =>
  json({ code, message }, status);

const clearCookie = (): string =>
  `${SESSION_COOKIE}=; Max-Age=0; Path=/api; HttpOnly; Secure; SameSite=Strict`;

const sessionCookie = (token: string, expiresAt: string): string => {
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  return `${SESSION_COOKIE}=${token}; Max-Age=${maxAge}; Path=/api; HttpOnly; Secure; SameSite=Strict`;
};

const cookieValue = (request: Request): string | undefined => {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name === SESSION_COOKIE) return part.slice(separator + 1).trim() || undefined;
  }
  return undefined;
};

const readCredentials = async (request: Request): Promise<AdminCredentials | undefined> => {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) {
    return undefined;
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return undefined;

  let parsed: CredentialsBody;
  try {
    parsed = JSON.parse(body) as CredentialsBody;
  } catch {
    return undefined;
  }
  if (typeof parsed.username !== 'string' || typeof parsed.password !== 'string') return undefined;
  return { username: parsed.username, password: parsed.password };
};

const invalidCredentials = (): Response =>
  error('invalid_credentials', 'Username or password is incorrect.', 401);

const login = async (request: Request, env: AuthEnv): Promise<Response> => {
  const credentials = await readCredentials(request);
  if (!credentials || validateAdminCredentials(credentials)) return invalidCredentials();

  const username = normalizeUsername(credentials.username);
  const row = await env.DB
    .prepare('SELECT id, username_normalized, password_hash FROM admin_account WHERE username_normalized = ?')
    .bind(username)
    .first<AdminRow>();
  if (!row || row.username_normalized !== username) return invalidCredentials();

  let stored: PasswordHash;
  try {
    stored = JSON.parse(row.password_hash) as PasswordHash;
  } catch {
    return invalidCredentials();
  }
  if (!(await verifyPassword(credentials.password, stored))) return invalidCredentials();

  const session = await createSession(env.DB, row.id, new Date());
  return json(
    { expiresAt: session.expiresAt },
    200,
    { 'set-cookie': sessionCookie(session.token, session.expiresAt) },
  );
};

const logout = async (request: Request, env: AuthEnv): Promise<Response> => {
  const token = cookieValue(request);
  if (token) await revokeSession(env.DB, token);
  return json({ ok: true }, 200, { 'set-cookie': clearCookie() });
};

const init = async (request: Request, env: AuthEnv): Promise<Response> => {
  const suppliedSecret = request.headers.get(INIT_SECRET_HEADER);
  if (!env.ADMIN_INIT_SECRET || !suppliedSecret || suppliedSecret.length > MAX_INIT_SECRET_LENGTH || suppliedSecret !== env.ADMIN_INIT_SECRET) {
    return error('init_not_authorized', 'Administrator initialization is not authorized.', 403);
  }

  const credentials = await readCredentials(request);
  if (!credentials) return error('invalid_request', 'Request body is invalid.', 400);
  const validationError = validateAdminCredentials(credentials);
  if (validationError) return error(validationError, 'Administrator credentials are invalid.', 400);

  const existing = await env.DB.prepare('SELECT id FROM admin_account LIMIT 1').first<{ id: string }>();
  if (existing) return error('admin_exists', 'An administrator is already initialized.', 409);

  try {
    const admin = await initializeAdmin(env.DB, credentials, new Date());
    return json({ id: admin.id, username: admin.username }, 201);
  } catch {
    return error('admin_exists', 'An administrator is already initialized.', 409);
  }
};

export const handleAuthRequest = async (request: Request, env: AuthEnv): Promise<Response> => {
  const path = new URL(request.url).pathname;
  try {
    if (request.method === 'POST' && path === '/api/auth/login') return login(request, env);
    if (request.method === 'POST' && path === '/api/auth/logout') return logout(request, env);
    if (request.method === 'POST' && path === '/api/auth/init') return init(request, env);
    return error('not_found', 'Not found', 404);
  } catch {
    return error('internal_error', 'Internal server error.', 500);
  }
};
