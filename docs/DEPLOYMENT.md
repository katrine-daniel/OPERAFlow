# Deployment

> The Docker images and compose stack have **not yet been built or run**: the development machine
> has no Docker. CI builds both images on every push. Treat the first deployment as a verification exercise.

## Docker Compose (single host)

Prerequisites: Docker Engine 24+ with Compose v2, a DNS name pointing at the host (for real TLS), ports 80/443 open.

1. Create the secrets file:
   ```bash
   cp deploy/.env.docker.example deploy/.env.docker
   ```
   Set `SITE_ADDRESS`, `POSTGRES_PASSWORD`, `ENCRYPTION_KEY`, `DEFAULT_TIMEZONE`.
2. Start the stack (migrations run automatically in the one-shot `migrate` service):
   ```bash
   docker compose --env-file deploy/.env.docker up -d --build
   ```
3. Create the first administrator:
   ```bash
   docker compose --env-file deploy/.env.docker run --rm -e SEED_ADMIN_EMAIL=you@company.com -e SEED_ADMIN_PASSWORD='<strong password>' migrate npx tsx prisma/seed.ts
   ```
   The seed is idempotent and creates reference data only (sources, templates, rules, test-scenario catalogue). It never creates bookings.
4. Browse to `https://SITE_ADDRESS`, sign in, create staff accounts under **Users & roles**.

## Upgrades

```bash
git pull && docker compose --env-file deploy/.env.docker up -d --build
```

The `migrate` service applies new migrations before `api` starts. Migrations are forward-only; take a backup first.

## Backups

- **Database:** schedule `pg_dump` (for example nightly) and copy the dumps off the host:
  ```bash
  docker compose exec -T postgres pg_dump -U operaflow -Fc operaflow > operaflow-$(date +%F).dump
  ```
  Restore with `pg_restore --clean -d operaflow`.
- **ENCRYPTION_KEY:** store it in your password manager / secret store **separately** from database backups. Without it, stored integration tokens are unreadable, and mailboxes must be reconnected.
- Test a restore at least quarterly.

## Running behind an existing reverse proxy / load balancer

Remove the `caddy` service and publish `web:3000` to your proxy. Then:
- keep TLS at the proxy and `COOKIE_SECURE=true`;
- set `WEB_ORIGINS` to the public `https://` origin;
- set `TRUST_PROXY` to the proxy hop count or address range so client IPs are logged correctly.

## Environment variables

See `.env.example`. The API validates configuration at start-up and refuses to start when it is invalid
(including `COOKIE_SECURE=false` under `NODE_ENV=production`).
