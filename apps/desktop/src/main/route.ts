/**
 * Which provider actually answers, for generation and the companion alike.
 *
 * llm-space's `resolveModelConfig`: the chosen default if it has credentials,
 * otherwise the first provider that does, by name. Nothing falls back silently to
 * the codex CLI any more — no credentials anywhere is reported, not papered over.
 */
import type { CodexCredentials } from '@cairn/core/runtime';
import { OFFERED_PROVIDERS, type ProviderId } from '../shared/providers';
import {
  defaultApiKey, modelOf, resolveSecret, type ShellSettingsValues,
} from '../shared/settings';

export interface Route {
  readonly id: ProviderId;
  readonly model: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly codex?: CodexCredentials;
}

type Env = Readonly<Record<string, string | undefined>>;

export function routeFor(
  settings: ShellSettingsValues, id: ProviderId, env: Env, codex: CodexCredentials | undefined,
  modelOverride?: string,
): Route | undefined {
  const model = modelOverride?.trim() || modelOf(settings, id);
  if (id === 'openai-codex') {
    return codex ? { id, model, apiKey: codex.apiKey, baseUrl: '', codex } : undefined;
  }
  const profile = settings.providers[id];
  const apiKey = resolveSecret(profile?.apiKey ?? defaultApiKey(id), env) ?? '';
  const baseUrl = profile?.baseUrl.trim() ?? '';
  const available = id === 'custom' ? baseUrl.length > 0 : apiKey.length > 0;
  return available ? { id, model, apiKey, baseUrl } : undefined;
}

export function resolveRoute(
  settings: ShellSettingsValues, env: Env, codex: CodexCredentials | undefined,
): Route | undefined {
  const preferred = routeFor(settings, settings.generationProvider, env, codex);
  if (preferred) return preferred;
  const byName = [...OFFERED_PROVIDERS].sort((a, b) => a.label.localeCompare(b.label));
  for (const provider of byName) {
    const route = routeFor(settings, provider.id, env, codex);
    if (route) return route;
  }
  return undefined;
}
