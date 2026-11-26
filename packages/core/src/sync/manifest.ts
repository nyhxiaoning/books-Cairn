import type { ContentLocale } from '../parse/language';
import type { LibraryEntry } from '../store/library';

export interface SyncFile {
  readonly path: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly contentHash: string;
}

export interface SyncManifest {
  readonly bookId: string;
  readonly title: string;
  readonly author?: string;
  readonly stations: number;
  readonly minutes: number;
  readonly budgetId: string;
  readonly generatedAt: string;
  readonly complete: boolean;
  readonly built: number;
  readonly language?: ContentLocale;
  readonly voice?: string;
  readonly version: number;
  readonly resources: readonly SyncFile[];
}

const BOOK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ADMIN_ID = /^[A-Za-z0-9_-]{1,128}$/;
const COVER = /^cover\.(?:png|jpe?g|webp|avif)$/i;

const contentTypeFor = (path: string): string | undefined => {
  if (path === 'path.json' || path === 'catalog.json' || path === 'progress.json') return 'application/json';
  if (/^decks\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.json$/.test(path)) return 'application/json';
  if (COVER.test(path)) {
    const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    return extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : `image/${extension}`;
  }
  return undefined;
};

export const isSyncablePath = (relativePath: string): boolean => {
  if (!relativePath || relativePath.startsWith('/') || relativePath.includes('\\')) return false;
  const parts = relativePath.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return false;
  return contentTypeFor(relativePath) !== undefined;
};

export const syncContentType = (relativePath: string): string | undefined =>
  isSyncablePath(relativePath) ? contentTypeFor(relativePath) : undefined;

export const resourceKey = (adminId: string, bookId: string, relativePath: string): string => {
  if (!ADMIN_ID.test(adminId) || !BOOK_ID.test(bookId) || !isSyncablePath(relativePath)) throw new Error('invalid_sync_resource');
  return `admins/${adminId}/books/${bookId}/${relativePath}`;
};

export const buildSyncManifest = (entry: LibraryEntry, files: readonly SyncFile[]): SyncManifest => {
  const resources = files
    .filter((file) => isSyncablePath(file.path))
    .filter((file) => syncContentType(file.path) === file.contentType)
    .map(({ path, contentType, byteSize, contentHash }) => ({ path, contentType, byteSize, contentHash }))
    .sort((left, right) => left.path.localeCompare(right.path));

  return {
    bookId: entry.id,
    title: entry.title,
    ...(entry.author === undefined ? {} : { author: entry.author }),
    stations: entry.stations,
    minutes: entry.minutes,
    budgetId: entry.budgetId,
    generatedAt: entry.generatedAt,
    complete: entry.complete ?? true,
    built: entry.built ?? entry.stations,
    ...(entry.language === undefined ? {} : { language: entry.language }),
    ...(entry.voice === undefined ? {} : { voice: entry.voice }),
    version: 1,
    resources,
  };
};
