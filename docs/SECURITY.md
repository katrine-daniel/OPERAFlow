# Security checklist

Legend: ✅ implemented and covered by automated tests · 🟡 implemented, not yet tested end-to-end · ⏳ planned (phase)

## Authentication & sessions
- ✅ Argon2id password hashing (OWASP parameters); password policy of 12+ chars with 3 character classes
- ✅ Opaque 256-bit session tokens; only SHA-256 hashes stored
- ✅ `httpOnly`, `SameSite=Lax` cookie; `Secure` enforced in production (start-up refuses otherwise)
- ✅ Absolute (12h) and idle (60 min) session expiry
- ✅ Account lockout after 5 failures for 15 min; generic error messages; timing equalised for unknown emails
- ✅ Sessions revoked on logout, password change (other sessions), role change and deactivation
- ✅ Login rate limit (10/min/IP) and global rate limit (300/min/IP)
- ⏳ Optional SSO (Microsoft Entra ID) and TOTP MFA (Phase 6)

## Authorisation
- ✅ Every route requires a session unless explicitly `@Public()` (health, login only)
- ✅ Server-side permission guard on every protected route; matrix in `packages/shared`
- ✅ Admin cannot demote/deactivate self; the last active admin cannot be removed
- ✅ Unattended follow-up sending requires a recorded admin approval (DB CHECK constraint)

## Request integrity
- ✅ CSRF: state-changing requests must carry an allowed `Origin`/`Referer`
- ✅ Input validation with zod on every body/query; 1 MB JSON limit
- ✅ Helmet security headers on the API; frame-deny, nosniff, referrer and permissions policies on the web app
- ✅ File uploads: type decided by magic bytes against an allow-list (HTML, SVG and executables rejected); 10 MB cap; random server-generated storage keys with path-traversal guard; files outside the web root; downloads forced to attachment with sandbox CSP, `no-store`, and audited
- ✅ Signed booking webhooks: HMAC-SHA256 over timestamp + raw body, constant-time compare, 5-minute replay window, per-event idempotency, rejections audited, secret encrypted at rest and shown once
- ✅ Optimistic locking on bookings (no lost updates); online-source-owned fields cannot be edited by staff
- ✅ Booking change history stores PII changes without values
- ✅ CSV/Excel import: row cap, size cap, binary/NUL rejection, formula cells read as values

## Data protection
- ✅ AES-256-GCM encryption for integration secrets; tamper detection tested
- ✅ Secret-looking keys redacted from audit metadata
- ✅ Email/phone/name masking helpers (used for exports and low-privilege views from Phase 2)
- ✅ No payment-card fields exist in the schema
- ✅ UTF-8 database encoding; non-Latin guest names verified
- ⏳ Retention jobs (settings seeded: audit 730d, sessions 30d, test artifacts 30d, report files 365d) (Phase 6)

## Audit & monitoring
- ✅ Audit log of logins, failures, lockouts, user changes and password resets, with IP and user agent
- ✅ Audit log is append-only at the database level (UPDATE blocked by trigger)
- ✅ `/health` endpoint (database check); container health checks
- ⏳ Structured JSON logs, error tracking (e.g. Sentry) and metrics (Phase 6)

## Test-automation safety (Phase 5)
- ✅ DB constraint plus pre-flight and run-time checks: booking create/modify/cancel scenarios run only against `SANDBOX` environments with mutations enabled
- ✅ Luhn-valid card numbers that aren't published test cards are refused before any browser starts
- ✅ Browser network restricted to the environment host and an explicit allow-list; everything else is aborted and logged
- ✅ PRODUCTION_READONLY environments abort all non-GET requests except allow-listed paths
- ✅ Private/internal targets refused in production (SSRF guard); https required
- ✅ Environment credentials are write-only and encrypted; secrets and card-like numbers are redacted from errors, steps and logs

## Operational
- ✅ No credentials in source; seed passwords generated or supplied via env
- ✅ Containers run as non-root `node` user; Postgres and Redis not published
- 🟡 TLS via Caddy (compose stack not yet run)
- ⏳ Dependency scanning in CI (Phase 6)
