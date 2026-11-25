import { readSession } from '../auth/session';
import { isBookId } from '../../../../packages/core/src/store/library';
import { buildSyncManifest, isSyncablePath, resourceKey, syncContentType, type SyncFile, type SyncManifest } from '../../../../packages/core/src/sync/manifest';
import { sha256, validResourceMetadata } from './resources';
import type { Env } from '../index';

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_RESOURCE_BYTES = 64 * 1024 * 1024;

const json = (body: unknown, status = 200, headers?: HeadersInit): Response => {
  const responseHeaders = new Headers(jsonHeaders);
  if (headers) new Headers(headers).forEach((value, key) => responseHeaders.set(key, value));
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
};
const error = (code: string, message: string, status: number): Response => json({ code, message }, status);

const cookieValue = (request: Request): string | undefined => {
  const cookie = request.headers.get('cookie');
  if (!cookie) return undefined;
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator >= 0 && part.slice(0, separator).trim() === 'cairn_session') return part.slice(separator + 1).trim() || undefined;
  }
  return undefined;
};

const authenticate = async (request: Request, env: Env): Promise<string | Response> => {
  const token = cookieValue(request);
  const session = token ? await readSession(env.DB, token, new Date()) : undefined;
  return session?.adminId ?? error('unauthorized', 'Authentication is required.', 401);
};

interface BookRow {
  readonly id: string;
  readonly title: string;
  readonly author: string | null;
  readonly budget_id: string;
  readonly language: string;
  readonly voice: string;
  readonly generated_at: string;
  readonly version: number;
  readonly deleted_at: string | null;
}

interface ResourceRow {
  readonly path: string;
  readonly content_type: string;
  readonly byte_size: number;
  readonly content_hash: string;
  readonly version: number;
  readonly updated_at: string;
}

const toManifest = (book: BookRow, resources: readonly ResourceRow[]): SyncManifest => ({
  bookId: book.id, title: book.title, ...(book.author === null ? {} : { author: book.author }),
  stations: 0, minutes: 0, budgetId: book.budget_id,
  generatedAt: book.generated_at, complete: true, built: 0,
  ...(book.language ? { language: book.language as SyncManifest['language'] } : {}),
  ...(book.voice ? { voice: book.voice } : {}), version: book.version,
  resources: resources.map((resource) => ({
    path: resource.path, contentType: resource.content_type, byteSize: resource.byte_size,
    contentHash: resource.content_hash,
  })),
});

const readManifest = async (env: Env, adminId: string): Promise<SyncManifest[]> => {
  const result = await env.DB.prepare('SELECT id, title, author, budget_id, language, voice, generated_at, version, deleted_at FROM books WHERE admin_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC').bind(adminId).all<BookRow>();
  const manifests: SyncManifest[] = [];
  for (const book of result.results) {
    const resources = await env.DB.prepare('SELECT path, content_type, byte_size, content_hash, version, updated_at FROM book_resources WHERE book_id = ? ORDER BY path').bind(book.id).all<ResourceRow>();
    manifests.push(toManifest(book, resources.results));
  }
  return manifests;
};

const manifestBody = async (request: Request): Promise<SyncManifest | undefined> => {
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_MANIFEST_BYTES)) return undefined;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_MANIFEST_BYTES) return undefined;
  try {
    const value = JSON.parse(text) as SyncManifest;
    if (!value || typeof value.bookId !== 'string' || !isBookId(value.bookId) || typeof value.title !== 'string' ||
      !Number.isSafeInteger(value.stations) || !Number.isSafeInteger(value.minutes) || typeof value.budgetId !== 'string' ||
      typeof value.generatedAt !== 'string' || !Array.isArray(value.resources)) return undefined;
    if (!value.resources.every((resource) => resource && validResourceMetadata(resource))) return undefined;
    return value;
  } catch {
    return undefined;
  }
};

const getManifest = async (env: Env, request: Request): Promise<Response> => {
  const adminId = await authenticate(request, env);
  if (adminId instanceof Response) return adminId;
  return json({ books: await readManifest(env, adminId) });
};

const putManifest = async (env: Env, request: Request, bookId: string): Promise<Response> => {
  const adminId = await authenticate(request, env);
  if (adminId instanceof Response) return adminId;
  if (!isBookId(bookId)) return error('invalid_book_id', 'Book id is invalid.', 400);
  const manifest = await manifestBody(request);
  if (!manifest || manifest.bookId !== bookId) return error('invalid_manifest', 'Manifest is invalid.', 400);
  const existing = await env.DB.prepare('SELECT id, admin_id FROM books WHERE id = ?').bind(bookId).first<{ id: string; admin_id: string }>();
  if (existing && existing.admin_id !== adminId) return error('not_found', 'Book not found.', 404);
  const now = new Date().toISOString();
  await env.DB.prepare('INSERT INTO books (id, admin_id, title, author, version, budget_id, language, voice, generated_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, author = excluded.author, budget_id = excluded.budget_id, language = excluded.language, voice = excluded.voice, generated_at = excluded.generated_at, updated_at = excluded.updated_at, deleted_at = NULL').bind(bookId, adminId, manifest.title, manifest.author ?? null, manifest.version, manifest.budgetId, manifest.language ?? 'en', manifest.voice ?? '', manifest.generatedAt, now, now).run();
  for (const resource of manifest.resources) {
    await env.DB.prepare('INSERT INTO book_resources (book_id, path, content_type, byte_size, content_hash, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(book_id, path) DO UPDATE SET content_type = excluded.content_type, byte_size = excluded.byte_size, content_hash = excluded.content_hash, version = excluded.version, updated_at = excluded.updated_at').bind(bookId, resource.path, resource.contentType, resource.byteSize, resource.contentHash, manifest.version, now).run();
  }
  return json({ bookId, version: manifest.version, resources: manifest.resources.length }, 201);
};

const bookFor = async (env: Env, adminId: string, bookId: string): Promise<BookRow | undefined> =>
  (await env.DB.prepare('SELECT id, title, author, budget_id, language, voice, generated_at, version, deleted_at FROM books WHERE id = ? AND admin_id = ? AND deleted_at IS NULL').bind(bookId, adminId).first<BookRow>()) ?? undefined;

const resourcePath = (url: URL, bookId: string): string | undefined => {
  const prefix = `/api/sync/books/${bookId}/resource/`;
  if (!url.pathname.startsWith(prefix)) return undefined;
  const encoded = url.pathname.slice(prefix.length);
  if (!encoded) return undefined;
  try { return encoded.split('/').map((part) => decodeURIComponent(part)).join('/'); } catch { return undefined; }
};

const putResource = async (env: Env, request: Request, bookId: string, path: string): Promise<Response> => {
  const adminId = await authenticate(request, env);
  if (adminId instanceof Response) return adminId;
  if (!isBookId(bookId) || !isSyncablePath(path)) return error('invalid_resource_path', 'Resource path is not allowed.', 400);
  const expectedType = syncContentType(path);
  if (request.headers.get('content-type') !== expectedType) return error('invalid_content_type', 'Content type is not allowed for this resource.', 415);
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESOURCE_BYTES)) return error('resource_too_large', 'Resource is too large.', 413);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_RESOURCE_BYTES || (length !== null && Number(length) !== bytes.byteLength)) return error('invalid_content_length', 'Content length is invalid.', 400);
  const contentHash = await sha256(bytes);
  if (request.headers.get('x-content-sha256') !== contentHash) return error('hash_mismatch', 'Resource hash does not match its content.', 400);
  const book = await bookFor(env, adminId, bookId);
  if (!book) return error('not_found', 'Book not found.', 404);
  await env.BOOKS.put(resourceKey(adminId, bookId, path), bytes, { httpMetadata: { contentType: expectedType } });
  const now = new Date().toISOString();
  await env.DB.prepare('INSERT INTO book_resources (book_id, path, content_type, byte_size, content_hash, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(book_id, path) DO UPDATE SET content_type = excluded.content_type, byte_size = excluded.byte_size, content_hash = excluded.content_hash, version = excluded.version, updated_at = excluded.updated_at').bind(bookId, path, expectedType, bytes.byteLength, contentHash, book.version, now).run();
  return json({ bookId, path, version: book.version, contentHash, byteSize: bytes.byteLength });
};

const getResource = async (env: Env, request: Request, bookId: string, path: string): Promise<Response> => {
  const adminId = await authenticate(request, env);
  if (adminId instanceof Response) return adminId;
  if (!isBookId(bookId) || !isSyncablePath(path)) return error('invalid_resource_path', 'Resource path is not allowed.', 400);
  if (!(await bookFor(env, adminId, bookId))) return error('not_found', 'Book not found.', 404);
  const object = await env.BOOKS.get(resourceKey(adminId, bookId, path));
  if (!object) return error('not_found', 'Resource not found.', 404);
  return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType ?? syncContentType(path) ?? 'application/octet-stream', 'content-length': String(object.size), etag: object.etag } });
};

export const handleSyncRequest = async (request: Request, env: Env): Promise<Response> => {
  try {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/sync/manifest') return getManifest(env, request);
    const manifestMatch = url.pathname.match(/^\/api\/sync\/books\/([^/]+)\/manifest$/);
    if (request.method === 'PUT' && manifestMatch?.[1]) return putManifest(env, request, decodeURIComponent(manifestMatch[1]));
    const resourceMatch = url.pathname.match(/^\/api\/sync\/books\/([^/]+)\/resource\//);
    if (resourceMatch?.[1]) {
      const bookId = decodeURIComponent(resourceMatch[1]);
      const path = resourcePath(url, bookId);
      if (!path) return error('invalid_resource_path', 'Resource path is not allowed.', 400);
      if (request.method === 'PUT') return putResource(env, request, bookId, path);
      if (request.method === 'GET') return getResource(env, request, bookId, path);
    }
    return error('not_found', 'Not found', 404);
  } catch {
    return error('internal_error', 'Internal server error.', 500);
  }
};
