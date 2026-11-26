import { installSyncBook, exportSyncBook, type SyncBundle, type SyncBundleFile } from '@cairn/core/sync/local';
import { isBookId, type LibraryEntry } from '@cairn/core/store/library';
import type { Library } from '@cairn/core/store/library-disk';
import { isSyncablePath, type SyncFile, type SyncManifest } from '@cairn/core/sync/manifest';
import { createHash } from 'node:crypto';
import { normalizeWorkerUrl, type CloudSyncClient } from './client';
import type { SessionStore } from './session-store';
import type { ManifestReceipt, ResourceUpload, SessionInfo } from './types';
import type {
  AccountStatus, SyncProgress, SyncProgressPhase, SyncState, SyncStatus, SyncSummary,
} from '../../shared/schema';

export type { AccountStatus, SyncState, SyncStatus, SyncSummary };

export interface SyncServiceDeps {
  readonly library: Library;
  readonly client?: CloudSyncClient;
  readonly sessionStore: SessionStore;
  readonly workerUrl?: string;
  readonly createClient?: (workerUrl: string) => CloudSyncClient;
  readonly writeSyncSettings?: (patch: { enabled?: boolean; workerUrl?: string; username?: string }) => Promise<unknown>;
  readonly tempRoot?: string;
  readonly emit?: (status: SyncStatus) => void;
  readonly fetcher?: typeof fetch;
}

const emptySummary = (status: SyncStatus): SyncSummary => ({
  uploadedBookIds: [], downloadedBookIds: [], failedBookIds: status.failedBookIds, status,
});

const sameFile = (left: SyncFile, right: SyncFile): boolean =>
  left.path === right.path && left.contentType === right.contentType &&
  left.byteSize === right.byteSize && left.contentHash === right.contentHash;

const sameManifest = (left: SyncManifest, right: SyncManifest): boolean =>
  left.bookId === right.bookId && left.title === right.title && left.author === right.author &&
  left.stations === right.stations && left.minutes === right.minutes && left.budgetId === right.budgetId &&
  left.generatedAt === right.generatedAt && left.complete === right.complete && left.built === right.built &&
  left.language === right.language && left.voice === right.voice &&
  left.resources.length === right.resources.length &&
  left.resources.every((file) => right.resources.some((candidate) => sameFile(file, candidate)));

const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const syncManifest = (manifest: SyncManifest): SyncManifest => ({
  ...manifest,
  resources: manifest.resources.filter((resource) => isSyncablePath(resource.path)),
});

const jsonResponse = async (response: Response): Promise<Record<string, unknown>> => {
  try {
    const value: unknown = await response.json();
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* The status is the only safe information available. */ }
  return {};
};

const errorMessage = (value: unknown): string => value instanceof Error ? value.message : String(value);

export function createSyncService(deps: SyncServiceDeps) {
  const fetcher = deps.fetcher ?? fetch;
  let client = deps.client;
  let workerUrl = deps.workerUrl ?? '';
  let status: SyncStatus = { state: client ? 'idle' : 'disabled', failedBookIds: [] };
  let account: AccountStatus = { authenticated: false };
  let queue: Promise<SyncSummary> = Promise.resolve(emptySummary(status));

  const publish = (next: SyncStatus): SyncStatus => {
    status = next;
    deps.emit?.(next);
    return next;
  };

  const manifestUrl = (bookId: string): string =>
    `${workerUrl.replace(/\/+$/, '')}/api/sync/books/${encodeURIComponent(bookId)}/manifest`;

  const putManifest = async (manifest: SyncManifest, baseVersion: number): Promise<ManifestReceipt> => {
    const session = await deps.sessionStore.read();
    if (!session) throw new Error('sync_not_authenticated');
    const request = new Request(manifestUrl(manifest.bookId), {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${session.token}`,
        cookie: `cairn_session=${session.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ...manifest, baseVersion }),
    });
    const response = await fetcher(request);
    if (response.status === 401) await deps.sessionStore.clear();
    const body = await jsonResponse(response);
    if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : `http_${response.status}`);
    if (typeof body.bookId !== 'string' || !Number.isSafeInteger(body.version) || !Number.isSafeInteger(body.resources)) {
      throw new Error('invalid_manifest_response');
    }
    return { bookId: body.bookId, version: body.version as number, resources: body.resources as number };
  };

  const configuredClient = (): CloudSyncClient => {
    if (!client) throw new Error('sync_not_configured');
    return client;
  };

  const installCloudBook = async (
    manifest: SyncManifest,
    onProgress?: (phase: SyncProgressPhase, completedResources: number, totalResources: number, path?: string) => void,
  ): Promise<void> => {
    const files: SyncBundleFile[] = [];
    const resources = manifest.resources.filter((resource) => isSyncablePath(resource.path));
    for (const [index, resource] of resources.entries()) {
      onProgress?.('downloading', index, resources.length, resource.path);
      const bytes = await configuredClient().downloadResource({ bookId: manifest.bookId, path: resource.path });
      if (bytes.byteLength !== resource.byteSize || hash(bytes) !== resource.contentHash) throw new Error('sync_hash_mismatch');
      files.push({ ...resource, bytes });
      onProgress?.('downloading', index + 1, resources.length);
    }
    onProgress?.('installing', resources.length, resources.length);
    const bundle: SyncBundle = { manifest, files };
    await installSyncBook(deps.library, bundle, deps.tempRoot ?? `${deps.library.root}/.cache/sync`);
  };

  const uploadLocalBook = async (
    local: SyncBundle,
    cloud: SyncManifest | undefined,
    onProgress?: (phase: SyncProgressPhase, completedResources: number, totalResources: number, path?: string) => void,
  ): Promise<void> => {
    const baseVersion = cloud?.version ?? 0;
    onProgress?.('manifest', 0, local.files.length);
    const receipt = await putManifest(local.manifest, baseVersion);
    for (const [index, file] of local.files.entries()) {
      const cloudFile = cloud?.resources.find((candidate) => candidate.path === file.path);
      onProgress?.('uploading', index, local.files.length, file.path);
      if (cloudFile && cloudFile.contentHash === file.contentHash && cloudFile.byteSize === file.byteSize) {
        onProgress?.('uploading', index + 1, local.files.length);
        continue;
      }
      const upload: ResourceUpload = {
        bookId: local.manifest.bookId, path: file.path, contentType: file.contentType,
        contentHash: file.contentHash, baseVersion: receipt.version, bytes: file.bytes,
      };
      await configuredClient().uploadResource(upload);
      onProgress?.('uploading', index + 1, local.files.length);
    }
  };

  const run = async (bookId: string, overwrite: boolean): Promise<SyncSummary> => {
    if (!client || !(await deps.sessionStore.read())) {
      const next = publish({ state: 'disabled', failedBookIds: [] });
      return emptySummary(next);
    }
    if (!isBookId(bookId)) throw new Error('invalid_book_id');
    publish({ state: 'syncing', failedBookIds: [] });
    const uploaded: string[] = [];
    const downloaded: string[] = [];
    const failed: string[] = [];
    let message: string | undefined;
    let progress: SyncProgress = {
      totalBooks: 1, completedBooks: 0, currentBookIndex: 1, currentBookId: bookId, currentBookTitle: '',
      phase: 'manifest', completedResources: 0, totalResources: 0,
    };
    const publishProgress = (patch: Partial<SyncProgress>): void => {
      progress = { ...progress, ...patch };
      publish({ state: 'syncing', failedBookIds: [...failed], progress });
    };
    try {
      publishProgress({ phase: 'manifest' });
      const cloud = await configuredClient().fetchManifest();
      const remoteBooks = cloud.books.map(syncManifest);
      const localEntries = await deps.library.list();
      const localEntry: LibraryEntry | undefined = localEntries.find((entry) => entry.id === bookId);
      const remote = remoteBooks.find((book) => book.bookId === bookId);
      if (!localEntry && !remote) throw new Error('book_not_found');
      const local = localEntry ? await exportSyncBook(deps.library, bookId) : undefined;
      if (remote && local && !sameManifest(local.manifest, remote) && !overwrite) {
        const conflict = { bookId, title: remote.title, cloudVersion: remote.version };
        const conflictProgress: SyncProgress = {
          ...progress, currentBookTitle: remote.title, phase: 'manifest',
          completedResources: 0, totalResources: Math.max(local.files.length, remote.resources.length),
        };
        const conflictStatus = publish({
          state: 'conflict', failedBookIds: [], message: 'sync_conflict', progress: conflictProgress,
        });
        return {
          uploadedBookIds: [], downloadedBookIds: [], failedBookIds: [], status: conflictStatus,
          requiresConfirmation: true, conflict,
        };
      }

      try {
        publishProgress({
          currentBookTitle: remote?.title ?? localEntry?.title ?? '',
          phase: remote && !overwrite ? 'downloading' : 'manifest',
          completedResources: 0,
          totalResources: local?.files.length ?? remote?.resources.length ?? 0,
          currentResourcePath: undefined,
        });
        if (remote) {
          if (!local || !sameManifest(local.manifest, remote)) {
            if (local && overwrite) {
              await uploadLocalBook(local, remote, (phase, completedResources, totalResources, currentResourcePath) => {
                publishProgress({ phase, completedResources, totalResources, ...(currentResourcePath ? { currentResourcePath } : { currentResourcePath: undefined }) });
              });
              uploaded.push(bookId);
            } else {
              await installCloudBook(remote, (phase, completedResources, totalResources, currentResourcePath) => {
                publishProgress({ phase, completedResources, totalResources, ...(currentResourcePath ? { currentResourcePath } : { currentResourcePath: undefined }) });
              });
              downloaded.push(bookId);
            }
          }
          const totalResources = overwrite && local ? local.files.length : remote.resources.length;
          await deps.library.patchEntry(bookId, { lastSyncedAt: new Date().toISOString() });
          progress = { ...progress, completedBooks: 1 };
          publishProgress({ phase: 'complete', completedResources: totalResources, totalResources, currentResourcePath: undefined });
        } else if (local) {
          publishProgress({ currentBookTitle: local.manifest.title, phase: 'manifest', totalResources: local.files.length });
          await uploadLocalBook(local, undefined, (phase, completedResources, totalResources, currentResourcePath) => {
            publishProgress({ phase, completedResources, totalResources, ...(currentResourcePath ? { currentResourcePath } : { currentResourcePath: undefined }) });
          });
          uploaded.push(bookId);
          await deps.library.patchEntry(bookId, { lastSyncedAt: new Date().toISOString() });
          progress = { ...progress, completedBooks: 1 };
          publishProgress({ phase: 'complete', completedResources: local.files.length, totalResources: local.files.length, currentResourcePath: undefined });
        }
      } catch (cause) {
        // A second desktop may have created the book between the manifest
        // read and the mutation. Re-read once and let the cloud win.
        let recovered = false;
        if (localEntry && !remote) {
          try {
            const afterConflict = (await configuredClient().fetchManifest()).books.find((book) => book.bookId === bookId);
            if (afterConflict) {
              const conflictRemote = syncManifest(afterConflict);
              await installCloudBook(conflictRemote, (phase, completedResources, totalResources, currentResourcePath) => {
                publishProgress({ currentBookTitle: conflictRemote.title, phase, completedResources, totalResources, ...(currentResourcePath ? { currentResourcePath } : { currentResourcePath: undefined }) });
              });
              downloaded.push(bookId);
              await deps.library.patchEntry(bookId, { lastSyncedAt: new Date().toISOString() });
              progress = { ...progress, completedBooks: 1 };
              publishProgress({ phase: 'complete', completedResources: conflictRemote.resources.length, totalResources: conflictRemote.resources.length, currentResourcePath: undefined });
              message = undefined;
              recovered = true;
            }
          } catch (retryCause) {
            message ??= errorMessage(retryCause);
          }
        }
        if (!recovered) {
          failed.push(bookId);
          message ??= errorMessage(cause);
          publishProgress({ phase: progress.phase });
        }
      }
    } catch (cause) {
      message = errorMessage(cause);
    }
    const next = publish({
      state: failed.length > 0 || message ? 'error' : 'success',
      lastSuccessAt: failed.length === 0 && !message ? new Date().toISOString() : status.lastSuccessAt,
      failedBookIds: [...new Set(failed)],
      progress: { ...progress, phase: failed.length === 0 && !message ? 'complete' : progress.phase },
      ...(message ? { message } : {}),
    });
    return { uploadedBookIds: uploaded, downloadedBookIds: downloaded, failedBookIds: next.failedBookIds, status: next };
  };

  const syncBook = (bookId: string, overwrite = false): Promise<SyncSummary> => {
    const next = queue.then(() => run(bookId, overwrite), () => run(bookId, overwrite));
    queue = next.catch(() => emptySummary(status));
    return next;
  };

  return {
    async configure(nextWorkerUrl: string): Promise<SyncStatus> {
      const normalized = normalizeWorkerUrl(nextWorkerUrl);
      if (!deps.createClient || !deps.writeSyncSettings) throw new Error('sync_configuration_unavailable');
      const changed = workerUrl !== normalized;
      workerUrl = normalized;
      client = deps.createClient(normalized);
      await deps.writeSyncSettings({ enabled: true, workerUrl: normalized });
      if (changed) {
        await deps.sessionStore.clear();
        account = { authenticated: false };
      }
      return publish({ state: 'idle', failedBookIds: [] });
    },
    async login(username: string, password: string): Promise<AccountStatus> {
      const session: SessionInfo = await configuredClient().login({ username, password });
      await deps.writeSyncSettings?.({ username });
      account = { authenticated: true, expiresAt: session.expiresAt };
      return account;
    },
    async logout(): Promise<void> {
      try {
        if (client) await client.logout();
      } catch {
        // Local logout must still succeed when the Worker is unreachable.
      } finally {
        await deps.sessionStore.clear();
        account = { authenticated: false };
        publish({ state: 'disabled', failedBookIds: [] });
      }
    },
    syncBook,
    status: (): SyncStatus => status,
    account: (): AccountStatus => account,
  };
}

export type SyncService = ReturnType<typeof createSyncService>;
