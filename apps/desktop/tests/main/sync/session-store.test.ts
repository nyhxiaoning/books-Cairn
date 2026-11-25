import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSessionStore } from '../../../src/main/sync/session-store';

const dir = await mkdtemp(join(tmpdir(), 'cairn-sync-session-'));
const file = join(dir, 'nested', 'session.json');

afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

test('stores only a token and expiry, and reads it back', async () => {
  const store = createSessionStore(file);
  await store.write({ token: 'session-token', expiresAt: new Date(Date.now() + 60_000).toISOString() });
  expect(await store.read()).toEqual({ token: 'session-token', expiresAt: expect.any(String) });
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ token: 'session-token', expiresAt: expect.any(String) });
});

test('clears expired and explicitly cleared sessions', async () => {
  const store = createSessionStore(file);
  await store.write({ token: 'expired', expiresAt: new Date(Date.now() + 60_000).toISOString() });
  await store.clear();
  expect(await store.read()).toBeUndefined();
});
