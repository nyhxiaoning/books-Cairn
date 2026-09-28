import type { CatalogRecord } from '../catalog/types';
import type { LibraryEntry } from '../store/library';
import type { ChapterNote } from '../types';

export interface BookProfile {
  readonly title: string;
  readonly author?: string;
  readonly category: string;
  readonly topics: readonly string[];
}

const MAX_TOPICS = 8;
const MAX_TOPIC_LENGTH = 60;
const FALLBACK_CATEGORY = 'Uncategorized';
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into', 'is', 'it', 'of', 'on',
  'or', 'the', 'to', 'with',
]);

const topic = (value: string): string | undefined => {
  const normalized = value.trim().replace(/\s+/g, ' ').slice(0, MAX_TOPIC_LENGTH);
  return normalized || undefined;
};

const topicTerms = (title: string): readonly string[] => title
  .normalize('NFKC')
  .split(/[^\p{L}\p{N}]+/u)
  .map((term) => term.trim())
  .filter((term) => term.length > 2 && !STOPWORDS.has(term.toLocaleLowerCase()));

/** Produces only metadata and labels from chapter titles, never note prose. */
export function deriveBookProfile(
  entry: LibraryEntry,
  catalogRecord: CatalogRecord | undefined,
  notes: readonly ChapterNote[],
): BookProfile {
  const candidates = [
    ...(catalogRecord?.tags ?? []),
    ...notes.map((note) => note.title),
    ...notes.flatMap((note) => topicTerms(note.title)),
  ];
  const seen = new Set<string>();
  const topics: string[] = [];

  for (const candidate of candidates) {
    const label = topic(candidate);
    if (label === undefined) continue;
    const identity = label.toLocaleLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    topics.push(label);
    if (topics.length === MAX_TOPICS) break;
  }

  const category = catalogRecord?.category?.trim() || FALLBACK_CATEGORY;
  const author = entry.author?.trim();
  return { title: entry.title, ...(author === undefined ? {} : { author }), category, topics };
}
