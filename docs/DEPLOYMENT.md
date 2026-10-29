# Cloud deployment (Railway) — the pilot

PCN-019, roadmap §4 item 2. One image, same code and migrations as the Windows
installer, run with `MEHVAR_DEPLOYMENT=cloud`. **Demo data only** until the
go-live gate at the bottom is signed off.

## What runs

| Railway service | Source                      | Role                                                         |
| --------------- | --------------------------- | ------------------------------------------------------------ |
| `Postgres`      | Railway template            | One database, many tenants                                   |
| `web`           | `Dockerfile`, branch `main` | The Next.js server. Pre-deploy: migrate → grants → catalogue |
| `backup`        | `Dockerfile.backup`         | Cron `0 21 * * *` UTC (02:00 PKT): `pg_dump` → bucket        |
| `backups`       | Railway bucket              | Nightly dumps, 30-day retention                              |

## `web` settings

- **Pre-deploy command** (runs between build and deploy; a failure stops the deploy):

  ```
  sh /srv/predeploy.sh
  ```

  migrate → grants → catalogue import. A script, not `a && b && c`: Railway does
  not run the command through a shell, so `&&` reached `node` as an argument and
  only the migration ran.

- **Healthcheck path:** `/api/health` (200 `ok`, 503 `database_down`; unauthenticated, says nothing else).
- **Start command:** the image's `CMD` (`node app/server.js`); binds `0.0.0.0:$PORT`.

## `web` variables

| Variable                             | Value                                                                                                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MEHVAR_DEPLOYMENT`                  | `cloud`                                                                                                                                                   |
| `APP_ENV`                            | `production` (staging environment: `staging`)                                                                                                             |
| `DATABASE_ADMIN_URL`                 | `${{Postgres.DATABASE_URL}}` — owner; migrations, grants, backup only                                                                                     |
| `APP_DB_ROLE`                        | `mehvar_app`                                                                                                                                              |
| `APP_DB_PASSWORD`                    | a long random secret (`openssl rand -base64 32`)                                                                                                          |
| `DATABASE_URL`                       | `postgresql://mehvar_app:${{APP_DB_PASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}` — the **non-owning** app role (PCN-001) |
| `SESSION_SECRET`                     | `openssl rand -base64 48`                                                                                                                                 |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | `openssl rand -base64 32` — generate **once**, never rotate casually (it is baked into the build and read at run time)                                    |
| `TENANT_TIME_ZONE`                   | `Asia/Karachi`                                                                                                                                            |

`db:grants` creates `mehvar_app` and sets its password on every run, so rotating
`APP_DB_PASSWORD` is "change it, redeploy".

## `backup` variables

`DATABASE_ADMIN_URL=${{Postgres.DATABASE_URL}}` (the owner — a dump through the
app role would silently omit what the event tables restrict), plus the bucket's
`BUCKET`, `ENDPOINT`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `REGION` (Railway
bucket → Credentials; reference them as `${{<bucket>.NAME}}`). `Dockerfile.backup`
uses `postgres:18-alpine`, matching the Railway PostgreSQL 18 server, so the
image includes a compatible `pg_dump`. Custom domain on `web`:
`pharmacy.getmehvar.com`.

## Creating a pharmacy

Every `node app/bin/...` command in this document runs **inside the deployed
container**: open it with `railway ssh --service web`. Not `railway run`, which
executes on your own machine (with Railway's variables injected) where
`app/bin/` does not exist and fails with `MODULE_NOT_FOUND`.

Once per tenant:

```bash
MEHVAR_SHOP_NAME="Al-Shifa Medical Store" MEHVAR_OWNER_PIN=4821 \
  node app/bin/ops/provision-tenant.js
```

Optional: `MEHVAR_SHOP_SLUG`, `MEHVAR_OWNER_NAME`, `MEHVAR_DEVICE_NAME`,
`MEHVAR_SHOP_ADDRESS`, `MEHVAR_SHOP_PHONE`, `MEHVAR_ENTITLEMENT_PLAN` (default
`pilot`), `MEHVAR_ENTITLEMENT_ENDS` (`2027-03-31`; default none). It prints the
login name, pairing key and owner password **once** — both are stored only as
hashes.

**The demo pharmacy** (138 products, stocked batches, a sale, an udhaar
customer) is the seed script bundled in the image. From the `web` container (`railway ssh --service web`):

```bash
node app/bin/db/seed.js
```

Safe to run again: it only tops up missing catalogue products. It labels itself
"DEMO — not a real pharmacy" on every receipt and gets a `demo` entitlement. Its
login is the one `seed.ts` prints (tenant `demo`, a published pairing key and
PINs), so treat it as public: demo data only, wiped before go-live.

**Entitlement.** In cloud mode "may this tenant use the product" is the tenant's
newest `tenant_entitlements` row (append-only). No row, or an `ends_at` in the
past, is `restricted` (it cannot start new business; export, print and settling
udhaar still work). Extending is a new row. The PCN-006 licence file is not read
in cloud mode and is untouched in local mode.

## Verifying a deploy

1. `https://pharmacy.getmehvar.com/api/health` → `{"status":"ok"}`; `/` redirects to `/login`.
2. Log in, W1 sale by keyboard; cut the network in the browser, sell again (prints, badge says unsynced), reconnect (drains).
3. `node app/bin/db/verify.js` from the `web` container (`railway ssh`): clean (ADR-8).

## Restore drill (go-live gate c)

Download the newest dump from the bucket, restore it into a **scratch** database
(never the live one), and run the verifier:

```bash
aws --endpoint-url "$ENDPOINT" s3 cp "s3://$BUCKET/backups/<newest>.dump" ./restore.dump
MEHVAR_BACKUP_DIR=. DATABASE_ADMIN_URL=postgresql://mehvar:mehvar@localhost:5432/mehvar_pharmacy \
  npm run ops:restore-drill
```

(`ops:restore-drill` takes the latest dump in `MEHVAR_BACKUP_DIR`, restores into
`mehvar_restore_drill`, re-applies grants, verifies, and drops it.) Write the
date and result in PCN-019.

## Go-live gate — no real pharmacy data online until all three are written down

- [ ] (a) **Authentication over the internet:** device pairing, PIN lockout, secure session cookie (`secure` is set when `NODE_ENV=production`), HTTPS only (HSTS header is sent).
- [ ] (b) **Tenant isolation:** row-level security PCN done, its cross-tenant test seen to fail with the policy dropped (roadmap §4 item 3).
- [ ] (c) **Backups:** a nightly dump exists in the bucket and one restore drill into a scratch database has succeeded.

Then wipe the demo tenant and provision the pilot.

## Known limits, stated honestly

- Not run on Docker in the session that wrote it (no daemon). The same steps were
  run from the built payload (`npm run build && npm run package:cloud`, then
  migrate → grants → catalogue → provision → verify → boot) against Postgres 16.
- `Dockerfile.backup` is untested end to end; first scheduled run is its test.
  Check the `backup` service logs the morning after.
- No row-level security yet: isolation today is `scoped.ts` alone. That is why
  this is demo-only.
