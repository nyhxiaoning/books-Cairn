import { randomUUID } from 'node:crypto';
import type { ChapterNote } from '@cairn/core/types';
import type { Chapter } from '@cairn/core/types';
import type { EvidenceRecord, ExpertRef } from '@cairn/core/companion/types';
import { escapeXml } from '@cairn/core/companion/xml';

const MAX_EXCERPTS = 8;
const MAX_BOOKS = 4;
const MAX_QUERY = 200;
const GIST_CHARS = 500;

export class UniverseToolError extends Error {
  constructor(readonly code: 'invalid_query' | 'unknown_expert') {
    super(code);
    this.name = 'UniverseToolError';
  }
}

export interface UniverseToolResult {
  readonly resultId: string;
  readonly text: string;
  readonly evidence: EvidenceRecord;
}

export interface UniverseToolDeps {
  /** Linked, mapped experts for the seed book: at most four, closest first. */
  readonly experts: () => Promise<readonly { readonly bookId: string; readonly bookTitle: string }[]>;
  readonly loadNotes: (bookId: string) => Promise<readonly ChapterNote[]>;
}

function boundedXml(value: string, limit: number): string {
  let text = '';
  for (const character of value) {
    const escaped = escapeXml(character);
    if (text.length + escaped.length > limit) break;
    text += escaped;
  }
  return text;
}

function queryTerms(query: string): string[] {
  const words = query.toLocaleLowerCase().match(/[\p{Script=Han}]+|[\p{L}\p{N}]+/gu) ?? [];
  return words.flatMap((word) => /[\p{Script=Han}]/u.test(word) && word.length > 2
    ? Array.from({ length: word.length - 1 }, (_, index) => word.slice(index, index + 2))
    : [word]);
}

export async function consultUniverse(
  query: string, currentBookId: string, deps: UniverseToolDeps,
): Promise<UniverseToolResult> {
  const terms = queryTerms(query.trim());
  if (terms.length === 0 || query.length > MAX_QUERY) throw new UniverseToolError('invalid_query');

  const experts = (await deps.experts()).filter((expert) => expert.bookId !== currentBookId).slice(0, MAX_BOOKS);
  const ranked = (await Promise.all(experts.map(async (expert) => {
    const notes = await deps.loadNotes(expert.bookId);
    return notes.map((note) => {
      const haystack = `${note.title} ${note.gist} ${note.keyPoints.join(' ')}`.toLocaleLowerCase();
      return { expert, note, score: terms.filter((term) => haystack.includes(term)).length };
    }).filter((entry) => entry.score > 0);
  }))).flat();
  ranked.sort((a, b) => b.score - a.score);

  const selected = ranked.slice(0, MAX_EXCERPTS);
  const resultId = randomUUID();
  const refs: ExpertRef[] = selected.map(({ expert, note }) => ({
    bookId: expert.bookId, bookTitle: expert.bookTitle, chapter: note.idx, title: note.title,
  }));
  const body = selected.map(({ expert, note }) =>
    `<excerpt bookId="${escapeXml(expert.bookId)}" bookTitle="${boundedXml(expert.bookTitle, 80)}" chapter="${note.idx}" title="${boundedXml(note.title, 80)}"><gist>${boundedXml(note.gist, GIST_CHARS)}</gist></excerpt>`,
  ).join('');
  return {
    resultId,
    text: `<tool_result id="${resultId}" source="expert">${body}</tool_result>`,
    evidence: { resultId, source: 'expert', refs },
  };
}

export interface UniverseChapterDeps {
  /** The expert allowlist of the active universe, resolved at turn start. */
  readonly allowedBookIds: () => Promise<readonly string[]>;
  readonly loadChapter: (bookId: string, idx: number) => Promise<Chapter | undefined>;
}

export async function readUniverseChapters(
  bookId: string, indices: readonly number[], currentBookId: string, deps: UniverseChapterDeps,
): Promise<UniverseToolResult> {
  if (bookId === currentBookId) throw new UniverseToolError('unknown_expert');
  const allowed = await deps.allowedBookIds();
  if (!allowed.includes(bookId)) throw new UniverseToolError('unknown_expert');
  if (indices.length === 0 || indices.length > 2 || indices.some((idx) => !Number.isInteger(idx) || idx < 0)) {
    throw new UniverseToolError('invalid_query');
  }
  const selected = await Promise.all(indices.map(async (idx) => ({ idx, chapter: await deps.loadChapter(bookId, idx) })));
  if (selected.some((entry) => entry.chapter === undefined)) throw new UniverseToolError('unknown_expert');
  const present = selected.filter((entry): entry is { idx: number; chapter: Chapter } => entry.chapter !== undefined);
  const resultId = randomUUID();
  const body = present.map(({ chapter }) =>
    `<chapter idx="${chapter.idx}" title="${boundedXml(chapter.title, 200)}">${boundedXml(chapter.text, 12_000)}</chapter>`,
  ).join('');
  return {
    resultId,
    text: `<tool_result id="${resultId}" source="expert" bookId="${escapeXml(bookId)}">${body}</tool_result>`,
    evidence: {
      resultId, source: 'expert',
      refs: present.map(({ chapter }) => ({
        bookId, bookTitle: bookId, chapter: chapter.idx, title: chapter.title,
      })),
    },
  };
}
