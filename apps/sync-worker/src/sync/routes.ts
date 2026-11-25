import { readSession } from '../auth/session';
import { isBookId } from '../../../../packages/core/src/store/library';
import { buildSyncManifest, isSyncablePath, resourceKey, syncContentType, type SyncFile, type SyncManifest } from '../../../../packages/core/src/sync/manifest';
import { sha256, validResourceMetadata } from './resources';
import { nextVersion, sameHash, validBaseVersion, type VersionedMutation } from './versions';
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
  readonly stations?: number;
  readonly minutes?: number;
  readonly complete?: number;
  readonly built?: number;
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
  stations: book.stations ?? 0, minutes: book.minutes ?? 0, budgetId: book.budget_id,
  generatedAt: book.generated_at, complete: (book.complete ?? 1) !== 0, built: book.built ?? 0,
  ...(book.language ? { language: book.language as SyncManifest['language'] } : {}),
  ...(book.voice ? { voice: book.voice } : {}), version: book.version,
  resources: resources.map((resource) => ({
    path: resource.path, contentType: resource.content_type, byteSize: resource.byte_size,
    contentHash: resource.content_hash,
  })),
});

const readManifest = async (env: Env, adminId: string): Promise<SyncManifest[]> => {
  const result = await env.DB.prepare('SELECT id, title, author, budget_id, language, voice, generated_at, version, stations, minutes, complete, built, deleted_at FROM books WHERE admin_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC').bind(adminId).all<BookRow>();
  const manifests: SyncManifest[] = [];
  for (const book of result.results) {
    const resources = await env.DB.prepare('SELECT path, content_type, byte_size, content_hash, version, updated_at FROM book_resources WHERE book_id = ? ORDER BY path').bind(book.id).all<ResourceRow>();
    manifests.push(toManifest(book, resources.results));
  }
  return manifests;
};

type ManifestMutation = SyncManifest & VersionedMutation;

const manifestBody = async (request: Request): Promise<ManifestMutation | undefined> => {
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_MANIFEST_BYTES)) return undefined;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_MANIFEST_BYTES) return undefined;
  try {
    const value = JSON.parse(text) as ManifestMutation;
    if (!value || typeof value.bookId !== 'string' || !isBookId(value.bookId) || typeof value.title !== 'string' ||
      !Number.isSafeInteger(value.stations) || !Number.isSafeInteger(value.minutes) || !Number.isSafeInteger(value.built) || typeof value.complete !== 'boolean' || typeof value.budgetId !== 'string' ||
      typeof value.generatedAt !== 'string' || !Array.isArray(value.resources) || !validBaseVersion(value.baseVersion) ||
      value.stations < 0 || value.minutes < 0 || value.built < 0) return undefined;
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
  const existing = await env.DB.prepare('SELECT id, admin_id, title, author, budget_id, language, voice, generated_at, version, stations, minutes, complete, built, deleted_at FROM books WHERE id = ?').bind(bookId).first<BookRow & { admin_id: string }>();
  if (existing && existing.admin_id !== adminId) return error('not_found', 'Book not found.', 404);
  const currentResources = existing && existing.deleted_at === null
    ? (await env.DB.prepare('SELECT path, content_type, byte_size, content_hash, version, updated_at FROM book_resources WHERE book_id = ? ORDER BY path').bind(bookId).all<ResourceRow>()).results
    : [];
  if (existing !== null && existing.deleted_at !== null) {
    return json({ code: 'book_deleted', message: 'Book has been deleted.', cloudManifest: { ...toManifest(existing, []), deleted: true } }, 409);
  }
  if (existing === null && manifest.baseVersion !== undefined && manifest.baseVersion !== 0) {
    return json({ code: 'stale_version', cloudManifest: undefined }, 409);
  }
  if (existing && manifest.baseVersion !== existing.version) {
    return json({ code: 'stale_version', cloudManifest: toManifest(existing, currentResources) }, 409);
  }
  const unchanged = existing !== null && existing.deleted_at === null &&
    existing.title === manifest.title && existing.author === (manifest.author ?? null) &&
    existing.budget_id === manifest.budgetId && existing.language === (manifest.language ?? 'en') &&
    existing.voice === (manifest.voice ?? '') && existing.generated_at === manifest.generatedAt &&
    (existing.stations ?? 0) === manifest.stations && (existing.minutes ?? 0) === manifest.minutes &&
    (existing.complete ?? 1) !== 0 === manifest.complete && (existing.built ?? 0) === manifest.built &&
    currentResources.length === manifest.resources.length &&
    manifest.resources.every((resource) => currentResources.some((current) => current.path === resource.path && current.content_hash === resource.contentHash && current.content_type === resource.contentType && current.byte_size === resource.byteSize));
  if (unchanged) return json({ bookId, version: existing.version, resources: manifest.resources.length });
  const now = new Date().toISOString();
  const version = existing ? nextVersion(existing.version) : 1;
  if (!existing) {
    await env.DB.prepare('INSERT INTO books (id, admin_id, title, author, version, stations, minutes, complete, built, budget_id, language, voice, generated_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(bookId, adminId, manifest.title, manifest.author ?? null, version, manifest.stations, manifest.minutes, manifest.complete ? 1 : 0, manifest.built, manifest.budgetId, manifest.language ?? 'en', manifest.voice ?? '', manifest.generatedAt, now, now).run();
  } else {
    const updated = await env.DB.prepare('UPDATE books SET title = ?, author = ?, version = ?, stations = ?, minutes = ?, complete = ?, built = ?, budget_id = ?, language = ?, voice = ?, generated_at = ?, updated_at = ? WHERE id = ? AND admin_id = ? AND version = ? AND deleted_at IS NULL').bind(manifest.title, manifest.author ?? null, version, manifest.stations, manifest.minutes, manifest.complete ? 1 : 0, manifest.built, manifest.budgetId, manifest.language ?? 'en', manifest.voice ?? '', manifest.generatedAt, now, bookId, adminId, existing.version).run();
    if (updated.meta?.changes === 0) {
      const cloud = await cloudManifest(env, adminId, bookId);
      return json({ code: 'stale_version', cloudManifest: cloud }, 409);
    }
  }
  if (manifest.resources.length === 0) {
    await env.DB.prepare('DELETE FROM book_resources WHERE book_id = ?').bind(bookId).run();
  } else {
    const placeholders = manifest.resources.map(() => '?').join(', ');
    await env.DB.prepare(`DELETE FROM book_resources WHERE book_id = ? AND path NOT IN (${placeholders})`).bind(bookId, ...manifest.resources.map((resource) => resource.path)).run();
  }
  for (const resource of manifest.resources) {
    await env.DB.prepare('INSERT INTO book_resources (book_id, path, content_type, byte_size, content_hash, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(book_id, path) DO UPDATE SET content_type = excluded.content_type, byte_size = excluded.byte_size, content_hash = excluded.content_hash, version = excluded.version, updated_at = excluded.updated_at').bind(bookId, resource.path, resource.contentType, resource.byteSize, resource.contentHash, version, now).run();
  }
  return json({ bookId, version, resources: manifest.resources.length }, existing ? 200 : 201);
};

const cloudManifest = async (env: Env, adminId: string, bookId: string): Promise<SyncManifest | undefined> => {
  const book = await env.DB.prepare('SELECT id, title, author, budget_id, language, voice, generated_at, version, stations, minutes, complete, built, deleted_at FROM books WHERE id = ? AND admin_id = ?').bind(bookId, adminId).first<BookRow>();
  if (!book) return undefined;
  const resources = await env.DB.prepare('SELECT path, content_type, byte_size, content_hash, version, updated_at FROM book_resources WHERE book_id = ? ORDER BY path').bind(bookId).all<ResourceRow>();
  return toManifest(book, resources.results);
};

const bookFor = async (env: Env, adminId: string, bookId: string): Promise<BookRow | undefined> =>
  (await env.DB.prepare('SELECT id, title, author, budget_id, language, voice, generated_at, version, stations, minutes, complete, built, deleted_at FROM books WHERE id = ? AND admin_id = ? AND deleted_at IS NULL').bind(bookId, adminId).first<BookRow>()) ?? undefined;

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
  const baseVersionText = request.headers.get('x-base-version');
  const baseVersion = baseVersionText === null || !/^\d+$/.test(baseVersionText) ? undefined : Number(baseVersionText);
  if (baseVersionText === null || !validBaseVersion(baseVersion) || baseVersion !== book.version) {
    const cloud = await cloudManifest(env, adminId, bookId);
    return json({ code: 'stale_version', cloudManifest: cloud }, 409);
  }
  const existing = await env.DB.prepare('SELECT content_hash FROM book_resources WHERE book_id = ? AND path = ?').bind(bookId, path).first<{ content_hash: string }>();
  if (sameHash(existing?.content_hash, contentHash)) return json({ bookId, path, version: book.version, contentHash, byteSize: bytes.byteLength });
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

interface ProgressRow {
  readonly book_id: string;
  readonly station_id: string | null;
  readonly updated_at: string;
}

const progressBody = async (request: Request): Promise<{ stationId: string | null; updatedAt: string } | undefined> => {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 16 * 1024) return undefined;
  try {
    const value = JSON.parse(text) as { stationId?: unknown; updatedAt?: unknown };
    const stationId = value.stationId === undefined || value.stationId === null ? null : value.stationId;
    if (stationId !== null && (typeof stationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(stationId))) return undefined;
    const updatedAt = value.updatedAt === undefined ? new Date().toISOString() : value.updatedAt;
    if (typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt))) return undefined;
    return { stationId, updatedAt: new Date(updatedAt).toISOString() };
  } catch {
    return undefined;
  }
};

const getProgress = async (env: Env, request: Request, bookId: string): Promise<Response> => {
  const adminId = await authenticate(request, env);
  if (adminId instanceof Response) return adminId;
  if (!isBookId(bookId) || !(await bookFor(env, adminId, bookId))) return error('not_found', 'Book not found.', 404);
  const progress = await env.DB.prepare('SELECT book_id, station_id, updated_at FROM reading_progress WHERE book_id = ?').bind(bookId).first<ProgressRow>();
  return json({ bookId, stationId: progress?.station_id ?? null, updatedAt: progress?.updated_at ?? null });
};

const putProgress = async (env: Env, request: Request, bookId: string): Promise<Response> => {
  const adminId = await authenticate(request, env);
  if (adminId instanceof Response) return adminId;
  if (!isBookId(bookId) || !(await bookFor(env, adminId, bookId))) return error('not_found', 'Book not found.', 404);
  const progress = await progressBody(request);
  if (!progress) return error('invalid_progress', 'Progress is invalid.', 400);
  const current = await env.DB.prepare('SELECT book_id, station_id, updated_at FROM reading_progress WHERE book_id = ?').bind(bookId).first<ProgressRow>();
  if (current && progress.updatedAt <= current.updated_at) return json({ bookId, stationId: current.station_id, updatedAt: current.updated_at, applied: false });
  await env.DB.prepare('INSERT INTO reading_progress (book_id, station_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(book_id) DO UPDATE SET station_id = excluded.station_id, updated_at = excluded.updated_at').bind(bookId, progress.stationId, progress.updatedAt).run();
  return json({ bookId, stationId: progress.stationId, updatedAt: progress.updatedAt, applied: true });
};

const deleteBook = async (env: Env, request: Request, bookId: string): Promise<Response> => {
  const adminId = await authenticate(request, env);
  if (adminId instanceof Response) return adminId;
  if (!isBookId(bookId)) return error('invalid_book_id', 'Book id is invalid.', 400);
  const book = await env.DB.prepare('SELECT id, title, author, budget_id, language, voice, generated_at, version, stations, minutes, complete, built, deleted_at FROM books WHERE id = ? AND admin_id = ?').bind(bookId, adminId).first<BookRow>();
  if (!book) return error('not_found', 'Book not found.', 404);
  if (book.deleted_at !== null) return json({ bookId, version: book.version, deleted: true });
  const baseVersion = request.headers.get('x-base-version');
  if (baseVersion !== null && (!/^\d+$/.test(baseVersion) || Number(baseVersion) !== book.version)) {
    const cloud = await cloudManifest(env, adminId, bookId);
    return json({ code: 'stale_version', cloudManifest: cloud }, 409);
  }
  const now = new Date().toISOString();
  const version = nextVersion(book.version);
  const updated = await env.DB.prepare('UPDATE books SET version = ?, deleted_at = ?, updated_at = ? WHERE id = ? AND admin_id = ? AND version = ? AND deleted_at IS NULL').bind(version, now, now, bookId, adminId, book.version).run();
  if (updated.meta?.changes === 0) {
    const cloud = await cloudManifest(env, adminId, bookId);
    return json({ code: 'stale_version', cloudManifest: cloud }, 409);
  }
  const prefix = `admins/${adminId}/books/${bookId}/`;
  let cursor: string | undefined;
  while (true) {
    const listed = await env.BOOKS.list(cursor === undefined ? { prefix } : { prefix, cursor });
    await Promise.all(listed.objects.map((object) => env.BOOKS.delete(object.key)));
    if (!listed.truncated) break;
    cursor = listed.cursor;
  }
  return json({ bookId, version, deleted: true });
};

export const handleSyncRequest = async (request: Request, env: Env): Promise<Response> => {
  try {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/sync/manifest') return getManifest(env, request);
    const progressMatch = url.pathname.match(/^\/api\/sync\/progress\/([^/]+)$/);
    if (progressMatch?.[1]) {
      const bookId = decodeURIComponent(progressMatch[1]);
      if (request.method === 'GET') return getProgress(env, request, bookId);
      if (request.method === 'PUT') return putProgress(env, request, bookId);
    }
    const manifestMatch = url.pathname.match(/^\/api\/sync\/books\/([^/]+)\/manifest$/);
    if (request.method === 'PUT' && manifestMatch?.[1]) return putManifest(env, request, decodeURIComponent(manifestMatch[1]));
    const deleteMatch = url.pathname.match(/^\/api\/sync\/books\/([^/]+)$/);
    if (request.method === 'DELETE' && deleteMatch?.[1]) return deleteBook(env, request, decodeURIComponent(deleteMatch[1]));
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
