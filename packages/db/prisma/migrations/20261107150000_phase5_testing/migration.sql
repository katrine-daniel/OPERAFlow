-- Phase 5: booking-site test automation.

-- Environment that scheduled runs of a scenario target.
ALTER TABLE "test_scenarios" ADD COLUMN "environment_id" UUID;
ALTER TABLE "test_scenarios" ADD CONSTRAINT "test_scenarios_environment_id_fkey"
  FOREIGN KEY ("environment_id") REFERENCES "test_environments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Run diagnostics: blocked requests, safety decisions, console errors, HTTP errors.
ALTER TABLE "test_runs" ADD COLUMN "diagnostics" JSONB NOT NULL DEFAULT '{}';

-- A scenario that is scheduled must say where it runs.
ALTER TABLE "test_scenarios" ADD CONSTRAINT "test_scenarios_schedule_env_chk" CHECK ("cron" IS NULL OR "environment_id" IS NOT NULL);
