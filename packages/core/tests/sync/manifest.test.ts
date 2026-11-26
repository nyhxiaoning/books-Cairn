import { expect, test } from 'bun:test';
import { buildSyncManifest, isSyncablePath, resourceKey, syncContentType, type SyncFile } from '../../src/sync/manifest';
import type { LibraryEntry } from '../../src/store/library';

const entry: LibraryEntry = {
  id: 'book-123', title: 'A Book', author: 'An Author', stations: 2, minutes: 8,
  budgetId: 'gist', generatedAt: '2026-01-01T00:00:00.000Z', language: 'en', voice: 'voice',
};
const file = (path: string, contentType = syncContentType(path) ?? 'application/octet-stream'): SyncFile => ({
  path, contentType, byteSize: 4, contentHash: 'hash',
});

test('allowlist includes playable resources and excludes private/source files', () => {
  for (const path of ['path.json', 'decks/n0.json', 'cover.webp', 'catalog.json', 'progress.json']) expect(isSyncablePath(path)).toBe(true);
  for (const path of ['audio/n0.mp3', 'chapters.json', '.cache/map.json', 'traces/call.json', 'chats/session.json', 'sources/book.epub', '../path.json', 'decks/../path.json', '/path.json', 'anything.bin']) expect(isSyncablePath(path)).toBe(false);
});

test('manifest filters invalid files, includes metadata, and sorts paths', () => {
  const manifest = buildSyncManifest(entry, [file('audio/n0.mp3'), file('path.json'), file('chapters.json'), file('cover.webp', 'text/plain')]);
  expect(manifest).toMatchObject({ bookId: 'book-123', title: 'A Book', complete: true, built: 2, version: 1 });
  expect(manifest.resources.map(({ path }) => path)).toEqual(['path.json']);
});

test('resource keys are deterministic and administrator scoped', () => {
  expect(resourceKey('admin-1', 'book-123', 'path.json')).toBe('admins/admin-1/books/book-123/path.json');
  expect(resourceKey('admin-2', 'book-123', 'path.json')).not.toBe(resourceKey('admin-1', 'book-123', 'path.json'));
  expect(() => resourceKey('admin-1', 'book-123', 'audio/n0.mp3')).toThrow();
  expect(() => resourceKey('admin-1', 'book-123', '../secret')).toThrow();
  expect(() => resourceKey('admin/../other', 'book-123', 'path.json')).toThrow();
});
