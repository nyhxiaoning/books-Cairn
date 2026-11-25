import {
  isSyncablePath,
  resourceKey,
  syncContentType,
  type SyncFile,
  type SyncManifest,
} from '../../../../packages/core/src/sync/manifest';

export { isSyncablePath, resourceKey, syncContentType };
export type { SyncFile, SyncManifest };

const HASH = /^[a-f0-9]{64}$/;

export const sha256 = async (bytes: ArrayBuffer): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const validResourceMetadata = (file: SyncFile): boolean =>
  isSyncablePath(file.path) &&
  syncContentType(file.path) === file.contentType &&
  Number.isSafeInteger(file.byteSize) && file.byteSize >= 0 &&
  HASH.test(file.contentHash);
