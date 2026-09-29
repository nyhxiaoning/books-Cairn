import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SHELL_SETTINGS } from '../../src/shared/settings';
import { createSettingsStore } from '../../src/main/settings-store';
import { effectiveWereadKey } from '../../src/main/settings';

const dir = await mkdtemp(join(tmpdir(), 'cairn-settings-'));
const { read: readSettings, write: writeSettings } = createSettingsStore(dir);

afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

test('persists provider profiles and keys, and an empty field clears one', async () => {
  await writeSettings({
    generationProvider: 'openai',
    providers: { openai: { apiKey: 'secret-model', baseUrl: 'https://example.test/v1', model: 'gpt-5.4-mini' } },
  });
  expect((await readSettings()).providers.openai?.apiKey).toBe('secret-model');
  expect(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')).generationProvider).toBe('openai');

  await writeSettings({ providers: { openai: { apiKey: '', baseUrl: '', model: '' } }, wereadKey: '' });
  expect((await readSettings()).providers.openai?.apiKey).toBe('');
  expect((await readSettings()).wereadKey).toBe('');
});

/**
 * The reason profiles are keyed by provider rather than by role. The old shape
 * had one key per role, so switching vendors had to drop it; here editing one
 * provider must leave every other provider's key exactly where it was.
 */
test('editing one provider leaves the others’ keys untouched', async () => {
  await writeSettings({
    providers: {
      openai: { apiKey: 'secret-openai', baseUrl: '', model: '' },
      anthropic: { apiKey: 'secret-anthropic', baseUrl: '', model: '' },
    },
  });


  // A patch naming only OpenAI, as the panel sends when that field is edited
  await writeSettings({ providers: { openai: { apiKey: 'replaced', baseUrl: '', model: '' } } });

  const stored = await readSettings();
  expect(stored.providers.openai?.apiKey).toBe('replaced');
  expect(stored.providers.anthropic?.apiKey).toBe('secret-anthropic');
});

test('the Companion provider keeps its own key when generation changes', async () => {
  await writeSettings({
    chatProvider: 'anthropic',
    providers: { anthropic: { apiKey: 'secret-companion', baseUrl: '', model: 'claude-haiku-4-5' } },
  });

  await writeSettings({ trace: true, generationProvider: 'openai' });
  expect((await readSettings()).providers.anthropic)
    .toEqual({ apiKey: 'secret-companion', baseUrl: '', model: 'claude-haiku-4-5' });
  expect((await readSettings()).chatProvider).toBe('anthropic');
});



test('a $NAME in the WeChat Reading field reads the environment', async () => {
  await writeSettings({ wereadKey: '$WEREAD_API_KEY' });
  expect(effectiveWereadKey(await readSettings(), { WEREAD_API_KEY: 'from-env' })).toBe('from-env');
  await writeSettings({ wereadKey: 'typed' });
  expect(effectiveWereadKey(await readSettings(), { WEREAD_API_KEY: 'from-env' })).toBe('typed');
});

/** Before `$NAME`, an empty field meant "read the environment"; such a file must keep doing so. */
test('a file from before $NAME keeps reading the environment; one written since keeps its empty', async () => {
  const legacyDir = await mkdtemp(join(tmpdir(), 'cairn-legacy-'));
  try {
    await writeFile(join(legacyDir, 'settings.json'), JSON.stringify({ wereadKey: '' }));
    const legacy = createSettingsStore(legacyDir);
    expect((await legacy.read()).wereadKey).toBe('$WEREAD_API_KEY');

    await legacy.write({ wereadKey: '' });
    expect((await createSettingsStore(legacyDir).read()).wereadKey).toBe('');
  } finally {
    await rm(legacyDir, { recursive: true, force: true });
  }
});
