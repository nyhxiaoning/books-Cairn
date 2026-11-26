# Cairn Cloudflare sync deployment

This document is the deployment contract for the Cairn sync Worker. The
desktop app uses the Worker as its only cloud entry point:

```text
Cairn desktop -> Cloudflare Worker -> D1 (accounts and metadata)
                                      R2 (generated book resources)
```

The design is for one administrator account. There is no public registration.
The Worker stores a PBKDF2 password hash and only a digest of each session
token. The desktop app stores the short-lived session token in its local sync
settings file with restrictive permissions.

## What is synchronized

The R2 allowlist contains the generated playback bundle: `path.json`, deck
JSON, audio, covers, and sync metadata. D1 stores the resource manifest,
versions, deletion tombstones, and reading progress.

The following never leave the desktop through this feature:

- `chapters.json` (the original book text)
- `.cache/`
- model traces, chat transcripts, and source snapshots

This means another device can read and play a synchronized book, but it cannot
perform features that require the original chapter text until a separate,
explicit product decision changes this boundary.

## One-time Cloudflare setup

From the repository root:

```sh
bun install
bunx wrangler login
bunx wrangler d1 create cairn-sync
bunx wrangler r2 bucket create cairn-book-resources
```

Put the returned D1 UUID in `apps/sync-worker/wrangler.jsonc` as
`database_id`. Keep the configured R2 name and the `database_name` unchanged
unless you also update the commands below. Do not put API tokens or secret
values in the config file.

## Local and remote migrations

Apply migrations independently to local and remote databases:

```sh
bunx wrangler d1 migrations apply cairn-sync --local
bunx wrangler d1 migrations apply cairn-sync --remote
```

The remote command is a production change. Run it after reviewing a new SQL
migration and before deploying code that depends on it.

## Worker secrets and admin account

Create the required initialization secret without echoing its value. The
current session implementation uses random session tokens and stores only
their SHA-256 digests, so `SESSION_SECRET` is not a required deployment secret:

```sh
openssl rand -hex 32 | bunx wrangler secret put ADMIN_INIT_SECRET \
  --config apps/sync-worker/wrangler.jsonc
```

After deploying, initialize the administrator through
`POST /api/auth/init` with the `x-admin-init-secret` header. Use an interactive
secret manager workflow for the init secret and password. The endpoint is
one-shot and refuses to replace an existing administrator.

## Preflight, deploy, and verify

The preflight checks the D1 ID and R2 name, Wrangler authentication, and the
presence of `ADMIN_INIT_SECRET` in the remote Worker. It
fails on placeholders and never prints secret values:

```sh
bun run sync-worker:preflight
bunx wrangler d1 migrations apply cairn-sync --remote \
  --config apps/sync-worker/wrangler.jsonc
bunx wrangler deploy --config apps/sync-worker/wrangler.jsonc
```

Use the URL Wrangler reports as the desktop Worker URL. The verification script
requires these environment variables:

```text
CAIRN_SYNC_URL       Worker URL, HTTPS in production
CAIRN_SYNC_USERNAME  initialized administrator username
CAIRN_SYNC_PASSWORD  initialized administrator password
```

Then run:

```sh
bun run sync-worker:verify
```

Run the local manifest contract check without contacting Cloudflare:

```sh
bun run sync-worker:verify --dry-run
```

Verification checks D1/R2 health, administrator login, and authenticated
manifest access. It reports only statuses and the number of books; it never
prints the password, cookie, or token.

## Runtime behavior

After a successful desktop login, Cairn pulls the cloud manifest. Books that
exist only locally are uploaded; books that exist only in the cloud are
downloaded. When both sides have a different version, the cloud version wins.
The local book remains usable if a network operation fails, and the UI exposes
the failure for retry.

## Troubleshooting

- Placeholder ID failure: replace `database_id` in `wrangler.jsonc` with the
  UUID returned by `wrangler d1 create`.
- Missing secret failure: run `bunx wrangler secret list --format json` and
  create the missing secret with `wrangler secret put`; inspect names only.
- Health is unavailable: confirm the Worker URL, D1 migration, and R2 binding.
- Login returns `admin_exists`: initialization already happened; do not repeat
  it as a password reset mechanism.
- A book is missing from the cloud: check the desktop sync status and retry;
  generation-side cache files and `chapters.json` are deliberately excluded.
