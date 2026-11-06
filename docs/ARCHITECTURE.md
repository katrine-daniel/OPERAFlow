# Architecture

```
 Browser ──HTTPS──▶ Caddy ──▶ Next.js web (SSR, :3000) ──/api/* rewrite──▶ NestJS API (:4000) ──▶ PostgreSQL
                                                                              │
                                                                              └──▶ Redis/BullMQ ◀── worker (Phase 3+)
                                                                                                    ├─ report generation & delivery
                                                                                                    ├─ mailbox polling & follow-ups
                                                                                                    └─ Playwright test runner
```

## Key decisions

| Decision | Why |
|---|---|
| Browser talks only to the web origin; `/api/*` is proxied | Session cookie stays first-party (`SameSite=Lax`, `httpOnly`); no API URL or secret in client JS. |
| Opaque server-side sessions (not JWT) | Instant revocation on logout, role change, deactivation, password change. DB stores SHA-256 of the token only. |
| Permission matrix in `packages/shared` | One source of truth; API enforces it in a global guard, web uses it only to hide UI. |
| Global guard chain: Throttler → Origin (CSRF) → Session → Permissions | Every route is authenticated and authorised by default; `@Public()` is an explicit opt-out. |
| Money as `NUMERIC(12,2)` + ISO currency, nullable | Missing values stay `NULL` so reports flag them instead of treating them as 0. |
| Integrity rules as SQL `CHECK` constraints/triggers | Enforced regardless of code path: dates, amounts, AUTO_SEND requires admin approval, booking mutations only in SANDBOX environments, schedules require a preview, audit log is append-only. |
| Idempotency keys + unique constraints on executions/deliveries | `(conversation, sequence)` and `(reportRun, channel, recipient)` make duplicate follow-ups or report sends impossible at the DB level, even under job retries. |
| Integrations carry `mode` = LIVE / DEMO / DISABLED | Demo or manual adapters are always labelled; nothing pretends to be a live integration. |
| Secrets encrypted with AES-256-GCM (`ENCRYPTION_KEY`) | OAuth refresh tokens and API keys at rest; never returned by the API. |

## Roles

| Permission area | Admin | Ops Manager | Ops Staff | QA |
|---|:-:|:-:|:-:|:-:|
| Dashboard | ✓ | ✓ | ✓ | ✓ |
| Users: view / manage | ✓ / ✓ | ✓ / – | – | – |
| Audit log | ✓ | ✓ | – | – |
| Bookings: read, write, PII | ✓ | ✓ | ✓ | – |
| Bookings: import, reconcile | ✓ | ✓ | – | – |
| Suppliers: manage | ✓ | ✓ | read | – |
| Follow-ups: manage | ✓ | ✓ | ✓ | – |
| Follow-ups: approve unattended auto-send | ✓ | – | – | – |
| Reports: manage / approve recipients | ✓ / ✓ | ✓ / – | read | – |
| Tests: run / manage | ✓ | read | – | ✓ |
| Integrations: manage | ✓ | read | – | read |

Source: `packages/shared/src/permissions.ts`.

## Data model (packages/db/prisma/schema.prisma)

Identity: `User`, `Session`, `AuditLog`, `Notification`, `SystemSetting`.
Directory: `Supplier`, `SupplierContact` (only these addresses may receive follow-ups), `Hotel`, `Integration`.
Bookings: `BookingSource`, `Booking`, `BookingChange`, `BookingDocument`, `BookingImport`, `ReconciliationIssue`.
Follow-ups: `EmailConversation`, `EmailMessage` (with reply classification), `FollowUpTemplate`, `FollowUpRule`, `FollowUpExecution`.
Testing: `TestEnvironment`, `TestScenario`, `TestRun`, `TestArtifact`.
Reports: `ApprovedRecipient`, `ScheduledReport`, `ReportRun`, `ReportDelivery`.
Jobs: `JobExecution`.
