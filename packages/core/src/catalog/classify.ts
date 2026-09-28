import { LlmError, type LlmProvider, parseJsonOutput } from '../llm/types';
import type { ContentLocale } from '../parse/language';
import type { ChapterNote } from '../types';
import { normalizeCatalogCategory, normalizeCatalogTags } from './types';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'tags'],
  properties: {
    category: { type: 'string', minLength: 1, maxLength: 80 },
    tags: {
      type: 'array', minItems: 1, maxItems: 6,
      items: { type: 'string', minLength: 1, maxLength: 80 },
    },
  },
} as const;

const systemFor = (locale: ContentLocale): string => locale === 'en'
  ? 'Organize this reader\'s local shelf from only the supplied title and chapter digest. Return one concise category and one to six concise tags. Do not use knowledge outside the digest. Write category and tags in English. Output JSON only.'
  : '只根据给出的书名和章节摘要整理读者的本地书架。返回一个简洁分类和一到六个简洁标签。不得使用摘要以外的知识。分类和标签请用中文。只输出 JSON。';

const promptFor = (title: string, notes: readonly ChapterNote[]): string => {
  const digest = notes
    .slice(0, 40)
    .map((note) => `${note.idx}. ${note.title} — ${note.gist}`)
    .join('\n');
  return `Title: ${title}\n\nChapter digest:\n${digest}`;
};

interface RawSuggestion {
  readonly category?: unknown;
  readonly tags?: unknown;
}

const badOutput = (): never => {
  throw new LlmError('模型输出的书架分类无效', 'bad_output');
};

const isTagList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.length >= 1 && value.length <= 6 &&
  value.every((tag): tag is string => typeof tag === 'string');

/** Suggestion only: the caller decides whether and how it reaches the catalog. */
export async function suggestCatalog(
  title: string,
  notes: readonly ChapterNote[],
  provider: LlmProvider,
  signal?: AbortSignal,
  locale: ContentLocale = 'en',
): Promise<{ readonly category: string; readonly tags: readonly string[] }> {
  const raw = await provider.complete({
    label: 'catalog',
    system: systemFor(locale),
    prompt: promptFor(title, notes),
    schema: SCHEMA,
    signal,
  });
  const parsed = parseJsonOutput<RawSuggestion>(raw);
  const rawCategory = parsed.category;
  const rawTags = parsed.tags;
  if (typeof rawCategory !== 'string') return badOutput();
  if (!isTagList(rawTags)) return badOutput();

  const category = normalizeCatalogCategory(rawCategory);
  if (category === undefined) return badOutput();
  const tags = normalizeCatalogTags(rawTags);
  if (tags.length === 0) return badOutput();
  return { category, tags };
}
