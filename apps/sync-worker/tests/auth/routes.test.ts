import { expect, test } from 'bun:test';
import { app, type Env } from '../../src/index';

interface Row {
  readonly id: string;
  readonly username_normalized: string;
  readonly password_hash: string;
}

const makeDatabase = () => {
  let admin: Row | undefined;
  const sessions = new Map<string, Record<string, string>>();
  const database = {
    prepare(sql: string) {
      let args: readonly unknown[] = [];
      return {
        bind(...bound: unknown[]) {
          args = bound;
          return this;
        },
        async first<T>(): Promise<T | null> {
          if (sql.includes('SELECT id FROM admin_account')) return (admin ? { id: admin.id } : null) as T | null;
          if (sql.includes('SELECT id, username_normalized')) {
            return admin && admin.username_normalized === args[0] ? admin as T : null;
          }
          if (sql.startsWith('SELECT admin_id')) {
            const tokenHash = String(args[0]);
            const row = sessions.get(tokenHash);
            if (!row || (row.expires_at ?? '') <= String(args[1])) return null;
            return { admin_id: row.admin_id, expires_at: row.expires_at, last_used_at: row.last_used_at } as T;
          }
          return null;
        },
        async run() {
          if (sql.startsWith('INSERT INTO admin_account')) {
            admin = {
              id: String(args[0]),
              username_normalized: String(args[1]),
              password_hash: String(args[2]),
            };
          } else if (sql.startsWith('INSERT INTO sessions')) {
            sessions.set(String(args[0]), {
              admin_id: String(args[1]), expires_at: String(args[2]), last_used_at: String(args[4]),
            });
          } else if (sql.startsWith('UPDATE sessions')) {
            const row = sessions.get(String(args[1]));
            if (row) row.last_used_at = String(args[0]);
          } else if (sql.startsWith('DELETE FROM sessions')) {
            sessions.delete(String(args[0]));
          }
          return { success: true };
        },
      };
    },
  } as unknown as D1Database;
  return database;
};

const envFor = (db: D1Database): Env => ({
  DB: db,
  BOOKS: {} as R2Bucket,
  SESSION_SECRET: 'test-only-secret',
  ADMIN_INIT_SECRET: 'init-only-secret',
});

const body = (value: unknown): BodyInit => JSON.stringify(value);

test('initialization creates one administrator and never returns password material', async () => {
  const db = makeDatabase();
  const env = envFor(db);
  const request = new Request('https://cairn.test/api/auth/init', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-init-secret': 'init-only-secret' },
    body: body({ username: ' Admin ', password: 'correct horse battery staple' }),
  });

  const response = await app.fetch(request, env);
  expect(response.status).toBe(201);
  const responseBody = await response.text();
  expect(JSON.parse(responseBody)).toEqual(expect.objectContaining({ username: 'admin' }));
  expect(responseBody).not.toContain('correct horse');
});

test('initialization rejects a missing secret and does not create an account', async () => {
  const db = makeDatabase();
  const response = await app.fetch(new Request('https://cairn.test/api/auth/init', {
    method: 'POST', body: body({ username: 'admin', password: 'correct horse battery staple' }),
  }), envFor(db));

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ code: 'init_not_authorized', message: 'Administrator initialization is not authorized.' });
});

test('login sets a secure httpOnly cookie and wrong credentials have the same shape', async () => {
  const db = makeDatabase();
  const env = envFor(db);
  await app.fetch(new Request('https://cairn.test/api/auth/init', {
    method: 'POST', headers: { 'x-admin-init-secret': 'init-only-secret' },
    body: body({ username: 'admin', password: 'correct horse battery staple' }),
  }), env);

  const success = await app.fetch(new Request('https://cairn.test/api/auth/login', {
    method: 'POST', body: body({ username: 'ADMIN', password: 'correct horse battery staple' }),
  }), env);
  expect(success.status).toBe(200);
  expect(success.headers.get('set-cookie')).toMatch(/HttpOnly/);
  expect(success.headers.get('set-cookie')).toMatch(/Secure/);
  expect(success.headers.get('set-cookie')).toMatch(/SameSite=Strict/);

  const wrong = await app.fetch(new Request('https://cairn.test/api/auth/login', {
    method: 'POST', body: body({ username: 'unknown', password: 'wrong password' }),
  }), env);
  expect(wrong.status).toBe(401);
  expect(await wrong.json()).toEqual({ code: 'invalid_credentials', message: 'Username or password is incorrect.' });
});

test('logout revokes the current session and clears the cookie', async () => {
  const db = makeDatabase();
  const env = envFor(db);
  await app.fetch(new Request('https://cairn.test/api/auth/init', {
    method: 'POST', headers: { 'x-admin-init-secret': 'init-only-secret' },
    body: body({ username: 'admin', password: 'correct horse battery staple' }),
  }), env);
  const login = await app.fetch(new Request('https://cairn.test/api/auth/login', {
    method: 'POST', body: body({ username: 'admin', password: 'correct horse battery staple' }),
  }), env);
  const cookie = login.headers.get('set-cookie');
  expect(cookie).not.toBeNull();

  const logout = await app.fetch(new Request('https://cairn.test/api/auth/logout', {
    method: 'POST', headers: { cookie: cookie ?? '' },
  }), env);
  expect(logout.status).toBe(200);
  expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
});

test('second initialization is rejected', async () => {
  const db = makeDatabase();
  const env = envFor(db);
  const init = { method: 'POST', headers: { 'x-admin-init-secret': 'init-only-secret' }, body: body({ username: 'admin', password: 'correct horse battery staple' }) };
  expect((await app.fetch(new Request('https://cairn.test/api/auth/init', init), env)).status).toBe(201);
  expect((await app.fetch(new Request('https://cairn.test/api/auth/init', init), env)).status).toBe(409);
});
