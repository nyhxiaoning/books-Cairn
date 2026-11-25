import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SessionInfo, StoredSession } from './types';

const SESSION_FILE_MODE = 0o600;

const isStoredSession = (value: unknown): value is StoredSession => {
  if (typeof value !== 'object' || value === null) return false;
  const session = value as Partial<StoredSession>;
  return typeof session.token === 'string' && session.token.length > 0 &&
    typeof session.expiresAt === 'string' && !Number.isNaN(Date.parse(session.expiresAt));
};

export interface SessionStore {
  read(): Promise<StoredSession | undefined>;
  write(session: SessionInfo): Promise<void>;
  clear(): Promise<void>;
}

export function createSessionStore(file: string): SessionStore {
  return {
    async read(): Promise<StoredSession | undefined> {
      try {
        const value: unknown = JSON.parse(await readFile(file, 'utf8'));
        if (!isStoredSession(value)) return undefined;
        if (Date.parse(value.expiresAt) <= Date.now()) {
          await rm(file, { force: true });
          return undefined;
        }
        return { token: value.token, expiresAt: new Date(value.expiresAt).toISOString() };
      } catch {
        return undefined;
      }
    },

    async write(session: SessionInfo): Promise<void> {
      if (!isStoredSession(session) || Date.parse(session.expiresAt) <= Date.now()) {
        throw new Error('invalid_session');
      }
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      await writeFile(file, JSON.stringify({ token: session.token, expiresAt: session.expiresAt }), {
        encoding: 'utf8', mode: SESSION_FILE_MODE,
      });
      await chmod(file, SESSION_FILE_MODE);
    },

    async clear(): Promise<void> {
      await rm(file, { force: true });
    },
  };
}
