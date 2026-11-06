-- Phase 2: booking registry support.

-- Staged import rows between preview and commit.
ALTER TABLE "booking_imports" ADD COLUMN "rows" JSONB;

-- Reconciliation issues: stable fingerprint (no duplicates on re-run) and resolution note.
-- Table is empty before Phase 2, so a NOT NULL column without default is safe.
ALTER TABLE "reconciliation_issues" ADD COLUMN "fingerprint" TEXT NOT NULL;
ALTER TABLE "reconciliation_issues" ADD COLUMN "resolution_note" TEXT;
CREATE UNIQUE INDEX "reconciliation_issues_fingerprint_key" ON "reconciliation_issues"("fingerprint");

-- Gap-tolerant, concurrency-safe internal booking reference numbers (OF-2026-000001).
CREATE SEQUENCE IF NOT EXISTS "booking_ref_seq" START 1;

-- Search support for the registry (guest name / references), case-insensitive.
CREATE INDEX "bookings_lead_guest_name_lower_idx" ON "bookings" (lower("lead_guest_name"));
CREATE INDEX "bookings_external_ref_idx" ON "bookings" ("external_ref");
CREATE INDEX "bookings_confirmation_number_idx" ON "bookings" ("confirmation_number");
