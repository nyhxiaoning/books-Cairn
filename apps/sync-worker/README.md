# Cairn sync Worker

The Worker stores one administrator account in D1 and keeps session tokens in
HttpOnly, Secure, SameSite=Strict cookies. It never returns passwords or stores
session tokens in plaintext. D1 stores account, manifest, resource metadata,
and reading progress; R2 stores the allowed book resources. MP3 audio is excluded
from both upload and download.

The sync boundary intentionally excludes `chapters.json`, `.cache`, traces,
chat transcripts, source snapshots, and other generation-only files. A synced
device can play the generated book, but it cannot use the original chapter
text for local anchored questions.

## Prerequisites

- Cloudflare account with Wrangler access
- Bun and a successful `bun install` at the repository root
- A D1 database and an R2 bucket referenced by `wrangler.jsonc`

Create the remote resources once:

```sh
bunx wrangler login
bunx wrangler d1 create cairn-sync
bunx wrangler r2 bucket create cairn-book-resources
```

Copy the D1 ID into `wrangler.jsonc`. The R2 bucket name must match the
`bucket_name` there. Never put a secret or an API token in `wrangler.jsonc`.

## Migrations

Run both commands when setting up a machine or after adding a migration. The
local database is only for `wrangler dev`; the remote command changes the
production D1 database.

```sh
bunx wrangler d1 migrations apply cairn-sync --local
bunx wrangler d1 migrations apply cairn-sync --remote
```

## Secrets and administrator initialization

Create the `ADMIN_INIT_SECRET` Worker Secret. It is used only once to authorize
administrator initialization. The current session implementation uses random
session tokens and stores only their SHA-256 digests, so `SESSION_SECRET` is not
a required deployment secret. Wrangler stores Secret values remotely and does
not print them back.

```sh
openssl rand -hex 32 | bunx wrangler secret put ADMIN_INIT_SECRET \
  --config apps/sync-worker/wrangler.jsonc
```

Initialize the single administrator once after deployment. Use a password
manager or an interactive shell that does not echo the password. Do not put a
real password in shell history, source files, or the request URL:

```sh
read -rsp 'Cairn admin init secret: ' CAIRN_ADMIN_INIT_SECRET; echo
read -rp 'Cairn admin username: ' CAIRN_ADMIN_USERNAME
read -rsp 'Cairn admin password: ' CAIRN_ADMIN_PASSWORD; echo
curl -fsS -X POST "$CAIRN_SYNC_URL/api/auth/init" \
  -H 'content-type: application/json' \
  -H "x-admin-init-secret: $CAIRN_ADMIN_INIT_SECRET" \
  --data "$(CAIRN_INIT_USERNAME="$CAIRN_ADMIN_USERNAME" CAIRN_INIT_PASSWORD="$CAIRN_ADMIN_PASSWORD" bun -e 'console.log(JSON.stringify({ username: process.env.CAIRN_INIT_USERNAME, password: process.env.CAIRN_INIT_PASSWORD }))')"
unset CAIRN_ADMIN_INIT_SECRET CAIRN_ADMIN_USERNAME CAIRN_ADMIN_PASSWORD
```

Initialization refuses to overwrite an existing administrator. If the command
returns `admin_exists`, do not retry with a different password unless the
account recovery procedure has been designed separately.

## Deployment and verification

From the repository root, run the preflight before deploying. It rejects
placeholder IDs, checks Wrangler authentication, and confirms the required
remote secret exists. It never prints secret values.

```sh
bun run sync-worker:preflight
bunx wrangler d1 migrations apply cairn-sync --remote \
  --config apps/sync-worker/wrangler.jsonc
bunx wrangler deploy --config apps/sync-worker/wrangler.jsonc
```

Set `CAIRN_SYNC_URL` to the Worker URL printed by Wrangler. The verification
script checks `/api/health`, logs in, and reads the manifest without printing
the password or session cookie:

```sh
export CAIRN_SYNC_URL='https://cairn-sync-worker.<account>.workers.dev'
export CAIRN_SYNC_USERNAME='admin'
read -rsp 'Cairn admin password: ' CAIRN_SYNC_PASSWORD; echo
bun run sync-worker:verify
unset CAIRN_SYNC_PASSWORD
```

For local development, use `bunx wrangler dev` after applying the local
migration. The verification script permits `http://localhost` and
`http://127.0.0.1`; deployed URLs must use HTTPS.

Run the manifest contract check without contacting Cloudflare:

```sh
bun run sync-worker:verify --dry-run
```

## Operational rules

- The desktop app talks to this Worker URL, never directly to D1 or R2. Sync is
  manually started for one shelf book at a time; there is no automatic whole-shelf sync.
- Login automatically pulls the latest cloud manifest; book generation and
  completed decks do not enqueue background sync; use the shelf action to sync one book.
- Cloud versions win on conflict. A failed upload or download leaves the local
  book playable and is shown as a retryable sync failure.
- Only generated playback resources are synchronized. `chapters.json` remains
  local, and `.cache` is never uploaded.
- Keep Cloudflare API tokens and Worker secrets outside the repository.
