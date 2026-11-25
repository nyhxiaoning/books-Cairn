import { expect, test } from 'bun:test';
import { createSession } from '../../src/auth/session';
import { sha256 } from '../../src/sync/resources';
import { app, type Env } from '../../src/index';

interface StoredBook {
  readonly id: string;
  readonly admin_id: string;
  readonly title: string;
  readonly author: string | null;
  readonly budget_id: string;
  readonly language: string;
  readonly voice: string;
  readonly generated_at: string;
  readonly version: number;
  readonly deleted_at: string | null;
}

interface StoredResource {
  readonly book_id: string;
  readonly path: string;
  readonly content_type: string;
  readonly byte_size: number;
  readonly content_hash: string;
  readonly version: number;
  readonly updated_at: string;
}

const makeEnvironment = async () => {
  const sessions = new Map<string, { admin_id: string; expires_at: string; last_used_at: string }>();
  const books = new Map<string, StoredBook>();
  const resources = new Map<string, StoredResource>();
  const database = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...bound: unknown[]) { values = bound; return statement; },
        async first<T>() {
          if (sql.startsWith('SELECT admin_id')) {
            const row = sessions.get(String(values[0]));
            if (!row || row.expires_at <= String(values[1])) return null;
            return row as T;
          }
          if (sql.includes('FROM books WHERE id = ?')) {
            const row = books.get(String(values[0]));
            return row && (values[1] === undefined || row.admin_id === String(values[1])) && row.deleted_at === null ? row as T : null;
          }
          return null;
        },
        async all<T>() {
          if (sql.includes('FROM books WHERE admin_id')) return { results: [...books.values()].filter((book) => book.admin_id === String(values[0]) && book.deleted_at === null) as T[] };
          if (sql.includes('FROM book_resources')) return { results: [...resources.values()].filter((resource) => resource.book_id === String(values[0])) as T[] };
          return { results: [] as T[] };
        },
        async run() {
          if (sql.startsWith('INSERT INTO sessions')) {
            sessions.set(String(values[0]), { admin_id: String(values[1]), expires_at: String(values[2]), last_used_at: String(values[4]) });
          } else if (sql.startsWith('UPDATE sessions')) {
            const row = sessions.get(String(values[1]));
            if (row) row.last_used_at = String(values[0]);
          } else if (sql.startsWith('INSERT INTO books')) {
            books.set(String(values[0]), {
              id: String(values[0]), admin_id: String(values[1]), title: String(values[2]), author: values[3] as string | null,
              version: Number(values[4]), budget_id: String(values[5]), language: String(values[6]), voice: String(values[7]),
              generated_at: String(values[8]), deleted_at: null,
            });
          } else if (sql.startsWith('INSERT INTO book_resources')) {
            resources.set(`${values[0]}/${values[1]}`, {
              book_id: String(values[0]), path: String(values[1]), content_type: String(values[2]), byte_size: Number(values[3]),
              content_hash: String(values[4]), version: Number(values[5]), updated_at: String(values[6]),
            });
          }
          return { success: true };
        },
      };
      return statement;
    },
  } as unknown as D1Database;

  const objects = new Map<string, Uint8Array>();
  const listCalls: Array<string | undefined> = [];
  const deletedKeys: string[] = [];
  const bucket = {
    async put(key: string, body: ArrayBuffer) { objects.set(key, new Uint8Array(body)); },
    async get(key: string) {
      const bytes = objects.get(key);
      if (!bytes) return null;
      return { body: new Response(bytes.buffer as ArrayBuffer).body!, size: bytes.byteLength, etag: 'etag', httpMetadata: { contentType: 'audio/mpeg' } };
    },
    async list(options: { cursor?: string }) {
      listCalls.push(options.cursor);
      return options.cursor === undefined
        ? { objects: [{ key: 'admins/admin-1/books/book-123/one' }], truncated: true, cursor: 'page-2' }
        : { objects: [{ key: 'admins/admin-1/books/book-123/two' }], truncated: false };
    },
    async delete(key: string) { deletedKeys.push(key); },
  } as unknown as R2Bucket;
  const env: Env = { DB: database, BOOKS: bucket, SESSION_SECRET: 'test-secret' };
  const session = await createSession(database, 'admin-1', new Date());
  const otherSession = await createSession(database, 'admin-2', new Date());
  books.set('book-123', {
    id: 'book-123', admin_id: 'admin-1', title: 'Cloud Book', author: null,
    budget_id: 'gist', language: 'en', voice: 'voice', generated_at: '2026-01-01T00:00:00.000Z', version: 1,
    deleted_at: null,
  });
  return { env, cookie: `cairn_session=${session.token}`, otherCookie: `cairn_session=${otherSession.token}`, resources, listCalls, deletedKeys };
};

test('authenticated manifest read returns owned books and resources', async () => {
  const { env, cookie } = await makeEnvironment();
  const response = await app.fetch(new Request('https://cairn.test/api/sync/manifest', { headers: { cookie } }), env);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ books: [expect.objectContaining({ bookId: 'book-123', title: 'Cloud Book', resources: [] })] });
});

test('resource put stores R2 bytes and D1 hash metadata, then get returns bytes', async () => {
  const { env, cookie, resources } = await makeEnvironment();
  const bytes = new TextEncoder().encode('audio');
  const hash = await sha256(bytes.buffer);
  const response = await app.fetch(new Request('https://cairn.test/api/sync/books/book-123/resource/audio/n0.mp3', {
    method: 'PUT', headers: { cookie, 'content-type': 'audio/mpeg', 'content-length': String(bytes.byteLength), 'x-content-sha256': hash, 'x-base-version': '1' }, body: bytes.buffer as ArrayBuffer,
  }), env);
  expect(response.status).toBe(200);
  expect(resources.get('book-123/audio/n0.mp3')?.content_hash).toBe(hash);

  const downloaded = await app.fetch(new Request('https://cairn.test/api/sync/books/book-123/resource/audio/n0.mp3', { headers: { cookie } }), env);
  expect(downloaded.status).toBe(200);
  expect(await downloaded.text()).toBe('audio');
});

test('does not expose a book to another administrator', async () => {
  const { env, otherCookie } = await makeEnvironment();
  const response = await app.fetch(new Request('https://cairn.test/api/sync/books/book-123/resource/audio/n0.mp3', { headers: { cookie: otherCookie } }), env);
  expect(response.status).toBe(404);
});

test('rejects unauthenticated, private/traversal, wrong content type, and hash mismatch requests', async () => {
  const { env, cookie } = await makeEnvironment();
  expect((await app.fetch(new Request('https://cairn.test/api/sync/manifest'), env)).status).toBe(401);
  expect((await app.fetch(new Request('https://cairn.test/api/sync/books/book-123/resource/chapters.json', { headers: { cookie } }), env)).status).toBe(400);
  expect((await app.fetch(new Request('https://cairn.test/api/sync/books/book-123/resource/%2e%2e/secret', { headers: { cookie } }), env)).status).toBeGreaterThanOrEqual(400);
  const request = (contentType: string, hash: string) => new Request('https://cairn.test/api/sync/books/book-123/resource/path.json', {
    method: 'PUT', headers: { cookie, 'content-type': contentType, 'content-length': '2', 'x-content-sha256': hash }, body: '{}',
  });
  expect((await app.fetch(request('text/plain', 'bad'), env)).status).toBe(415);
  expect((await app.fetch(request('application/json', 'bad'), env)).status).toBe(400);

  const bytes = new TextEncoder().encode('{}');
  const hash = await sha256(bytes.buffer);
  const resourceRequest = (baseVersion?: string) => new Request('https://cairn.test/api/sync/books/book-123/resource/path.json', {
    method: 'PUT', headers: {
      cookie, 'content-type': 'application/json', 'content-length': String(bytes.byteLength), 'x-content-sha256': hash,
      ...(baseVersion === undefined ? {} : { 'x-base-version': baseVersion }),
    }, body: bytes.buffer as ArrayBuffer,
  });
  expect((await app.fetch(resourceRequest(), env)).status).toBe(409);
  expect((await app.fetch(resourceRequest('not-a-version'), env)).status).toBe(409);
  expect((await app.fetch(resourceRequest('2'), env)).status).toBe(409);
});

test('tombstone cleanup follows every R2 list page', async () => {
  const { env, cookie, listCalls, deletedKeys } = await makeEnvironment();
  const response = await app.fetch(new Request('https://cairn.test/api/sync/books/book-123', {
    method: 'DELETE', headers: { cookie, 'x-base-version': '1' },
  }), env);
  expect(response.status).toBe(200);
  expect(listCalls).toEqual([undefined, 'page-2']);
  expect(deletedKeys).toEqual([
    'admins/admin-1/books/book-123/one',
    'admins/admin-1/books/book-123/two',
  ]);
});
