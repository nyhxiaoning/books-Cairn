import { expect, test } from 'bun:test';
import { createCloudSyncClient, CloudSyncError, normalizeWorkerUrl } from '../../../src/main/sync/client';
import type { SessionStore } from '../../../src/main/sync/session-store';
import type { StoredSession } from '../../../src/main/sync/types';

const session: StoredSession = { token: 'secret-token', expiresAt: new Date(Date.now() + 60_000).toISOString() };
const store = (current: StoredSession | undefined = session): SessionStore => {
  let value = current;
  return {
    read: async () => value,
    write: async (next) => { value = next; },
    clear: async () => { value = undefined; },
  };
};

test('normalizes a worker URL without duplicating API path separators', () => {
  expect(normalizeWorkerUrl('https://sync.example.test///')).toBe('https://sync.example.test');
  expect(() => normalizeWorkerUrl('file:///tmp/worker')).toThrow(CloudSyncError);
});

test('uses the session token for authenticated requests and parses manifests', async () => {
  let request: Request | undefined;
  const client = createCloudSyncClient('https://sync.example.test/', store(), async (input, init) => {
    request = new Request(input, init);
    return new Response(JSON.stringify({ books: [] }), { headers: { 'content-type': 'application/json' } });
  });
  expect(await client.fetchManifest()).toEqual({ books: [] });
  expect(request?.url).toBe('https://sync.example.test/api/sync/manifest');
  expect(request?.headers.get('authorization')).toBe('Bearer secret-token');
  expect(request?.headers.get('cookie')).toBe('cairn_session=secret-token');
});

test('maps structured errors and clears the session on 401', async () => {
  const sessions = store();
  const client = createCloudSyncClient('https://sync.example.test', sessions, async () =>
    new Response(JSON.stringify({ code: 'unauthorized', message: 'Authentication is required.' }), {
      status: 401, headers: { 'content-length': '67' },
    }));
  await expect(client.fetchManifest()).rejects.toMatchObject({ code: 'unauthorized', status: 401 });
  expect(await sessions.read()).toBeUndefined();
});

test('rejects oversized JSON before parsing it', async () => {
  const client = createCloudSyncClient('https://sync.example.test', store(), async () =>
    new Response('{}', { headers: { 'content-length': String(1024 * 1024 + 1) } }));
  await expect(client.fetchManifest()).rejects.toMatchObject({ code: 'response_too_large' });
});

test('bounds streamed JSON when the server omits content length', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  });
  const client = createCloudSyncClient('https://sync.example.test', store(), async () => new Response(stream));
  await expect(client.fetchManifest()).rejects.toMatchObject({ code: 'response_too_large' });
});

test('login accepts the current cookie response without persisting the password', async () => {
  const sessions = store(undefined);
  const client = createCloudSyncClient('https://sync.example.test', sessions, async (_input, init) => {
    expect(String(init?.body)).toContain('username');
    expect(String(init?.body)).toContain('password');
    return new Response(JSON.stringify({ expiresAt: session.expiresAt }), {
      headers: { 'set-cookie': `cairn_session=${session.token}; Max-Age=60` },
    });
  });
  expect(await client.login({ username: 'admin', password: 'never-store-me' })).toEqual(session);
  expect(JSON.stringify(await sessions.read())).not.toContain('never-store-me');
});
