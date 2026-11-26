import { useEffect, useId, useState } from 'react';
import type { ReactElement } from 'react';
import { useUi } from './SettingsProvider';
import type { ShellSettings, SyncProgress, SyncState } from './shell';
import { Offline, Row, Section, StackedRow } from './rows';

const statusCopy = (state: SyncState, t: ReturnType<typeof useUi>['t']): string => ({
  disabled: t.settings.sync.statusDisabled,
  idle: t.settings.sync.statusIdle,
  syncing: t.settings.sync.statusSyncing,
  success: t.settings.sync.statusSuccess,
  error: t.settings.sync.statusError,
  conflict: t.settings.sync.statusConflict,
}[state]);

const progressPercent = (progress: SyncProgress): number => {
  if (progress.totalBooks <= 0) return 0;
  return Math.min(100, Math.max(0, (progress.completedBooks / progress.totalBooks) * 100));
};

export function SyncPage({ shell }: { shell?: ShellSettings }): ReactElement {
  const { t } = useUi();
  const workerId = useId();
  const usernameId = useId();
  const passwordId = useId();
  const [workerUrl, setWorkerUrl] = useState(shell?.sync.workerUrl ?? '');
  const [username, setUsername] = useState(shell?.sync.username ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!shell) return;
    setWorkerUrl(shell.sync.workerUrl);
    setUsername(shell.sync.username);
  }, [shell?.sync.workerUrl, shell?.sync.username]);

  if (!shell) return <Offline title={t.settings.pages.sync} />;

  const run = async (action: () => Promise<void>, success: string): Promise<void> => {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await action();
      setMessage(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const configure = (): void => {
    void run(async () => {
      const next = await shell.sync.configure(workerUrl);
      if (next) return;
    }, t.settings.sync.configured);
  };

  const login = (): void => {
    if (!workerUrl.trim()) {
      setError(t.settings.sync.notConfigured);
      return;
    }
    void run(async () => {
      await shell.sync.configure(workerUrl);
      try {
        await shell.sync.login(username, password);
      } finally {
        // The password is a request-only value and must never survive the request.
        setPassword('');
      }
    }, t.settings.sync.loggedIn);
  };

  return (
    <Section title={t.settings.sync.title}>
      <p className="set-hint">{t.settings.sync.hint}</p>

      <StackedRow label={t.settings.sync.workerUrl} htmlFor={workerId}>
        <input
          id={workerId}
          className="set-input"
          type="url"
          value={workerUrl}
          placeholder={t.settings.sync.workerUrlPlaceholder}
          autoComplete="url"
          onChange={(event) => setWorkerUrl(event.currentTarget.value)}
        />
        <button type="button" className="set-btn" disabled={busy || !workerUrl.trim()} onClick={configure}>
          {t.settings.sync.configure}
        </button>
      </StackedRow>

      <Row label={t.settings.sync.username} htmlFor={usernameId}>
        <input
          id={usernameId}
          className="set-input"
          type="text"
          value={username}
          autoComplete="username"
          onChange={(event) => setUsername(event.currentTarget.value)}
        />
      </Row>

      <Row label={t.settings.sync.password} htmlFor={passwordId}>
        <input
          id={passwordId}
          className="set-input"
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={(event) => setPassword(event.currentTarget.value)}
        />
      </Row>

      <Row label={t.settings.sync.status} hint={statusCopy(shell.sync.status.state, t)}>
        <span className={shell.sync.status.state === 'error' ? 'set-hint bad' : 'set-hint'}>
          {shell.sync.status.message ?? statusCopy(shell.sync.status.state, t)}
        </span>
      </Row>

      {shell.sync.status.progress && <SyncProgressView progress={shell.sync.status.progress} t={t} />}

      {shell.sync.status.lastSuccessAt && (
        <div className="set-row">
          <span className="set-hint">{t.settings.sync.lastSuccess(formatDate(shell.sync.status.lastSuccessAt))}</span>
        </div>
      )}

      {shell.sync.status.failedBookIds.length > 0 && (
        <div className="set-row">
          <span className="set-hint bad">{t.settings.sync.failedBooks(shell.sync.status.failedBookIds.length)}</span>
        </div>
      )}

      {message && <div className="set-row"><span className="set-hint">{message}</span></div>}
      {error && <div className="set-row"><span className="set-hint bad">{error}</span></div>}

      <div className="set-row">
        <span className="set-control set-confirm">
          <button type="button" className="set-btn" disabled={busy} onClick={() => void run(shell.sync.logout, t.settings.sync.loggedOut)}>
            {t.settings.sync.logout}
          </button>
        </span>
      </div>

      <div className="set-row">
        <span className="set-control">
          <button type="button" className="set-btn" disabled={busy || !workerUrl.trim() || !username.trim() || !password} onClick={login}>
            {t.settings.sync.login}
          </button>
        </span>
      </div>
    </Section>
  );
}

function SyncProgressView({
  progress,
  t,
}: {
  readonly progress: SyncProgress;
  readonly t: ReturnType<typeof useUi>['t'];
}): ReactElement {
  const percent = progressPercent(progress);
  return (
    <div className="set-row" data-testid="sync-progress">
      <progress className="set-progress" max={100} value={percent} aria-label={t.settings.sync.booksProgress(progress.completedBooks, progress.totalBooks)} />
      <span className="set-hint">{t.settings.sync.booksProgress(progress.completedBooks, progress.totalBooks)}</span>
      {progress.currentBookTitle && <span className="set-hint">{t.settings.sync.currentBook(progress.currentBookTitle)}</span>}
      <span className="set-hint">{t.settings.sync.progressPhase[progress.phase]}</span>
      <span className="set-hint">{t.settings.sync.resourcesProgress(progress.completedResources, progress.totalResources)}</span>
      {progress.currentResourcePath && <span className="set-hint">{t.settings.sync.currentResource(progress.currentResourcePath)}</span>}
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}
