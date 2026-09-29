/**
 * Providers on the left, the selected one's settings on the right.
 *
 * The model picker lists constrained models first and the rest after them. That
 * order is not tidiness: the pipeline asks for structured output on roughly a
 * hundred calls per book, and a provider that treats the schema as a suggestion
 * fails in ones and twos, far from the setting that caused it.
 */
import { useId, useState } from 'react';
import type { ReactElement } from 'react';
import { Link } from '../Link';
import { useUi } from './SettingsProvider';
import { isEnvRef, Offline, Row, SecretField, Section, Select, StackedRow } from './rows';
import type { ProviderInfo, ShellSettings } from './shell';

export function ModelsPage({ shell }: { shell?: ShellSettings }): ReactElement {
  const { t } = useUi();
  const [selected, setSelected] = useState<string | undefined>();

  if (!shell) return <Offline title={t.settings.pages.models} />;

  const current = shell.providers.find((p) => p.id === (selected ?? shell.prefs.generationProvider))
    ?? shell.providers[0];

  return (
    <div className="set-split">
      <aside className="set-providers">
        <span className="set-providers-title">{t.settings.models.providers}</span>
        {shell.providers.map((provider) => (
          <ProviderRow
            key={provider.id}
            provider={provider}
            active={current?.id === provider.id}
            isDefault={shell.prefs.generationProvider === provider.id}
            // A `$NAME` may name a variable that is not set, so only a typed key earns the dot
            configured={isTypedKey(shell.prefs.providers[provider.id]?.apiKey)}
            onPick={() => setSelected(provider.id)}
          />
        ))}
      </aside>

      <div className="set-split-body">
        {current ? <ProviderDetail shell={shell} provider={current} /> : null}
        <ChatRow shell={shell} />
      </div>
    </div>
  );
}

function ProviderRow({ provider, active, isDefault, configured, onPick }: {
  provider: ProviderInfo;
  active: boolean;
  isDefault: boolean;
  configured: boolean;
  onPick: () => void;
}): ReactElement {
  const { t } = useUi();

  return (
    <button
      type="button"
      className="set-provider"
      aria-current={active ? 'true' : undefined}
      onClick={onPick}
    >
      <Favicon domain={provider.faviconDomain} />
      <span className="set-provider-name">{provider.label}</span>
      {isDefault ? <span className="set-provider-tag">{t.settings.models.defaultLabel}</span> : null}
      {!isDefault && configured ? <span className="set-provider-dot" aria-hidden="true" /> : null}
    </button>
  );
}

function ProviderDetail({ shell, provider }: {
  shell: ShellSettings;
  provider: ProviderInfo;
}): ReactElement {
  const { t } = useUi();
  const keyId = useId();
  const urlId = useId();
  const modelId = useId();

  const profile = shell.prefs.providers[provider.id];
  const offered = [...provider.models].sort((a, b) => Number(b.strict) - Number(a.strict));
  const chosen = profile?.model ?? '';
  const isDefault = shell.prefs.generationProvider === provider.id;

  return (
    <Section title={provider.label}>
      {provider.signIn ? (
        <div className="set-row">
          <span className="set-hint">{t.settings.models.signedInAccount}</span>
        </div>
      ) : (
        <>
          <StackedRow
            label={t.settings.models.apiKey}
            htmlFor={keyId}
            aside={provider.getKeyUrl ? (
              <Link className="set-link" href={provider.getKeyUrl}>
                {t.settings.models.getKey}
              </Link>
            ) : undefined}
          >
            <SecretField
              id={keyId}
              value={profile?.apiKey ?? (provider.envKey ? `$${provider.envKey}` : '')}
              onChange={(value) => shell.setProvider(provider.id, { apiKey: value })}
              showLabel={t.settings.models.showKey}
              hideLabel={t.settings.models.hideKey}
            />
          </StackedRow>

          <Row
            label={t.settings.models.baseUrl}
            {...(provider.needsBaseUrl ? { hint: t.settings.models.baseUrlRequired } : {})}
            htmlFor={urlId}
          >
            <input
              id={urlId}
              className="set-input"
              value={profile?.baseUrl ?? ''}
              placeholder={provider.baseUrl || t.settings.models.baseUrlPlaceholder}
              onChange={(e) => shell.setProvider(provider.id, { baseUrl: e.target.value })}
            />
          </Row>
        </>
      )}

      {provider.models.length > 0 ? (
        <Row
          label={t.settings.models.modelName}
          hint={t.settings.models.modelHint}
          htmlFor={modelId}
        >
          <Select
            id={modelId}
            value={chosen}
            choices={[
              { value: '', label: t.settings.models.modelDefault },
              ...offered.map((m) => ({ value: m.id, label: m.name })),
            ]}
            onPick={(value) => shell.setProvider(provider.id, { model: value })}
          />
        </Row>
      ) : (
        <Row label={t.settings.models.modelName} hint={t.settings.models.modelCustom} htmlFor={modelId}>
          <input
            id={modelId}
            className="set-input"
            value={chosen}
            onChange={(e) => shell.setProvider(provider.id, { model: e.target.value })}
          />
        </Row>
      )}

      <Row
        label={t.settings.models.status}
        hint={shell.modelStatus
          ? (
            <span className={shell.modelStatus.ready ? 'set-hint ok' : 'set-hint warn'}>
              {shell.modelStatus.ready
                ? t.settings.models.statusReady(shell.modelStatus.provider, shell.modelStatus.detail)
                : t.settings.models.statusNoKey}
            </span>
          )
          : undefined}
      >
        {isDefault ? (
          <button type="button" className="set-btn" onClick={shell.recheckModel}>
            {t.settings.models.recheck}
          </button>
        ) : (
          <button
            type="button"
            className="set-btn"
            onClick={() => shell.setPref('generationProvider', provider.id)}
          >
            {t.settings.models.setDefault}
          </button>
        )}
      </Row>
    </Section>
  );
}

function ChatRow({ shell }: { shell: ShellSettings }): ReactElement {
  const { t } = useUi();
  const id = useId();

  return (
    <Section title={t.settings.models.chatSource}>
      <Row label={t.settings.models.chatSource} hint={t.settings.models.chatHint} htmlFor={id}>
        <Select
          id={id}
          value={shell.prefs.chatProvider}
          choices={[
            { value: 'inherit', label: t.settings.models.chatInherit },
            ...shell.providers.map((p) => ({ value: p.id, label: p.label })),
          ]}
          onPick={(value) => shell.setPref('chatProvider', value)}
        />
      </Row>
    </Section>
  );
}

/** Loaded from the vendor's own domain; a blocked request just leaves a gap. */
function Favicon({ domain }: { domain: string }): ReactElement {
  if (!domain) return <span className="set-provider-icon" aria-hidden="true" />;
  return (
    <img
      className="set-provider-icon"
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
      alt=""
      onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
    />
  );
}

function isTypedKey(key: string | undefined): boolean {
  return Boolean(key) && !isEnvRef(key ?? '');
}
