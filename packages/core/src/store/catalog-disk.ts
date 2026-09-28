import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  applyCatalogPatch, emptyCatalog, parseCatalog,
  type CatalogFile, type CatalogPatch,
} from '../catalog/types';

export interface CatalogStore {
  read(): Promise<CatalogFile>;
  patch(bookId: string, patch: CatalogPatch): Promise<CatalogFile>;
  remove(bookId: string): Promise<void>;
}

export function openCatalog(root: string, now: () => string = () => new Date().toISOString()): CatalogStore {
  const file = join(root, 'catalog.json');
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  const read = async (): Promise<CatalogFile> => {
    try {
      return parseCatalog(JSON.parse(await readFile(file, 'utf8')));
    } catch (error) {
      if (error instanceof SyntaxError || isNotFound(error)) return emptyCatalog();
      throw error;
    }
  };

  return {
    read,
    patch: (bookId, patch) => serialize(async () => {
      const catalog = applyCatalogPatch(await read(), bookId, patch, now());
      await writeAtomic(file, JSON.stringify(catalog));
      return catalog;
    }),
    remove: (bookId) => serialize(async () => {
      const catalog = await read();
      if (!(bookId in catalog.records)) return;
      const { [bookId]: _, ...records } = catalog.records;
      await writeAtomic(file, JSON.stringify({ version: 1, records }));
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
