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

/** Non-ASCII titles lose their letters under the library's ASCII slug, so the date keeps the name meaningful. */
export function exportFileName(title: string, date: string, ext: 'mp3' | 'html'): string {
  const ascii = title.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  const base = ascii.length >= 3 ? ascii.slice(0, 40) : 'Export';
  return `${base}-${date}.${ext}`;
}
