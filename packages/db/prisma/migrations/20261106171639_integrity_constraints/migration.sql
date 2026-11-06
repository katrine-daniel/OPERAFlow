-- Integrity rules Prisma cannot express in schema.prisma. Enforced by PostgreSQL itself,
-- so bad data is rejected regardless of which code path writes it.

-- Bookings
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_dates_chk" CHECK ("check_out" > "check_in");
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_occupancy_chk" CHECK ("adults" >= 1 AND "children" >= 0 AND "rooms" >= 1);
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_amounts_chk" CHECK (
  ("selling_amount" IS NULL OR "selling_amount" >= 0) AND
  ("cost_amount" IS NULL OR "cost_amount" >= 0) AND
  ("tax_amount" IS NULL OR "tax_amount" >= 0)
);
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_version_chk" CHECK ("version" >= 1);

-- Hotels
ALTER TABLE "hotels" ADD CONSTRAINT "hotels_country_chk" CHECK ("country" ~ '^[A-Z]{2}$');
ALTER TABLE "hotels" ADD CONSTRAINT "hotels_star_chk" CHECK ("star_rating" IS NULL OR "star_rating" BETWEEN 1 AND 7);

-- Users: email stored normalised
ALTER TABLE "users" ADD CONSTRAINT "users_email_lower_chk" CHECK ("email" = lower("email"));
ALTER TABLE "supplier_contacts" ADD CONSTRAINT "supplier_contacts_email_lower_chk" CHECK ("email" = lower("email"));
ALTER TABLE "approved_recipients" ADD CONSTRAINT "approved_recipients_email_lower_chk" CHECK ("email" = lower("email"));

-- Follow-up rules
ALTER TABLE "follow_up_rules" ADD CONSTRAINT "follow_up_rules_delay_chk" CHECK ("delay_hours" BETWEEN 1 AND 720);
ALTER TABLE "follow_up_rules" ADD CONSTRAINT "follow_up_rules_max_chk" CHECK ("max_follow_ups" BETWEEN 0 AND 10);
ALTER TABLE "follow_up_rules" ADD CONSTRAINT "follow_up_rules_hours_chk" CHECK (
  "business_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "business_end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
);
-- Unattended sending requires a recorded administrator approval.
ALTER TABLE "follow_up_rules" ADD CONSTRAINT "follow_up_rules_autosend_approval_chk" CHECK (
  "send_mode" <> 'AUTO_SEND' OR ("auto_send_approved_by_id" IS NOT NULL AND "auto_send_approved_at" IS NOT NULL)
);
ALTER TABLE "follow_up_executions" ADD CONSTRAINT "follow_up_executions_seq_chk" CHECK ("sequence" >= 1);

-- Test environments: booking mutations are only possible against a sandbox.
ALTER TABLE "test_environments" ADD CONSTRAINT "test_environments_mutation_sandbox_chk" CHECK (
  NOT "allow_booking_mutations" OR "kind" = 'SANDBOX'
);

-- Report schedules cannot be enabled before a preview has been generated.
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_preview_chk" CHECK (
  NOT "is_enabled" OR "last_previewed_at" IS NOT NULL
);

-- Uploaded documents: bounded size
ALTER TABLE "booking_documents" ADD CONSTRAINT "booking_documents_size_chk" CHECK ("size_bytes" > 0 AND "size_bytes" <= 20971520);

-- Audit log is append-only. DELETE stays possible for the retention job; UPDATE never is.
CREATE OR REPLACE FUNCTION operaflow_audit_immutable() RETURNS trigger AS $$
BEGIN
  -- Only permitted change: the FK's ON DELETE SET NULL clearing actor_id.
  IF OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL
     AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_no_update"
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION operaflow_audit_immutable();
