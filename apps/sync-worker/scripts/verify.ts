export {};

const requiredEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  if (/^(?:REPLACE_WITH_|YOUR_|CHANGE_ME|<[^>]+>|替换为|你的)/i.test(value)) {
    throw new Error(`${name} is still a placeholder.`);
  }
  return value;
};

const request = async (url: string, init?: RequestInit): Promise<Response> => {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new Error(`request failed: ${new URL(url).origin}`);
  }
};

export const manifestBookCount = (body: unknown): number => {
  if (typeof body !== 'object' || body === null || !Array.isArray((body as { books?: unknown }).books)) {
    throw new Error('manifest response did not contain a books array.');
  }
  return (body as { books: readonly unknown[] }).books.length;
};

const dryRun = (): void => {
  if (manifestBookCount({ books: [] }) !== 0) throw new Error('empty manifest dry-run failed.');
  try {
    manifestBookCount([]);
    throw new Error('array-shaped manifest was accepted.');
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'manifest response did not contain a books array.') throw error;
  }
  console.log('Dry-run passed: manifest envelope contains books[].');
};

const main = async (): Promise<void> => {
  const rawUrl = requiredEnv('CAIRN_SYNC_URL');
  const username = requiredEnv('CAIRN_SYNC_USERNAME');
  const password = requiredEnv('CAIRN_SYNC_PASSWORD');
  const baseUrl = new URL(rawUrl);
  if (baseUrl.protocol !== 'https:' && baseUrl.hostname !== 'localhost' && baseUrl.hostname !== '127.0.0.1') {
    throw new Error('CAIRN_SYNC_URL must use HTTPS except for local verification.');
  }
  baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, '');

  const health = await request(new URL('/api/health', baseUrl).toString());
  if (!health.ok) throw new Error(`/api/health returned HTTP ${health.status}.`);
  const healthBody = await health.json() as { ok?: unknown; database?: unknown; storage?: unknown };
  if (healthBody.ok !== true || healthBody.database !== 'd1' || healthBody.storage !== 'r2') {
    throw new Error('/api/health did not report D1 and R2 as ready.');
  }

  const login = await request(new URL('/api/auth/login', baseUrl).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!login.ok) throw new Error(`/api/auth/login returned HTTP ${login.status}.`);
  const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
  if (!cookie) throw new Error('login did not return a session cookie.');

  const manifest = await request(new URL('/api/sync/manifest', baseUrl).toString(), { headers: { cookie } });
  if (!manifest.ok) throw new Error(`/api/sync/manifest returned HTTP ${manifest.status}.`);
  const body = await manifest.json() as unknown;
  const bookCount = manifestBookCount(body);

  console.log(`Verification passed: health, administrator login, and manifest read (${bookCount} books).`);
};

try {
  if (process.argv.includes('--dry-run')) dryRun();
  else await main();
} catch (error) {
  console.error(`Verification failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exit(1);
}
