/**
 * The settings that live on disk, beside the library rather than inside the app.
 *
 * `~/Library/Application Support/Cairn/settings.json`, for the same reason the
 * books are there: the app's working directory is rebuilt on every
 * `electrobun dev`, so anything written beside the binary is gone by the next
 * launch.
 *
 * Environment variables still win where they always did. `CAIRN_TRACE=1` and
 * `TAVILY_API_KEY` were the only way to set these before this file existed, and
 * a machine configured that way should not silently start ignoring them.
 */
import { DATA_DIR } from './store';
import { createSettingsStore } from './settings-store';
import { resolveSecret, type ShellSettingsValues } from '../shared/settings';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface SyncSettings {
  readonly enabled: boolean;
  readonly workerUrl: string;
  readonly username: string;
}

export const DEFAULT_SYNC_SETTINGS: SyncSettings = { enabled: false, workerUrl: '', username: '' };
const syncSettingsFile = join(DATA_DIR, 'sync-settings.json');

const parseSyncSettings = (value: unknown): SyncSettings => {
  if (typeof value !== 'object' || value === null) return DEFAULT_SYNC_SETTINGS;
  const raw = value as Record<string, unknown>;
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_SYNC_SETTINGS.enabled,
    workerUrl: typeof raw.workerUrl === 'string' ? raw.workerUrl : DEFAULT_SYNC_SETTINGS.workerUrl,
    username: typeof raw.username === 'string' ? raw.username : DEFAULT_SYNC_SETTINGS.username,
  };
};

export async function readSyncSettings(): Promise<SyncSettings> {
  try { return parseSyncSettings(JSON.parse(await readFile(syncSettingsFile, 'utf8'))); }
  catch { return DEFAULT_SYNC_SETTINGS; }
}

export async function writeSyncSettings(patch: Partial<SyncSettings>): Promise<SyncSettings> {
  const next = parseSyncSettings({ ...(await readSyncSettings()), ...patch });
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(syncSettingsFile, JSON.stringify(next, null, 2));
  return next;
}

const settingsStore = createSettingsStore(DATA_DIR);
export const readSettings = settingsStore.read;
export const writeSettings = settingsStore.write;

type Env = Readonly<Record<string, string | undefined>>;

export function effectiveWereadKey(settings: ShellSettingsValues, env: Env = process.env): string | undefined {
  return resolveSecret(settings.wereadKey, env);
}

/** Either switch turns tracing on; the environment cannot be overridden to off. */
export async function tracingOn(): Promise<boolean> {
  return process.env.CAIRN_TRACE === '1' || (await readSettings()).trace;
}
