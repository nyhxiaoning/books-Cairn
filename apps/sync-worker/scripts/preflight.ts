import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const workerDir = join(import.meta.dir, '..');
const configPath = join(workerDir, 'wrangler.jsonc');

const fail = (message: string): never => {
  console.error(`Preflight failed: ${message}`);
  process.exit(1);
};

const runWrangler = (args: string[]): string => {
  const result = Bun.spawnSync(['bunx', 'wrangler', ...args], {
    cwd: workerDir,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) fail(`wrangler ${args[0] ?? 'command'} did not complete successfully.`);
  return new TextDecoder().decode(result.stdout);
};

const isPlaceholder = (value: string): boolean =>
  /^(?:REPLACE_WITH_|YOUR_|CHANGE_ME|<[^>]+>|替换为|你的)/i.test(value.trim());

const requiredConfigValue = (config: string, key: string): string => {
  const match = config.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
  const value = match?.[1]?.trim() ?? '';
  if (!value) fail(`${key} in wrangler.jsonc is missing.`);
  if (isPlaceholder(value)) fail(`${key} in wrangler.jsonc is still a placeholder.`);
  return value;
};

const main = async (): Promise<void> => {
  const config = await readFile(configPath, 'utf8');
  const databaseId = requiredConfigValue(config, 'database_id');
  const bucketName = requiredConfigValue(config, 'bucket_name');
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(databaseId)) {
    fail('database_id does not look like a Cloudflare D1 database ID.');
  }
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/i.test(bucketName)) {
    fail('bucket_name is not a valid R2 bucket name.');
  }

  runWrangler(['whoami']);
  const secretOutput = runWrangler(['secret', 'list', '--format', 'json']);
  let secrets: Array<{ name?: unknown }> = [];
  try {
    const parsed: unknown = JSON.parse(secretOutput);
    secrets = Array.isArray(parsed) ? parsed.filter((item): item is { name?: unknown } => typeof item === 'object' && item !== null) : [];
  } catch {
    fail('could not read the remote secret list.');
  }
  const names = new Set(secrets.flatMap((secret) => typeof secret.name === 'string' ? [secret.name] : []));
  for (const required of ['ADMIN_INIT_SECRET']) {
    if (!names.has(required)) fail(`remote Worker Secret ${required} is missing.`);
  }

  console.log('Preflight passed: Wrangler login, D1/R2 configuration, and required remote secrets are ready.');
};

await main();
