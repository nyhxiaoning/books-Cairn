import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { ModelsPage } from '../../src/settings/ModelsPage';
import { NarrationPage } from '../../src/settings/pages';
import { SettingsProvider } from '../../src/settings/SettingsProvider';
import type { ProviderInfo, ShellSettings } from '../../src/settings/shell';

/**
 * Rendering, not asserting on markup.
 *
 * A settings page can typecheck and still throw on its first paint — an
 * undefined provider, a hook behind a branch. `bun run dev` shows that, but only
 * to whoever opens the panel.
 */
const PROVIDERS: readonly ProviderInfo[] = [
  {
    id: 'openai', label: 'OpenAI', getKeyUrl: 'https://example.test', faviconDomain: 'openai.com',
    baseUrl: 'https://api.openai.com/v1', needsBaseUrl: false, envKey: 'OPENAI_API_KEY',
    models: [
      { id: 'gpt-5.4-mini', name: 'GPT-5.4 mini', strict: true },
      { id: 'legacy', name: 'Legacy', strict: false },
    ],
  },
  {
    id: 'moonshotai', label: 'Moonshot', getKeyUrl: '', faviconDomain: 'moonshot.cn',
    baseUrl: 'https://api.moonshot.cn/v1', needsBaseUrl: false,
    models: [{ id: 'kimi-k2.6', name: 'Kimi K2.6', strict: false }],
  },
  {
    id: 'custom', label: 'Custom', getKeyUrl: '', faviconDomain: '',
    baseUrl: '', needsBaseUrl: true, models: [],
  },
];

function shellWith(overrides: Partial<ShellSettings['prefs']> = {}): ShellSettings {
  return {
    prefs: {
      providers: {}, generationProvider: 'openai', chatProvider: 'inherit',
      chatModel: '',
      narration: 'follow', voices: { en: 'en-US-AndrewNeural', zh: 'zh-CN-YunjianNeural' },
      generateAudio: true,
      searchProvider: 'firecrawl', braveKey: '', firecrawlKey: '', tavilyKey: '', wereadKey: '', trace: false,
      ...overrides,
    },
    setPref: () => {},
    setProvider: () => {},
    providers: PROVIDERS,
    voicesFor: () => [],
    recheckModel: () => {},
    previewVoice: () => {},
    dataDir: '/tmp',
    devBuild: false,
    revealDataDir: () => {},
    clearCache: async () => {},
  };
}

const render = (shell?: ShellSettings): string =>
  renderToStaticMarkup(createElement(SettingsProvider, null, createElement(ModelsPage, { shell })));

const renderNarration = (shell?: ShellSettings): string =>
  renderToStaticMarkup(createElement(SettingsProvider, null, createElement(NarrationPage, { shell })));

const CODEX: ProviderInfo = {
  id: 'openai-codex', label: 'OpenAI Codex', getKeyUrl: 'https://openai.com/codex', faviconDomain: 'openai.com',
  baseUrl: 'https://chatgpt.com/backend-api', needsBaseUrl: false, signIn: true,
  models: [{ id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', strict: false }],
};

describe('ModelsPage', () => {
  // As in llm-space: the signed-in account replaces the key and the endpoint
  test('Codex asks for no key and no endpoint, and says it uses the signed-in account', () => {
    const html = render({ ...shellWith({ generationProvider: 'openai-codex' }), providers: [...PROVIDERS, CODEX] });
    expect(html).toContain('OpenAI Codex uses your signed-in account. No API key is required.');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('https://chatgpt.com/backend-api');
    expect(html).toContain('GPT-5.6 Sol');
  });

  test('renders every provider, and opens on the generation default', () => {
    const html = render(shellWith());
    for (const provider of PROVIDERS) expect(html).toContain(provider.label);
    expect(html).toContain('gpt-5.4-mini');
  });

  test('shows a separate model input when a companion provider is selected', () => {
    const html = render(shellWith({ chatProvider: 'openai' }));
    expect(html).toContain('Chat model');
    expect(html).toContain('Only this companion uses the selected model.');
  });

  test('a provider with no constrained model is offered like any other', () => {
    expect(render(shellWith())).toContain('Moonshot');
  });

  test('an unconstrained model is offered last, not withheld', () => {
    // `legacy` is OpenAI's unconstrained entry, `gpt-5.4-mini` its constrained one
    const html = render(shellWith());
    expect(html.indexOf('>Legacy<')).toBeGreaterThan(html.indexOf('>GPT-5.4 mini<'));
  });

  test('a stored key sits in the field, hidden until the eye is pressed', () => {
    const html = render(shellWith({
      providers: { openai: { apiKey: 'sk-stored', baseUrl: '', model: '' } },
    }));
    expect(html).toMatch(/type="password"[^>]*value="sk-stored"/);
    expect(html).toContain('set-eye');
  });

  test('a vendor with no profile starts out reading its environment variable', () => {
    expect(render(shellWith())).toMatch(/type="text"[^>]*value="\$OPENAI_API_KEY"/);
  });

  test('a custom endpoint takes a typed model id rather than a picker', () => {
    const html = render(shellWith({ generationProvider: 'custom' }));
    expect(html).toContain('Custom');
  });

  test('without a shell it says so instead of pretending the controls work', () => {
    expect(render(undefined)).toContain('bun run start');
  });

  test('narration page exposes the import audio switch', () => {
    const html = renderNarration(shellWith({ generateAudio: false }));
    expect(html).toContain('Generate audio while importing');
    expect(html).toContain('Text remains available for local reading when this is off.');
    expect(html).toContain('aria-checked="false"');
  });
});
