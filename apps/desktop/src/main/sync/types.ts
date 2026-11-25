import type { SyncManifest, SyncFile } from '@cairn/core/sync/manifest';

export type CloudManifest = Readonly<{ books: readonly SyncManifest[] }>;

export interface SessionInfo {
  readonly token: string;
  readonly expiresAt: string;
}

export interface StoredSession extends SessionInfo {}

export interface LoginCredentials {
  readonly username: string;
  readonly password: string;
}

export interface ResourceUpload {
  readonly bookId: string;
  readonly path: string;
  readonly contentType: string;
  readonly contentHash: string;
  readonly baseVersion: number;
  readonly bytes: Uint8Array;
}

export interface ResourceDownload {
  readonly bookId: string;
  readonly path: string;
}

export interface ResourceReceipt {
  readonly bookId: string;
  readonly path: string;
  readonly version: number;
  readonly contentHash: string;
  readonly byteSize: number;
}

export type { SyncFile, SyncManifest };
