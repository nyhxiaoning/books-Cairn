import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bookFile, isBookId } from './library';
import { parseUniverse, type BookUniverse } from '../universe/types';

export type UniverseMutation = (current: BookUniverse) => BookUniverse;

export interface UniverseStore {
  read(bookId: string): Promise<BookUniverse | undefined>;
  install(bookId: string, next: BookUniverse): Promise<BookUniverse>;
  patch(bookId: string, mutation: UniverseMutation): Promise<BookUniverse | undefined>;
  remove(bookId: string): Promise<void>;
}

/** Persists the reader-owned universe beside the book it describes. */
export function openUniverseStore(root: string): UniverseStore {
  const fileFor = (bookId: string): string => join(root, bookFile(bookId, 'universe.json'));
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  const requireBookId = (bookId: string): void => {
    if (!isBookId(bookId)) throw new Error(`Invalid book id: ${bookId}`);
  };
  const validate = (bookId: string, next: unknown): BookUniverse => {
    const parsed = parseUniverse(next);
    if (parsed === undefined || parsed.bookId !== bookId) throw new Error('Invalid book universe');
    return parsed;
  };
  const read = async (bookId: string): Promise<BookUniverse | undefined> => {
    if (!isBookId(bookId)) return undefined;
    try {
      return parseUniverse(JSON.parse(await readFile(fileFor(bookId), 'utf8')));
    } catch (error) {
      if (error instanceof SyntaxError || isNotFound(error)) return undefined;
      throw error;
    }
  };
  const install = async (bookId: string, next: BookUniverse): Promise<BookUniverse> => {
    requireBookId(bookId);
    const parsed = validate(bookId, next);
    await writeAtomic(fileFor(bookId), JSON.stringify(parsed));
    return parsed;
  };

  return {
    read,
    install: (bookId, next) => serialize(() => install(bookId, next)),
    patch: (bookId, mutation) => serialize(async () => {
      requireBookId(bookId);
      const current = await read(bookId);
      if (current === undefined) return undefined;
      return install(bookId, mutation(current));
    }),
    remove: (bookId) => serialize(async () => {
      requireBookId(bookId);
      await rm(fileFor(bookId), { force: true });
    }),
  };
}

const isNotFound = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

async function writeAtomic(file: string, contents: string): Promise<void> {
  await mkdir(join(file, '..'), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, contents);
  await rename(tmp, file);
}
