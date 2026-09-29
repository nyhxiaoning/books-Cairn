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
