import { createHash } from 'node:crypto';
import type { Library } from '../store/library-disk';
import type { LibraryEntry, LibrarySyncFile } from '../store/library';
import {
  buildSyncManifest, isSyncablePath, syncContentType, type SyncFile, type SyncManifest,
} from './manifest';

export interface SyncBundleFile extends SyncFile {
  readonly bytes: Uint8Array;
}

export interface SyncBundle {
  readonly manifest: SyncManifest;
  readonly files: readonly SyncBundleFile[];
}

export async function exportSyncBook(library: Library, bookId: string): Promise<SyncBundle> {
  const entry = (await library.list()).find((candidate) => candidate.id === bookId);
  if (!entry) throw new Error('book_not_found');
  const files = await library.readSyncFiles(bookId);
  const syncFiles = files.map(toSyncFile);
  return { manifest: buildSyncManifest(entry, syncFiles), files: syncFiles };
}

export function validateSyncBundle(value: unknown): SyncBundle {
  if (!isRecord(value) || !isRecord(value.manifest) || !Array.isArray(value.files)) {
    throw new Error('invalid_sync_bundle');
  }
  const manifest = validateManifest(value.manifest);
  const files = value.files.map(validateFile);
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.path) || !manifest.resources.some((resource) => sameFile(resource, file))) {
      throw new Error('invalid_sync_bundle');
    }
    seen.add(file.path);
  }
  if (files.length !== manifest.resources.length
    || !seen.has('path.json') || !seen.has('decks/index.json')) throw new Error('invalid_sync_bundle');
  return { manifest, files };
}

export async function installSyncBook(
  library: Library,
  bundle: SyncBundle,
  tempRoot: string,
): Promise<LibraryEntry> {
  const valid = validateSyncBundle(bundle);
  const files: readonly LibrarySyncFile[] = valid.files.map(({ path, bytes }) => ({ path, bytes }));
  return library.installSyncFiles(valid.manifest.bookId, entryFromManifest(valid.manifest), files, tempRoot);
}

function toSyncFile(file: LibrarySyncFile): SyncBundleFile {
  const contentType = syncContentType(file.path);
  if (!contentType) throw new Error('invalid_sync_resource');
  return {
    path: file.path,
    contentType,
    byteSize: file.bytes.byteLength,
    contentHash: hash(file.bytes),
    bytes: file.bytes,
  };
}

function validateFile(value: unknown): SyncBundleFile {
  if (!isRecord(value) || typeof value.path !== 'string' || !isSyncablePath(value.path)
    || typeof value.contentType !== 'string' || typeof value.byteSize !== 'number'
    || !Number.isSafeInteger(value.byteSize) || value.byteSize < 0
    || typeof value.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.contentHash)) {
    throw new Error('invalid_sync_bundle');
  }
  const bytes = toBytes(value.bytes);
  const expectedType = syncContentType(value.path);
  if (!expectedType || value.contentType !== expectedType || value.byteSize !== bytes.byteLength
    || value.contentHash !== hash(bytes)) throw new Error('invalid_sync_bundle');
  return { path: value.path, contentType: value.contentType, byteSize: value.byteSize, contentHash: value.contentHash, bytes };
}

function validateManifest(value: Record<string, unknown>): SyncManifest {
  if (typeof value.bookId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.bookId)
    || typeof value.title !== 'string' || !Number.isSafeInteger(value.stations) || (value.stations as number) < 0
    || typeof value.minutes !== 'number' || !Number.isFinite(value.minutes) || value.minutes < 0
    || typeof value.budgetId !== 'string'
    || typeof value.generatedAt !== 'string' || typeof value.complete !== 'boolean'
    || !Number.isSafeInteger(value.built) || (value.built as number) < 0
    || !Number.isSafeInteger(value.version) || (value.version as number) < 1
    || !Array.isArray(value.resources)) throw new Error('invalid_sync_bundle');
  const stations = value.stations as number;
  const minutes = value.minutes as number;
  const built = value.built as number;
  const version = value.version as number;
  const resources = value.resources.map(validateManifestFile);
  if (new Set(resources.map((resource) => resource.path)).size !== resources.length) {
    throw new Error('invalid_sync_bundle');
  }
  return {
    bookId: value.bookId, title: value.title,
    ...(typeof value.author === 'string' ? { author: value.author } : {}),
    stations, minutes, budgetId: value.budgetId,
    generatedAt: value.generatedAt, complete: value.complete, built,
    ...(value.language === 'en' || value.language === 'zh' ? { language: value.language } : {}),
    ...(typeof value.voice === 'string' ? { voice: value.voice } : {}),
    version, resources,
  };
}

function validateManifestFile(value: unknown): SyncFile {
  if (!isRecord(value) || typeof value.path !== 'string' || !isSyncablePath(value.path)
    || typeof value.contentType !== 'string' || typeof value.byteSize !== 'number'
    || !Number.isSafeInteger(value.byteSize) || value.byteSize < 0
    || typeof value.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.contentHash)
    || syncContentType(value.path) !== value.contentType) throw new Error('invalid_sync_bundle');
  return { path: value.path, contentType: value.contentType, byteSize: value.byteSize, contentHash: value.contentHash };
}

function entryFromManifest(manifest: SyncManifest): LibraryEntry {
  return {
    id: manifest.bookId, title: manifest.title,
    ...(manifest.author === undefined ? {} : { author: manifest.author }),
    stations: manifest.stations, minutes: manifest.minutes, budgetId: manifest.budgetId,
    generatedAt: manifest.generatedAt, complete: manifest.complete, built: manifest.built,
    ...(manifest.language === undefined ? {} : { language: manifest.language }),
    ...(manifest.voice === undefined ? {} : { voice: manifest.voice }),
  };
}

function sameFile(left: SyncFile, right: SyncFile): boolean {
  return left.path === right.path && left.contentType === right.contentType
    && left.byteSize === right.byteSize && left.contentHash === right.contentHash;
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  throw new Error('invalid_sync_bundle');
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
