import { expect, test } from 'bun:test';
import {
  createSession,
  readSession,
  revokeSession,
  type Session,
} from '../../src/auth/session';

interface SessionRow {
  readonly admin_id: string;
  readonly expires_at: string;
  readonly last_used_at: string;
}

const createDatabase = () => {
  const rows = new Map<string, SessionRow>();
  const boundValues: unknown[][] = [];

  const database = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          boundValues.push(values);
          return {
            async run() {
              if (sql.startsWith('INSERT INTO sessions')) {
                const [tokenHash, adminId, expiresAt, createdAt] = values as [
                  string,
                  string,
                  string,
                  string,
                ];
                rows.set(tokenHash, {
                  admin_id: adminId,
                  expires_at: expiresAt,
                  last_used_at: createdAt,
                });
              }
              if (sql.startsWith('UPDATE sessions')) {
                const [lastUsedAt, tokenHash] = values as [string, string];
                const row = rows.get(tokenHash);
                if (row) rows.set(tokenHash, { ...row, last_used_at: lastUsedAt });
              }
              if (sql.startsWith('DELETE FROM sessions')) {
                rows.delete(values[0] as string);
              }
              return { success: true };
            },
            async first<T>() {
              const row = rows.get(values[0] as string);
              if (!row || row.expires_at <= (values[1] as string)) return null;
              return row as T;
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return { database, boundValues };
};

test('createSession stores only a digest and readSession refreshes last-used time', async () => {
  const { database, boundValues } = createDatabase();
  const now = new Date('2026-01-01T00:00:00.000Z');
  const later = new Date('2026-01-02T00:00:00.000Z');

  const created = await createSession(database, 'admin-1', now);
  const session = await readSession(database, created.token, later);

  expect(created.token).toHaveLength(43);
  expect(boundValues.flat()).not.toContain(created.token);
  expect(session).toEqual({
    adminId: 'admin-1',
    expiresAt: created.expiresAt,
    lastUsedAt: later.toISOString(),
  } satisfies Session);
});

test('readSession rejects expiry and revokeSession removes a session', async () => {
  const { database } = createDatabase();
  const now = new Date('2026-01-01T00:00:00.000Z');
  const created = await createSession(database, 'admin-1', now);

  expect(await readSession(database, created.token, new Date(created.expiresAt))).toBeUndefined();
  await revokeSession(database, created.token);
  expect(await readSession(database, created.token, now)).toBeUndefined();
});
