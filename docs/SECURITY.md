# Security checklist

Legend:
- ✅ implemented and covered by automated tests
- ☑️ implemented, verified manually or by configuration
- ⚠️ accepted risk or requires your action

## Identity, sessions, access
- ✅ Argon2id password hashing (OWASP parameters). Policy: 12+ characters with 3 character classes.
- ✅ Opaque 256-bit session tokens; only their SHA-256 hashes are stored.
- ✅ Cookies are `httpOnly` and `SameSite=Lax`; `Secure` is enforced in production (start-up refuses otherwise).
- ✅ 12-hour absolute and 60-minute idle session expiry.
- ✅ Sessions are revoked on logout, password change (other sessions), role change, deactivation and admin password reset.
- ✅ Lockout after 5 failures for 15 minutes, with generic errors and equalised timing.
- ✅ Login rate limit of 10/min/IP; global limit of 300/min/IP.
- ✅ The login form posts, so credentials can never appear in a URL, even before JavaScript loads.
- ✅ Every route needs a session unless explicitly public (health, metrics with token, login, signed webhooks, OAuth callback).
- ✅ Server-side permission guard on every route, with one permission matrix (4 roles). QA never sees guest data.
- ✅ The last administrator can't be removed; admins can't demote themselves.
- ⚠️ No MFA or SSO yet. Recommended next step: Microsoft Entra ID / Google SSO, or TOTP for administrators.

## Request integrity
- ✅ CSRF protection: state-changing requests need an allowed `Origin`/`Referer`.
- ✅ zod validation on every body and query; JSON limit 1 MB; uploads capped at 10 MB; imports capped at 5,000 rows.
- ✅ Helmet on the API.
- ☑️ The web app sets a strict CSP (same-origin only, `frame-ancestors 'none'`, `object-src 'none'`), plus X-Frame-Options DENY, nosniff, a referrer policy and a permissions policy.
- ✅ Signed booking webhooks:
  - HMAC-SHA256 over timestamp + raw body, constant-time comparison, 5-minute window;
  - idempotent per event; rejections are audited; the secret is encrypted and shown once.
- ✅ Outbound URL safety:
  - Chat webhooks are limited to https Teams/Power Automate/Slack hosts.
  - The test browser is limited to the environment host plus an allow-list; private targets are refused in production.
  - OAuth endpoints are fixed provider URLs.

## Data protection
- ✅ AES-256-GCM for OAuth refresh tokens, webhook/chat secrets and test credentials, with tamper detection. They are never returned by the API.
- ✅ Booking history records personal-data changes as "changed" without values; audit metadata redacts secret-looking keys.
- ✅ No card fields exist. The test runner refuses non-test card numbers, and card-like numbers are redacted from stored errors.
- ✅ Uploads:
  - types are decided by content against an allow-list;
  - random storage keys with a path-traversal guard; files live outside the web root;
  - downloads are attachment-only with a sandbox CSP, and are audited.
- ✅ Spreadsheet exports neutralise formulas; PDFs flag characters they can't render rather than dropping them.
- ✅ Reports are emailed only to administrator-approved recipients over TLS (plaintext SMTP is refused in production). Chat posts carry no guest data.
- ✅ Supplier follow-ups go only to the original recipients who are approved supplier contacts. Auto-send needs an administrator's approval (API plus DB constraint) and is revoked when the rule or template changes.
- ✅ Retention purge for sessions, notifications, job records, test artifacts, report files and audit logs, with minimums that prevent accidental mass deletion. Bookings are never auto-deleted.
- ✅ UTF-8 storage; non-Latin names are preserved.

## Integrity and auditing
- ✅ Append-only audit log (UPDATE blocked by a trigger) recording sign-ins, failures, lockouts, admin actions, booking changes, imports, deliveries, OAuth, webhooks, test runs and retention.
- ✅ CHECK constraints in the database:
  - dates and amounts;
  - auto-send needs an approval;
  - booking mutations only in a sandbox;
  - a report schedule needs a preview;
  - a scheduled test needs an environment.
- ✅ Idempotency and uniqueness for webhooks, report runs and deliveries, follow-up executions, imports and scheduled tests.
- ✅ Optimistic locking on bookings.

## Operations
- ✅ JSON logs with request IDs, no bodies or query strings; error responses carry the request ID and never a stack trace.
- ✅ `/metrics` behind a bearer token; `/health` and `/health/ready`.
- ✅ Containers run as the non-root `node` user; only Caddy publishes ports; Postgres and Redis are internal.
- ☑️ CI dependency gate (`scripts/audit-check.mjs`): any high or critical advisory in production dependencies fails the build unless it's recorded in `security/audit-allowlist.json` with a reason and review date.
- ⚠️ **Accepted:** GHSA-ggr8-5vv4-36mx (`deepmerge-ts` inside the Prisma CLI).
  - The CLI is used only at migration time on our own configuration.
  - The fix needs Prisma 7.
  - Review by 2027-02-01.
- ⚠️ **Your action:**
  - Store `ENCRYPTION_KEY` outside the database backups.
  - Schedule `deploy/backup.sh` and test a restore.
  - Restrict SSH and the Docker socket on the host.
  - Review user access quarterly using the audit log.
