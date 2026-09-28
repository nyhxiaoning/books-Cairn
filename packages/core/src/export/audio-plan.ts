import { bookFile, type LibraryEntry } from '../store/library';
import type { Path } from '../types';

export interface AudioPlan {
  /** Station ids to concatenate, in path order, decks installed only. */
  readonly order: readonly string[];
  /** Stations with no installed deck, in path order. */
  readonly missing: readonly Path['nodes'][number]['id'][];
  /** ffmpeg concat demuxer directives, one quoted absolute path per line. */
  readonly listText: string;
}

export function audioPlan(
  path: Path,
  installed: ReadonlySet<string>,
  libraryRoot: string,
): AudioPlan {
  const order: string[] = [];
  const missing: string[] = [];
  const lines: string[] = [];
  for (const node of path.nodes) {
    if (!installed.has(node.id)) {
      missing.push(node.id);
      continue;
    }
    order.push(node.id);
    lines.push(`file '${libraryRoot}/${bookFile(path.bookId, `audio/${node.id}.mp3`)}'`);
  }
  return { order, missing, listText: lines.join('\n') };
}

/**
 * Export file names follow the shelf's display name, including Chinese and
 * other non-ASCII titles: the reader renamed the book, so the file should
 * carry that name, not an ASCII slug that turns 世界的逻辑 into "Export".
 * Characters unsafe in macOS/Windows file names are replaced with a dash.
 */
export function exportFileName(title: string, date: string, ext: 'mp3' | 'html'): string {
  const base = title
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 80)
    .trimEnd();
  return `${base}-${date}.${ext}`;
}
