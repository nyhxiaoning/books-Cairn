import { isBookId } from '../store/library';

export type CatalogSource = 'automatic' | 'manual';

export interface CatalogRecord {
  readonly bookId: string;
  readonly category?: string;
  readonly tags: readonly string[];
  readonly categorySource: CatalogSource;
  readonly tagsSource: CatalogSource;
  readonly updatedAt: string;
}

export interface CatalogFile {
  readonly version: 1;
  readonly records: Readonly<Record<string, CatalogRecord>>;
}

export interface CatalogSuggestion {
  readonly category: string;
  readonly tags: readonly string[];
}

export interface CatalogSuggestionResult {
  readonly catalog: CatalogFile;
  readonly suggestion: CatalogSuggestion;
}

export interface CatalogPatch {
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly source: CatalogSource;
}

export const emptyCatalog = (): CatalogFile => ({ version: 1, records: {} });

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCatalogSource = (value: unknown): value is CatalogSource =>
  value === 'automatic' || value === 'manual';

export const normalizeCatalogCategory = (value: string): string | undefined => {
  const category = value.trim().replace(/\s+/g, ' ').slice(0, 80);
  return category || undefined;
};

export const normalizeCatalogTags = (values: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const value of values) {
    const tag = value.trim().slice(0, 80);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length === 12) break;
  }

  return tags;
};

const parseRecord = (bookId: string, value: unknown): CatalogRecord | undefined => {
  if (!isBookId(bookId) || !isObject(value) || value.bookId !== bookId ||
    !Array.isArray(value.tags) || !value.tags.every((tag) => typeof tag === 'string') ||
    !isCatalogSource(value.categorySource) || !isCatalogSource(value.tagsSource) ||
    typeof value.updatedAt !== 'string' ||
    (value.category !== undefined && typeof value.category !== 'string')) return undefined;

  const category = value.category === undefined ? undefined : normalizeCatalogCategory(value.category);
  return {
    bookId,
    ...(category === undefined ? {} : { category }),
    tags: normalizeCatalogTags(value.tags),
    categorySource: value.categorySource,
    tagsSource: value.tagsSource,
    updatedAt: value.updatedAt,
  };
};

export function parseCatalog(value: unknown): CatalogFile {
  if (!isObject(value) || value.version !== 1 || !isObject(value.records)) return emptyCatalog();

  const records: Record<string, CatalogRecord> = {};
  for (const [bookId, record] of Object.entries(value.records)) {
    const parsed = parseRecord(bookId, record);
    if (parsed !== undefined) records[bookId] = parsed;
  }
  return { version: 1, records };
}

export function applyCatalogPatch(
  file: CatalogFile,
  bookId: string,
  patch: CatalogPatch,
  now: string,
): CatalogFile {
  if (!isBookId(bookId)) throw new Error(`Invalid book id: ${bookId}`);

  const existing = file.records[bookId];
  const record: CatalogRecord = existing ?? {
    bookId,
    tags: [],
    categorySource: 'automatic',
    tagsSource: 'automatic',
    updatedAt: now,
  };
  const updateCategory = patch.category !== undefined &&
    !(patch.source === 'automatic' && record.categorySource === 'manual');
  const updateTags = patch.tags !== undefined &&
    !(patch.source === 'automatic' && record.tagsSource === 'manual');

  if (!updateCategory && !updateTags) return file;

  const category = patch.category === undefined || !updateCategory
    ? record.category
    : normalizeCatalogCategory(patch.category);
  const tags = patch.tags === undefined || !updateTags ? record.tags : normalizeCatalogTags(patch.tags);
  return {
    version: 1,
    records: {
      ...file.records,
      [bookId]: {
        bookId,
        ...(category === undefined ? {} : { category }),
        tags,
        categorySource: updateCategory ? patch.source : record.categorySource,
        tagsSource: updateTags ? patch.source : record.tagsSource,
        updatedAt: now,
      },
    },
  };
}
