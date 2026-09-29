import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportFileName, audioPlan } from '@cairn/core/export/audio-plan';
import { isBookId, type LibraryEntry } from '@cairn/core/store/library';
import type { Library } from '@cairn/core/store/library-disk';

export class ExportError extends Error {
  constructor(readonly code: 'no_audio' | 'book_not_listed' | 'export_failed' | 'ffmpeg_missing') {
    super(code);
    this.name = 'ExportError';
  }
}

export interface ExportResult {
  readonly path: string;
  readonly missing: readonly string[];
}

export interface ExportService {
  exportAudio(bookId: string): Promise<ExportResult>;
  writeExport(bookId: string, fileName: string, contents: string): Promise<{ readonly path: string }>;
}

const FFMPEG_FALLBACK = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

/**
 * A GUI-launched .app inherits the system PATH (/usr/bin:/bin:/usr/sbin:/sbin),
 * which never includes Homebrew, so a bare "ffmpeg" fails there even though it
 * works from the terminal. Probe the common install locations before giving up.
 */
const FFMPEG_CANDIDATES = process.platform === 'darwin'
  ? ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', FFMPEG_FALLBACK]
  : [FFMPEG_FALLBACK];

const resolveFfmpeg = async (override?: string): Promise<string> => {
  if (override) return override;
  for (const candidate of FFMPEG_CANDIDATES) {
    if (candidate === FFMPEG_FALLBACK) return candidate;
    if (await Bun.file(candidate).exists()) return candidate;
  }
  return FFMPEG_FALLBACK;
};

export function createExportService(deps: {
  readonly library: Pick<Library, 'root' | 'loadPath' | 'readDeckIndex'>;
  readonly dataDir: string;
  /** Injected for tests; production probes Homebrew locations then PATH. */
  readonly ffmpegPath?: string;
  readonly now?: () => string;
}): ExportService {
  const exportsDir = (bookId: string): string => join(deps.dataDir, 'exports', bookId);
  const today = deps.now ?? (() => new Date().toISOString().slice(0, 10));

  const deckReady = async (bookId: string): Promise<Set<string>> => {
    const index = await deps.library.readDeckIndex(bookId);
    return new Set(index?.ready ?? []);
  };

  return {
    async exportAudio(bookId: string): Promise<ExportResult> {
      if (!isBookId(bookId)) throw new ExportError('book_not_listed');
      const path = await deps.library.loadPath(bookId);
      const installed = await deckReady(bookId);
      const plan = audioPlan(path, installed, deps.library.root);
      if (plan.order.length === 0) throw new ExportError('no_audio');

      const ffmpeg = await resolveFfmpeg(deps.ffmpegPath);
      const outDir = exportsDir(bookId);
      await mkdir(outDir, { recursive: true });
      const outPath = join(outDir, exportFileName(path.title, today(), 'mp3'));

      // The concat list lives briefly in the book's own cache area, then goes.
      const tempDir = await mkdtemp(join(tmpdir(), 'cairn-concat-'));
      const listPath = join(tempDir, 'list.txt');
      try {
        await writeFile(listPath, plan.listText);
        const proc = Bun.spawn([ffmpeg, '-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath], {
          stdout: 'ignore', stderr: 'pipe',
        });
        const exit = await proc.exited;
        if (exit !== 0) {
          const stderr = await new Response(proc.stderr).text();
          // ENOENT from spawn surfaces as a non-zero exit with this signature.
          if (stderr.includes('No such file') || exit === 127) throw new ExportError('ffmpeg_missing');
          throw new ExportError('export_failed');
        }
      } catch (cause) {
        if (cause instanceof ExportError) throw cause;
        throw new ExportError('ffmpeg_missing');
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
      return { path: outPath, missing: plan.missing };
    },

    async writeExport(bookId, fileName, contents) {
      if (!isBookId(bookId)) throw new ExportError('book_not_listed');
      const outDir = exportsDir(bookId);
      await mkdir(outDir, { recursive: true });
      const outPath = join(outDir, fileName);
      await writeFile(outPath, contents);
      return { path: outPath };
    },
  };
}
