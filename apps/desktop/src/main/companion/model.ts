import type { Api, Model } from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { ShellSettingsValues } from '../../shared/settings';
import { codexCredentials } from '../codex-provider';
import { piRegistry } from '../pi-provider';
import type { ResolveInputs } from '../provider';
import { resolveRoute, routeFor } from '../route';

export class ChatModelError extends Error {
  constructor(readonly code: 'no_credential' | 'model_unavailable') {
    super(code);
    this.name = 'ChatModelError';
  }
}

export interface ChatModelResolution {
  readonly model: Model<Api>;
  readonly streamFn: StreamFn;
  readonly getApiKey: (provider: string) => Promise<string | undefined>;
}

/** `inherit` answers with whatever generation would use; a named provider must have credentials itself. */
export async function resolveChatModel(
  settings: ShellSettingsValues,
  inputs: ResolveInputs = {},
): Promise<ChatModelResolution> {
  const env = inputs.env ?? process.env;
  const codex = await (inputs.codex ?? codexCredentials)();
  const route = settings.chatProvider === 'inherit'
    ? resolveRoute(settings, env, codex)
    : routeFor(settings, settings.chatProvider, env, codex, settings.chatModel);
  if (!route) throw new ChatModelError('no_credential');

  const built = piRegistry(route.id, route.model, route.baseUrl || undefined, route.codex);
  if (!built) throw new ChatModelError('model_unavailable');

  const model = built.model as Model<Api>;
  return {
    model,
    streamFn: built.models.streamSimple.bind(built.models),
    getApiKey: async (requested) =>
      (requested === route.id || requested === model.provider ? route.apiKey : undefined),
  };
}
