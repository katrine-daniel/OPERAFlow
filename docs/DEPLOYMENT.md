# Deployment guide

> **Not yet verified on Docker.** The development machine has no Docker, so the images and the compose stack have
> not been built or run. CI builds both images and validates the compose file on every push. Treat the first
> deployment as a verification exercise, using the checklist at the end of this page.

## Architecture in production

| Service | Image | Role |
|---|---|---|
| `caddy` | caddy:2.10 | TLS termination (automatic certificates), HSTS, the only published ports (80/443) |
| `web` | apps/web/Dockerfile | Next.js UI; proxies `/api/*` to `api` |
| `api` | apps/api/Dockerfile (runtime) | REST API, inline test runs when there's no queue |
| `worker` | same image, `node apps/api/dist/worker.js` | BullMQ jobs: report schedules, delivery retries, follow-up checks, scheduled tests, reconciliation, retention |
| `migrate` | apps/api/Dockerfile (migrate) | One-shot `prisma migrate deploy` before `api` and `worker` start |
| `postgres` | postgres:17.6 (UTF-8) | Data |
| `redis` | redis:7.4 (AOF) | Queues and schedules |

Volumes: `pgdata`, `redisdata`, `storage` (documents, report files, test artifacts) and `caddydata` (certificates).

## First deployment

Prerequisites:
- A Linux host with Docker Engine 24+ and Compose v2; 2 vCPU / 4 GB RAM minimum (Chromium runs inside the worker).
- A DNS name pointing at the host, with ports 80/443 open.

1. Create the secrets file:
   ```bash
   cp deploy/.env.docker.example deploy/.env.docker
   ```
   Fill in `SITE_ADDRESS`, `POSTGRES_PASSWORD` and `ENCRYPTION_KEY` (both from `openssl rand -base64 32`), plus `DEFAULT_TIMEZONE`.
2. Start the stack:
   ```bash
   docker compose --env-file deploy/.env.docker up -d --build
   ```
3. Create the first administrator and the reference data:
   ```bash
   docker compose --env-file deploy/.env.docker run --rm -e SEED_ADMIN_EMAIL=you@company.com -e SEED_ADMIN_PASSWORD='<strong password>' migrate npx tsx prisma/seed.ts
   ```
   The seed is idempotent and creates no bookings.
4. Open `https://SITE_ADDRESS`, sign in, and change the password under **My account**.
5. Configure the rest from the UI:
   - **Users & roles**
   - **Suppliers** (with approved contacts)
   - **Booking sources** (issue the webhook secret for the booking website and send it with `docs/WEBHOOK.md`)
   - **Integrations** (connect the mailbox, add a Teams/Slack channel)
   - **Reports** (approve recipients, create and preview schedules)
   - **Booking-site tests** (environments, scenario steps)
   - **Settings** (retention periods)

## Verification checklist (first deployment)

- [ ] `docker compose ps`: all services healthy, and `migrate` exited 0.
- [ ] `https://SITE_ADDRESS/api/health` returns `{"status":"ok","database":"ok"}`.
- [ ] `/api/health/ready` shows `redis: ok`.
- [ ] Integrations page: background worker **Running** (heartbeat within the last minute).
- [ ] Sign in, sign out, then confirm a wrong password shows the generic error.
- [ ] Report preview generates; **Run & send now** to your own approved address delivers XLSX and PDF.
- [ ] Mailbox connect and **Test** succeed; track one internal test thread with a 1-hour test rule and check that a draft appears.
- [ ] A read-only test scenario passes against the sandbox; the trace downloads and opens at trace.playwright.dev.
- [ ] `./deploy/backup.sh /tmp/of-backup` produces both files, and a restore into a scratch database works.

## Upgrades

```bash
git pull
./deploy/backup.sh /srv/backups/operaflow
docker compose --env-file deploy/.env.docker up -d --build
```

Migrations are forward-only and applied by `migrate` before `api` and `worker` restart. Read `docs/STATUS.md` for upgrade notes.

## Backups and restore

`deploy/backup.sh <dir>` writes a `pg_dump` (custom format) and a tarball of the `storage` volume, and prunes copies older than `KEEP_DAYS` (default 30). Restore commands are at the bottom of the script.

- Schedule it nightly (cron) and copy the directory off the host.
- `ENCRYPTION_KEY` is deliberately **not** in the backup. Keep it in your secret manager. Without it, stored OAuth tokens and test credentials can't be decrypted: mailboxes would need reconnecting and environment credentials re-entering.

## Monitoring

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Liveness and database (container health check) |
| `GET /api/health/ready` | Database + Redis (for a load balancer or uptime monitor) |
| `GET /api/metrics` | Prometheus text format (needs `METRICS_TOKEN`, sent as a bearer token): HTTP request counts and latency histogram, failed jobs (24h), open reconciliation issues, follow-ups needing action, failed report deliveries, failed test runs (24h), worker heartbeat age |

Suggested alerts:
- `operaflow_worker_heartbeat_age_seconds > 180`
- `operaflow_jobs_failed_24h > 0`
- `operaflow_report_deliveries_failed > 0`
- the 5xx rate

**Logs** are one JSON object per line (`time`, `level`, `context`, `requestId`, `method`, `path`, `status`, `durationMs`, `userId`).
- Request bodies and query strings are never logged, and secret-looking keys are redacted.
- Every response carries `X-Request-Id`, and error responses include `requestId`, so a user's error can be matched to its log line.
- Ship logs with your platform's Docker log driver.

## Behind an existing reverse proxy

Remove `caddy` and publish `web:3000` to your proxy. Then:
- Keep TLS at the proxy and `COOKIE_SECURE=true`.
- Set `APP_BASE_URL` and `WEB_ORIGINS` to the public `https://` origin.
- Set `TRUST_PROXY` to the hop count or proxy range.
- Send `/api/webhooks/*` to the web service unchanged; the raw body is needed for signature checks.

## Configuration reference

Every variable is documented in `.env.example`. Invalid configuration stops the API at start-up, for example:
- a missing `ENCRYPTION_KEY`;
- `COOKIE_SECURE=false` or `SMTP_ALLOW_INSECURE=true` in production;
- a `METRICS_TOKEN` shorter than 16 characters.
