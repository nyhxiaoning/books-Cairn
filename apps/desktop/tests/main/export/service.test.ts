import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Library } from '@cairn/core/store/library-disk';
import type { Path } from '@cairn/core/types';
import { createExportService } from '../../../src/main/export/service';

const path: Path = {
  bookId: 'book-a', title: 'Thinking', type: 'knowledge',
  nodes: [
    { id: 'n0', idx: 0, title: 'Start', kind: 'concept', brief: '', keyPoints: [], sourceChapters: [1], estMinutes: 2 },
    { id: 'n1', idx: 1, title: 'End', kind: 'recap', brief: '', keyPoints: [], sourceChapters: [2], estMinutes: 1 },
  ],
  stages: [], totalMinutes: 3, generatedAt: '2026-09-28T00:00:00Z',
};

async function library(audioNodes: readonly string[]): Promise<{ root: string; lib: Library }> {
  const root = await mkdtemp(join(tmpdir(), 'cairn-export-'));
  const audioDir = join(root, 'books', 'book-a', 'audio');
  await mkdir(audioDir, { recursive: true });
  for (const id of audioNodes) await writeFile(join(audioDir, `${id}.mp3`), `audio-${id}`);
  const lib = {
    root,
    loadPath: async () => path,
    readDeckIndex: async () => ({
      total: path.nodes.length,
      ready: [...audioNodes],
      failed: [],
      complete: audioNodes.length === path.nodes.length,
    }),
  } as unknown as Library;
  return { root, lib };
}

test('concatenates installed audio through ffmpeg and writes to exports', async () => {
  const { root, lib } = await library(['n0', 'n1']);
  // A fake ffmpeg that concatenates the listed files' contents — proves the
  // spawn arguments, the list file, and the output path without a real codec.
  const fakeFfmpeg = join(root, 'fake-ffmpeg.sh');
  await writeFile(fakeFfmpeg, `#!/bin/sh
list=""
out=""
while [ $# -gt 0 ]; do
  case "$1" in
    -i) list="$2"; shift 2 ;;
    -c) shift 2 ;;
    *) out="$1"; shift ;;
  esac
done
: > "$out"
grep "^file " "$list" | sed "s/^file '//;s/'$//" | while read -r f; do cat "$f" >> "$out"; done
`);
  const { chmod } = await import('node:fs/promises');
  await chmod(fakeFfmpeg, 0o755);
  const service = createExportService({ library: lib, dataDir: root, ffmpegPath: fakeFfmpeg, now: () => '2026-09-28' });

  const result = await service.exportAudio('book-a');

  expect(result.missing).toEqual([]);
  expect(result.path).toBe(join(root, 'exports', 'book-a', 'Thinking-2026-09-28.mp3'));
  expect(await readFile(result.path, 'utf8')).toBe('audio-n0audio-n1');
  await rm(root, { recursive: true, force: true });
});

test('missing ffmpeg surfaces an actionable error', async () => {
  const { root, lib } = await library(['n0']);
  const service = createExportService({ library: lib, dataDir: root, ffmpegPath: join(root, 'nope'), now: () => '2026-09-28' });
  await expect(service.exportAudio('book-a')).rejects.toThrow('ffmpeg');
  await rm(root, { recursive: true, force: true });
});

test('a book with no audio refuses instead of writing an empty file', async () => {
  const { root, lib } = await library([]);
  const service = createExportService({ library: lib, dataDir: root, now: () => '2026-09-28' });
  await expect(service.exportAudio('book-a')).rejects.toThrow('no_audio');
  await rm(root, { recursive: true, force: true });
});

test('writeExport lands a document under exports and returns its path', async () => {
  const { root, lib } = await library(['n0']);
  const service = createExportService({ library: lib, dataDir: root, now: () => '2026-09-28' });
  const result = await service.writeExport('book-a', 'Thinking-2026-09-28.html', '<html></html>');
  expect(result.path).toBe(join(root, 'exports', 'book-a', 'Thinking-2026-09-28.html'));
  expect(await readFile(result.path, 'utf8')).toBe('<html></html>');
  await rm(root, { recursive: true, force: true });
});
