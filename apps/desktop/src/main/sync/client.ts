import type { SyncManifest } from '@cairn/core/sync/manifest';
import type {
  CloudManifest, LoginCredentials, ResourceDownload, ResourceReceipt, ResourceUpload, SessionInfo,
} from './types';
import type { SessionStore } from './session-store';

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_RESOURCE_BYTES = 64 * 1024 * 1024;

export class CloudSyncError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'CloudSyncError';
    this.code = code;
    this.status = status;
  }
}

export const normalizeWorkerUrl = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) throw new CloudSyncError('invalid_worker_url', 'Worker URL is required.', 0);
  let url: URL;
  try { url = new URL(trimmed); } catch { throw new CloudSyncError('invalid_worker_url', 'Worker URL is invalid.', 0); }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    throw new CloudSyncError('invalid_worker_url', 'Worker URL must use HTTP(S).', 0);
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const boundedBytes = async (response: Response, limit: number): Promise<Uint8Array> => {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
    throw new CloudSyncError('response_too_large', 'Cloud response is too large.', response.status);
  }
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > limit) throw new CloudSyncError('response_too_large', 'Cloud response is too large.', response.status);
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
};

const parseJson = async <T>(response: Response): Promise<T> => {
  const bytes = await boundedBytes(response, MAX_JSON_BYTES);
  try { return JSON.parse(new TextDecoder().decode(bytes)) as T; }
  catch { throw new CloudSyncError('invalid_response', 'Cloud response is invalid.', response.status); }
};

const errorFrom = async (response: Response): Promise<CloudSyncError> => {
  let code = `http_${response.status}`;
  let message = 'Cloud sync request failed.';
  try {
    const body = await parseJson<unknown>(response);
    if (isRecord(body)) {
      if (typeof body.code === 'string') code = body.code;
      if (typeof body.message === 'string') message = body.message;
    }
  } catch { /* The status is the only safe information available. */ }
  return new CloudSyncError(code, message, response.status);
};

const sessionTokenFromCookie = (value: string | null): string | undefined => {
  if (!value) return undefined;
  const match = /(?:^|;)\s*cairn_session=([^;]+)/.exec(value);
  return match?.[1];
};

const validSession = (value: unknown): value is SessionInfo =>
  isRecord(value) && typeof value.token === 'string' && value.token.length > 0 &&
  typeof value.expiresAt === 'string' && !Number.isNaN(Date.parse(value.expiresAt));

export interface CloudSyncClient {
  login(credentials: LoginCredentials): Promise<SessionInfo>;
  fetchManifest(): Promise<CloudManifest>;
  uploadResource(input: ResourceUpload): Promise<ResourceReceipt>;
  downloadResource(input: ResourceDownload): Promise<Uint8Array>;
}

export function createCloudSyncClient(workerUrl: string, sessionStore: SessionStore, fetcher: typeof fetch = fetch): CloudSyncClient {
  const baseUrl = normalizeWorkerUrl(workerUrl);

  const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const session = await sessionStore.read();
    const headers = new Headers(init.headers);
    if (session) {
      headers.set('authorization', `Bearer ${session.token}`);
      headers.set('cookie', `cairn_session=${session.token}`);
    }
    const response = await fetcher(`${baseUrl}${path}`, { ...init, headers });
    if (response.status === 401) await sessionStore.clear();
    if (!response.ok) throw await errorFrom(response);
    return response;
  };

  return {
    async login(credentials): Promise<SessionInfo> {
      const response = await fetcher(`${baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials),
      });
      if (!response.ok) throw await errorFrom(response);
      const body = await parseJson<unknown>(response);
      const value = isRecord(body) ? { ...body, token: body.token ?? sessionTokenFromCookie(response.headers.get('set-cookie')) } : body;
      if (!validSession(value)) throw new CloudSyncError('invalid_response', 'Login response is invalid.', response.status);
      await sessionStore.write(value);
      return value;
    },

    async fetchManifest(): Promise<CloudManifest> {
      const body = await parseJson<unknown>(await request('/api/sync/manifest'));
      if (!isRecord(body) || !Array.isArray(body.books)) throw new CloudSyncError('invalid_response', 'Manifest response is invalid.', 200);
      return { books: body.books as readonly SyncManifest[] };
    },

    async uploadResource(input): Promise<ResourceReceipt> {
      if (input.bytes.byteLength > MAX_RESOURCE_BYTES) throw new CloudSyncError('resource_too_large', 'Resource is too large.', 0);
      const requestBody = new ArrayBuffer(input.bytes.byteLength);
      new Uint8Array(requestBody).set(input.bytes);
      const response = await request(`/api/sync/books/${encodeURIComponent(input.bookId)}/resource/${input.path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'PUT', body: requestBody, headers: {
          'content-type': input.contentType, 'content-length': String(input.bytes.byteLength),
          'x-content-sha256': input.contentHash, 'x-base-version': String(input.baseVersion),
        },
      });
      const body = await parseJson<unknown>(response);
      if (!isRecord(body) || typeof body.bookId !== 'string' || typeof body.path !== 'string' ||
        !Number.isSafeInteger(body.version) || typeof body.contentHash !== 'string' || !Number.isSafeInteger(body.byteSize)) {
        throw new CloudSyncError('invalid_response', 'Resource response is invalid.', response.status);
      }
      return body as unknown as ResourceReceipt;
    },

    async downloadResource(input): Promise<Uint8Array> {
      return boundedBytes(await request(`/api/sync/books/${encodeURIComponent(input.bookId)}/resource/${input.path.split('/').map(encodeURIComponent).join('/')}`), MAX_RESOURCE_BYTES);
    },
  };
}
