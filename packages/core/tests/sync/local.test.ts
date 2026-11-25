import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportSyncBook, installSyncBook, validateSyncBundle } from '../../src/sync/local';
import type { Chapter, ChapterNote, NodeDeck, Path } from '../../src/types';
import type { LibraryEntry } from '../../src/store/library';
import { openLibrary } from '../../src/store/library-disk';

const path: Path = {
  bookId: 'b1', title: '测试书', type: 'knowledge',
  nodes: [{ id: 'n0', idx: 0, title: '第一站', kind: 'concept', brief: 'b', keyPoints: [], sourceChapters: [0], estMinutes: 1 }],
  stages: [{ title: '阶段', nodeIds: ['n0'] }], totalMinutes: 1, generatedAt: '2026-01-01T00:00:00.000Z',
};
const notes: readonly ChapterNote[] = [{ idx: 0, title: '章', gist: 'g', keyPoints: [], quotes: [] }];
const chapters: readonly Chapter[] = [{ idx: 0, title: '章', text: '不能上传', wordCount: 1 }];
const entry: LibraryEntry = {
  id: 'b1', title: '测试书', stations: 1, minutes: 1, budgetId: 'brief',
  generatedAt: '2026-01-01T00:00:00.000Z', complete: true, built: 1,
};

async function fixture(): Promise<{ root: string; library: ReturnType<typeof openLibrary> }> {
  const root = await mkdtemp(join(tmpdir(), 'cairn-local-sync-'));
  const library = openLibrary(root);
  await library.installPath(path, notes, chapters, entry);
  const cache = library.cacheDir('b1');
  await mkdir(cache, { recursive: true });
  await writeFile(join(cache, 'map.json'), 'never sync');
  await mkdir(join(root, 'books/b1/source'), { recursive: true });
  await mkdir(join(root, 'books/b1/chat'), { recursive: true });
  await writeFile(join(root, 'books/b1/source/original.epub'), 'never sync');
  await writeFile(join(root, 'books/b1/chat/transcript.json'), 'never sync');
  await writeFile(join(root, 'books/b1/cover.webp'), 'cover');
  await writeFile(join(root, 'books/b1/catalog.json'), '{"shelf":"a"}');
  await writeFile(join(root, 'books/b1/progress.json'), '{"stationId":"n0"}');
  const audioDir = join(root, 'audio-cache');
  await mkdir(audioDir, { recursive: true });
  await writeFile(join(audioDir, 'n0.mp3'), 'audio');
  const deck: NodeDeck = { nodeId: 'n0', slides: [], narration: [], audioPath: '/cache/n0.mp3', durationMs: 1000 };
  await library.installDeck('b1', deck, audioDir);
  return { root, library };
}

describe('local sync bundle', () => {
  test('exports playable resources and metadata, never chapters or generation data', async () => {
    const { library } = await fixture();
    const bundle = await exportSyncBook(library, 'b1');
    expect(bundle.files.map((file) => file.path)).toEqual([
      'audio/n0.mp3', 'catalog.json', 'cover.webp', 'decks/index.json', 'decks/n0.json', 'path.json', 'progress.json',
    ]);
    expect(bundle.files.some((file) => file.path.includes('chapters') || file.path.includes('cache'))).toBe(false);
    expect(bundle.manifest.resources).toHaveLength(bundle.files.length);
  });

  test('validates resource hashes and rejects malformed or forbidden bundles', async () => {
    const { library } = await fixture();
    const bundle = await exportSyncBook(library, 'b1');
    expect(validateSyncBundle(bundle).manifest.bookId).toBe('b1');
    const tampered = { ...bundle, files: bundle.files.map((file, index) => index === 0 ? { ...file, bytes: new Uint8Array([1]) } : file) };
    expect(() => validateSyncBundle(tampered)).toThrow('invalid_sync_bundle');
    expect(() => validateSyncBundle({ ...bundle, manifest: { ...bundle.manifest, bookId: '../bad' } })).toThrow('invalid_sync_bundle');
    expect(() => validateSyncBundle({ ...bundle, files: [...bundle.files, { path: 'chapters.json', contentType: 'application/json', byteSize: 2, contentHash: '0'.repeat(64), bytes: new Uint8Array([1, 2]) }] })).toThrow('invalid_sync_bundle');
    expect(() => validateSyncBundle({ ...bundle, files: bundle.files.filter((file) => file.path !== 'path.json') })).toThrow('invalid_sync_bundle');
  });

  test('stages and installs cloud resources atomically while preserving local-only data', async () => {
    const source = await fixture();
    const bundle = await exportSyncBook(source.library, 'b1');
    const target = await fixture();
    await writeFile(join(target.root, 'books/b1/path.json'), '{"bookId":"old"}');
    await expect(installSyncBook(target.library, bundle, join(target.root, 'tmp'))).resolves.toMatchObject({ id: 'b1' });
    expect(JSON.parse(await readFile(join(target.root, 'books/b1/path.json'), 'utf8')).title).toBe('测试书');
    expect(await readFile(join(target.root, 'books/b1/chapters.json'), 'utf8')).toContain('不能上传');
    expect(await readFile(join(target.root, '.cache/b1/map.json'), 'utf8')).toBe('never sync');
  });
});
