import { describe, expect, test } from 'bun:test';
import { DEFAULT_SHELL_SETTINGS } from '../../../src/shared/settings';
import { resolveChatModel, ChatModelError } from '../../../src/main/companion/model';

describe('resolveChatModel', () => {
  const none = { env: {}, codex: async () => undefined };

  test('Codex answers with the signed-in account', async () => {
    const resolved = await resolveChatModel({ ...DEFAULT_SHELL_SETTINGS, generationProvider: 'openai-codex' }, {
      env: {}, codex: async () => ({ mode: 'oauth', apiKey: 'test-token' }),
    });
    expect(resolved.model.provider).toBe('openai-codex');
    expect(resolved.model.id).toBe('gpt-6-sol');
    expect(await resolved.getApiKey('openai-codex')).toBe('test-token');
  });

  test('nothing configured anywhere is reported before any request', async () => {
    await expect(resolveChatModel(DEFAULT_SHELL_SETTINGS, none)).rejects.toBeInstanceOf(ChatModelError);
  });


  test('`inherit` follows the generation provider', async () => {
    const resolved = await resolveChatModel({
      ...DEFAULT_SHELL_SETTINGS,
      generationProvider: 'anthropic',
      chatProvider: 'inherit',
      providers: { anthropic: { apiKey: 'secret', baseUrl: '', model: 'claude-haiku-4-5' } },
    }, none);

    expect(resolved.model.provider).toBe('anthropic');
    expect(resolved.model.id).toBe('claude-haiku-4-5');
    expect(await resolved.getApiKey('anthropic')).toBe('secret');
  });

  test('a custom endpoint carries its own base URL', async () => {
    const resolved = await resolveChatModel({
      ...DEFAULT_SHELL_SETTINGS,
      generationProvider: 'custom',
      providers: { custom: { apiKey: 'secret', baseUrl: 'https://example.com/v1', model: 'custom-chat' } },
    }, none);

    expect(resolved.model.id).toBe('custom-chat');
    expect(resolved.model.baseUrl).toBe('https://example.com/v1');
    expect(await resolved.getApiKey('custom')).toBe('secret');
  });

  test.each([
    { id: 'anthropic' as const, model: 'claude-haiku-4-5', api: 'anthropic-messages' },
    { id: 'deepseek' as const, model: 'deepseek-v4-pro', api: 'openai-completions' },
    { id: 'minimax' as const, model: 'MiniMax-M2.7', api: 'anthropic-messages' },
    { id: 'minimax-cn' as const, model: 'MiniMax-M2.7', api: 'anthropic-messages' },
  ])('resolves a $id Companion without changing generation', async ({ id, model, api }) => {
    const resolved = await resolveChatModel({
      ...DEFAULT_SHELL_SETTINGS,
      generationProvider: 'openai',
      chatProvider: id,
      providers: {
        openai: { apiKey: 'generation-only', baseUrl: '', model: '' },
        [id]: { apiKey: 'chat-only', baseUrl: '', model },
      },
    }, none);
    expect(resolved.model.provider).toBe(id);
    expect(resolved.model.api).toBe(api);
    expect(resolved.model.id).toBe(model);
    expect(await resolved.getApiKey(id)).toBe('chat-only');
    // The generation key must not be reachable through the Companion's resolver
    expect(await resolved.getApiKey('openai')).toBeUndefined();
  });

  test('an empty model falls back to the provider default, not to nothing', async () => {
    const resolved = await resolveChatModel({
      ...DEFAULT_SHELL_SETTINGS,
      chatProvider: 'deepseek',
      providers: { deepseek: { apiKey: 'secret', baseUrl: '', model: '' } },
    }, none);
    expect(resolved.model.id).toBe('deepseek-flash');
  });

  test('a chat model override does not change the generation provider profile', async () => {
    const settings = {
      ...DEFAULT_SHELL_SETTINGS,
      generationProvider: 'openai' as const,
      chatProvider: 'deepseek' as const,
      chatModel: 'deepseek-v4-pro',
      providers: {
        openai: { apiKey: 'generation-secret', baseUrl: '', model: 'gpt-5.4-mini' },
        deepseek: { apiKey: 'chat-secret', baseUrl: '', model: 'deepseek-flash' },
      },
    };
    const resolved = await resolveChatModel(settings, none);
    expect(resolved.model.id).toBe('deepseek-v4-pro');
    expect(settings.providers.openai.model).toBe('gpt-5.4-mini');
  });

  test('a missing Companion key fails before any model request', async () => {
    await expect(resolveChatModel({
      ...DEFAULT_SHELL_SETTINGS,
      chatProvider: 'anthropic',
      providers: { anthropic: { apiKey: '', baseUrl: '', model: 'claude-haiku-4-5' } },
    }, none)).rejects.toMatchObject({ code: 'no_credential' });
  });

  test('an unavailable provider model fails explicitly', async () => {
    await expect(resolveChatModel({
      ...DEFAULT_SHELL_SETTINGS,
      chatProvider: 'deepseek',
      providers: { deepseek: { apiKey: 'secret', baseUrl: '', model: 'not-in-catalog' } },
    }, none)).rejects.toMatchObject({ code: 'model_unavailable' });
  });




});
