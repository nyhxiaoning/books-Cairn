import { expect, test } from 'bun:test';
import { app, type Env } from '../src/index';

const testEnv = {
  DB: {} as D1Database,
  BOOKS: {} as R2Bucket,
  SESSION_SECRET: 'test-only-secret',
} satisfies Env;

test('health reports the configured storage bindings', async () => {
  const response = await app.fetch(new Request('https://cairn.test/api/health'), testEnv);

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, database: 'd1', storage: 'r2' });
});

test('unknown routes return a JSON 404', async () => {
  const response = await app.fetch(new Request('https://cairn.test/api/unknown'), testEnv);

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ code: 'not_found', message: 'Not found' });
});
