# Cairn sync Worker

The Worker stores one administrator account in D1 and keeps session tokens in
HttpOnly, Secure, SameSite=Strict cookies. It never returns passwords or stores
session tokens in plaintext.

## Setup

1. Apply the migration locally or remotely:

   ```sh
   bunx wrangler d1 migrations apply cairn-sync --local
   bunx wrangler d1 migrations apply cairn-sync --remote
   ```

2. Configure `DB`, `BOOKS`, `SESSION_SECRET`, and `ADMIN_INIT_SECRET` as Worker
   bindings/secrets. Keep both secrets out of source control.

3. Initialize the single administrator once after deployment. The secret is
   sent in a header, and the password is sent only in the HTTPS request body:

   ```sh
   curl -X POST "$CAIRN_SYNC_URL/api/auth/init" \
     -H 'content-type: application/json' \
     -H "x-admin-init-secret: $CAIRN_ADMIN_INIT_SECRET" \
     --data '{"username":"admin","password":"REPLACE_WITH_A_LONG_PASSWORD"}'
   ```

Initialization refuses to overwrite an existing administrator. Use a secret
manager or an interactive shell that does not echo the password when providing
the placeholder values above.
