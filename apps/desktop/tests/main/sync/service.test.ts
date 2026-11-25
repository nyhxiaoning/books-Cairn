import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { Library } from '@cairn/core/store/library-disk';
import type { LibraryEntry, LibrarySyncFile } from '@cairn/core/store/library';
import type { CloudSyncClient } from '../../../src/main/sync/client';
import type { SessionStore } from '../../../src/main/sync/session-store';
import type { CloudManifest, StoredSession } from '../../../src/main/sync/types';
import { createSyncService } from '../../../src/main/sync/service';
import type { SyncManifest } from '@cairn/core/sync/manifest';

const session: StoredSession = { token: 'session', expiresAt: new Date(Date.now() + 60_000).toISOString() };

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
const hash = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');

const filesFor = (suffix: string): readonly LibrarySyncFile[] => [
  { path: 'path.json', bytes: bytes(`{"book":"${suffix}"}`) },
  { path: 'decks/index.json', bytes: bytes(`{"ready":["${suffix}"],"total":1,"failed":[],"complete":true}`) },
];

const entry = (id: string, title: string): LibraryEntry => ({
  id, title, stations: 1, minutes: 1, budgetId: 'gist', generatedAt: '2026-01-01T00:00:00.000Z', complete: true, built: 1,
});

const sessionStore = (onClear?: () => void): SessionStore => ({
  read: async () => session,
  write: async () => undefined,
  clear: async () => { onClear?.(); },
});

const setup = (entries: readonly LibraryEntry[], localFiles: ReadonlyMap<string, readonly LibrarySyncFile[]>, cloud: CloudManifest, initiallyConfigured = true, logoutFails = false) => {
  const installed: string[] = [];
  const uploaded: string[] = [];
  const logoutCalls = { value: 0 };
  const clearCalls = { value: 0 };
  const library = {
    root: '/tmp/cairn-test',
    list: async () => entries,
    readSyncFiles: async (bookId: string) => localFiles.get(bookId) ?? [],
    installSyncFiles: async (bookId: string) => { installed.push(bookId); return entries.find((item) => item.id === bookId) ?? entry(bookId, 'cloud'); },
  } as unknown as Library;
  const client: CloudSyncClient = {
    login: async () => session,
    logout: async () => {
      logoutCalls.value += 1;
      if (logoutFails) throw new Error('network down');
    },
    fetchManifest: async () => cloud,
    uploadResource: async (input) => {
      uploaded.push(`${input.bookId}:${input.path}`);
      return { bookId: input.bookId, path: input.path, version: input.baseVersion, contentHash: input.contentHash, byteSize: input.bytes.byteLength };
    },
    downloadResource: async ({ path }) => bytes(`download:${path}`),
  };
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ bookId: 'book-new', version: 1, resources: 2 }), { status: 201 });
  const settingsWrites: Array<Readonly<Record<string, unknown>>> = [];
  const service = createSyncService({
    library,
    client: initiallyConfigured ? client : undefined,
    sessionStore: sessionStore(() => { clearCalls.value += 1; }),
    workerUrl: initiallyConfigured ? 'https://sync.example.test' : undefined,
    createClient: () => client,
    writeSyncSettings: async (patch) => { settingsWrites.push(patch); },
    fetcher,
  });
  return { service, installed, uploaded, settingsWrites, logoutCalls, clearCalls };
};

test('configures a fresh service before login without persisting the password', async () => {
  const { service, settingsWrites } = setup([], new Map(), { books: [] }, false);
  expect(service.status().state).toBe('disabled');
  await service.configure('https://sync.example.test/');
  const account = await service.login('admin', 'do-not-store');
  expect(account.authenticated).toBe(true);
  expect(settingsWrites).toEqual([
    { enabled: true, workerUrl: 'https://sync.example.test' },
    { username: 'admin' },
  ]);
  expect(JSON.stringify(settingsWrites)).not.toContain('do-not-store');
});

test('revokes the cloud session when possible but always clears local authentication', async () => {
  const { service, logoutCalls, clearCalls } = setup([], new Map(), { books: [] }, true, true);
  await service.logout();
  expect(logoutCalls.value).toBe(1);
  expect(clearCalls.value).toBe(1);
  expect(service.account()).toEqual({ authenticated: false });
  expect(service.status().state).toBe('disabled');
});

test('uploads a local-only book without failing local operation', async () => {
  const local = filesFor('new');
  const { service, uploaded } = setup([entry('book-new', 'New')], new Map([['book-new', local]]), { books: [] });
  const result = await service.syncNow();
  expect(result.uploadedBookIds).toEqual(['book-new']);
  expect(uploaded).toEqual(['book-new:path.json', 'book-new:decks/index.json']);
  expect(result.status.state).toBe('success');
});

test('downloads a cloud-only book and installs it atomically through the library API', async () => {
  const local = filesFor('cloud');
  const manifest: SyncManifest = {
    ...entry('book-cloud', 'Cloud'), bookId: 'book-cloud', version: 3,
    resources: local.map((file) => ({ path: file.path, contentType: 'application/json', byteSize: bytes(`download:${file.path}`).byteLength, contentHash: hash(bytes(`download:${file.path}`)) })),
  };
  const { service, installed } = setup([], new Map(), { books: [manifest] });
  const result = await service.syncNow();
  expect(result.downloadedBookIds).toEqual(['book-cloud']);
  expect(installed).toEqual(['book-cloud']);
});

test('prefers the cloud version when both sides contain a changed book', async () => {
  const local = filesFor('local');
  const remoteFiles = filesFor('remote');
  const manifest: SyncManifest = {
    ...entry('book-one', 'Cloud title'), bookId: 'book-one', version: 4,
    resources: remoteFiles.map((file) => ({ path: file.path, contentType: 'application/json', byteSize: bytes(`download:${file.path}`).byteLength, contentHash: hash(bytes(`download:${file.path}`)) })),
  };
  const { service, installed } = setup([entry('book-one', 'Local title')], new Map([['book-one', local]]), { books: [manifest] });
  await service.syncNow();
  expect(installed).toEqual(['book-one']);
});

test('keeps local playback available when a cloud transfer fails', async () => {
  const local = filesFor('local');
  const manifest: SyncManifest = {
    ...entry('book-one', 'Cloud title'), bookId: 'book-one', version: 2,
    resources: local.map((file) => ({ path: file.path, contentType: 'application/json', byteSize: 1, contentHash: '0'.repeat(64) })),
  };
  const setupResult = setup([entry('book-one', 'Local title')], new Map([['book-one', local]]), { books: [manifest] });
  const result = await setupResult.service.syncNow();
  expect(result.failedBookIds).toEqual(['book-one']);
  expect(setupResult.installed).toEqual([]);
  expect(result.status.state).toBe('error');
});
