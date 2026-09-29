import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_SHELL_SETTINGS, parseSettings, upgradeLegacyKeys,
  type ProviderProfiles, type ShellSettingsValues,
} from '../shared/settings';

/** A profile the patch does not mention is kept, so editing OpenAI cannot wipe Anthropic. */
function mergeProviders(current: ProviderProfiles, patch: ProviderProfiles): ProviderProfiles {
  return { ...current, ...patch };
}

/** Marks a file written since key fields took `$NAME`; see `upgradeLegacyKeys`. */
const KEY_REFS = 1;

function isLegacy(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && (raw as { keyRefs?: unknown }).keyRefs !== KEY_REFS;
}

export function createSettingsStore(root: string) {
  const file = join(root, 'settings.json');
  let cached: ShellSettingsValues | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  const read = async (): Promise<ShellSettingsValues> => {
    if (cached) return cached;
    try {
      const raw = JSON.parse(await readFile(file, 'utf8')) as unknown;
      cached = parseSettings(isLegacy(raw) ? upgradeLegacyKeys(raw) : raw);
    } catch {
      cached = DEFAULT_SHELL_SETTINGS;
    }
    return cached;
  };

  const write = (patch: Partial<ShellSettingsValues>): Promise<ShellSettingsValues> => {
    const nextWrite = queue.then(async () => {
      const current = await read();
      const next = parseSettings({
        ...current, ...patch,
        ...(patch.providers ? { providers: mergeProviders(current.providers, patch.providers) } : {}),
      }, current);
      await writeFile(file, JSON.stringify({ ...next, keyRefs: KEY_REFS }, null, 2));
      cached = next;
      return next;
    });
    queue = nextWrite.catch(() => undefined);
    return nextWrite;
  };

  return { read, write };
}
