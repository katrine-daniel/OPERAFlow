-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'OPS_MANAGER', 'OPS_STAFF', 'QA');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "IntegrationKind" AS ENUM ('GMAIL', 'MICROSOFT_GRAPH', 'BOOKING_API', 'BOOKING_WEBHOOK', 'TBO', 'CSV_ADAPTER', 'TEAMS_WEBHOOK', 'SLACK_WEBHOOK', 'SMTP');

-- CreateEnum
CREATE TYPE "IntegrationMode" AS ENUM ('LIVE', 'DEMO', 'DISABLED');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('NOT_CONFIGURED', 'CONNECTED', 'ERROR', 'REVOKED');

-- CreateEnum
CREATE TYPE "SupplierType" AS ENUM ('HOTEL_DIRECT', 'WHOLESALER', 'BEDBANK', 'DMC', 'OTHER');

-- CreateEnum
CREATE TYPE "BookingChannel" AS ENUM ('ONLINE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "SourceAdapter" AS ENUM ('API', 'WEBHOOK', 'CSV_IMPORT', 'MANUAL');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'ON_REQUEST', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'REFUNDED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "ConfirmationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CancellationStatus" AS ENUM ('NONE', 'REQUESTED', 'CANCELLED', 'CANCELLED_WITH_FEE');

-- CreateEnum
CREATE TYPE "BookingChangeType" AS ENUM ('CREATED', 'UPDATED', 'STATUS_CHANGED', 'IMPORTED', 'SYNCED', 'CANCELLED', 'DOCUMENT_ADDED');

-- CreateEnum
CREATE TYPE "ChangeOrigin" AS ENUM ('UI', 'IMPORT', 'SYNC', 'WEBHOOK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('VALIDATING', 'READY', 'COMMITTED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReconciliationIssueType" AS ENUM ('DUPLICATE_SUSPECT', 'AMOUNT_MISMATCH', 'STATUS_MISMATCH', 'MISSING_IN_SOURCE', 'MISSING_REQUIRED_DATA');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('TRACKING', 'REPLIED', 'FOLLOWUP_DUE', 'AWAITING_APPROVAL', 'PAUSED', 'CANCELLED', 'EXHAUSTED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "ReplyClassification" AS ENUM ('ORIGINAL', 'OWN_FOLLOW_UP', 'QUALIFYING_REPLY', 'OUT_OF_OFFICE', 'AUTO_REPLY', 'BOUNCE', 'INTERNAL', 'AMBIGUOUS');

-- CreateEnum
CREATE TYPE "FollowUpSendMode" AS ENUM ('DRAFT_REVIEW', 'AUTO_SEND');

-- CreateEnum
CREATE TYPE "FollowUpExecutionStatus" AS ENUM ('SCHEDULED', 'DRAFT_CREATED', 'AWAITING_APPROVAL', 'SENDING', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TestEnvironmentKind" AS ENUM ('SANDBOX', 'STAGING', 'PRODUCTION_READONLY');

-- CreateEnum
CREATE TYPE "TestJourney" AS ENUM ('HOTEL_SEARCH', 'ROOM_AVAILABILITY', 'RATE_SELECTION', 'GUEST_VALIDATION', 'BOOKING_CREATE', 'BOOKING_CONFIRMATION', 'BOOKING_MODIFY', 'BOOKING_CANCEL', 'CANCELLATION_POLICY', 'NEGATIVE_INPUTS');

-- CreateEnum
CREATE TYPE "TestTrigger" AS ENUM ('MANUAL', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "TestRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'ERROR', 'BLOCKED_SAFETY', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FailureClass" AS ENUM ('ASSERTION', 'TIMEOUT', 'NETWORK', 'HTTP_ERROR', 'ENVIRONMENT', 'SAFETY_GUARD', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ArtifactKind" AS ENUM ('SCREENSHOT', 'TRACE', 'VIDEO', 'LOG');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('DAILY_OPERATIONS');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('XLSX', 'PDF');

-- CreateEnum
CREATE TYPE "ReportRunStatus" AS ENUM ('PENDING', 'GENERATING', 'GENERATED', 'FAILED');

-- CreateEnum
CREATE TYPE "DeliveryChannel" AS ENUM ('EMAIL', 'INTEGRATION');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'RETRYING', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "password_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "ip_address" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" UUID NOT NULL,
    "kind" "IntegrationKind" NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "IntegrationMode" NOT NULL DEFAULT 'DISABLED',
    "status" "IntegrationStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "config" JSONB NOT NULL DEFAULT '{}',
    "encrypted_secret" TEXT,
    "mailbox_address" TEXT,
    "owner_user_id" UUID,
    "last_sync_at" TIMESTAMPTZ(6),
    "sync_cursor" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SupplierType" NOT NULL,
    "phone" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_contacts" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotels" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "address" TEXT,
    "star_rating" SMALLINT,
    "external_ids" JSONB NOT NULL DEFAULT '{}',
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "hotels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_sources" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "BookingChannel" NOT NULL,
    "adapter" "SourceAdapter" NOT NULL,
    "is_live" BOOLEAN NOT NULL DEFAULT false,
    "integration_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "booking_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "internal_ref" TEXT NOT NULL,
    "external_ref" TEXT,
    "source_id" UUID NOT NULL,
    "channel" "BookingChannel" NOT NULL,
    "supplier_id" UUID,
    "hotel_id" UUID,
    "lead_guest_name" TEXT NOT NULL,
    "guest_email" TEXT,
    "guest_phone" TEXT,
    "adults" SMALLINT NOT NULL DEFAULT 1,
    "children" SMALLINT NOT NULL DEFAULT 0,
    "rooms" SMALLINT NOT NULL DEFAULT 1,
    "room_type" TEXT,
    "board_basis" TEXT,
    "booking_date" TIMESTAMPTZ(6) NOT NULL,
    "check_in" DATE NOT NULL,
    "check_out" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "selling_amount" DECIMAL(12,2),
    "cost_amount" DECIMAL(12,2),
    "tax_amount" DECIMAL(12,2),
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "confirmation_status" "ConfirmationStatus" NOT NULL DEFAULT 'PENDING',
    "cancellation_status" "CancellationStatus" NOT NULL DEFAULT 'NONE',
    "confirmation_number" TEXT,
    "assigned_to_id" UUID,
    "created_by_id" UUID,
    "notes" TEXT,
    "dedupe_key" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "external_updated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_changes" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "changed_by_id" UUID,
    "change_type" "BookingChangeType" NOT NULL,
    "origin" "ChangeOrigin" NOT NULL,
    "diff" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_documents" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_imports" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'VALIDATING',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "created_rows" INTEGER NOT NULL DEFAULT 0,
    "updated_rows" INTEGER NOT NULL DEFAULT 0,
    "skipped_rows" INTEGER NOT NULL DEFAULT 0,
    "error_rows" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "booking_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_issues" (
    "id" UUID NOT NULL,
    "type" "ReconciliationIssueType" NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "booking_id" UUID,
    "matched_booking_id" UUID,
    "details" JSONB NOT NULL,
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_conversations" (
    "id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "provider_thread_id" TEXT NOT NULL,
    "original_message_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "supplier_id" UUID,
    "owner_id" UUID NOT NULL,
    "rule_id" UUID,
    "recipients" TEXT[],
    "status" "ConversationStatus" NOT NULL DEFAULT 'TRACKING',
    "original_sent_at" TIMESTAMPTZ(6) NOT NULL,
    "last_external_reply_at" TIMESTAMPTZ(6),
    "last_checked_at" TIMESTAMPTZ(6),
    "next_follow_up_at" TIMESTAMPTZ(6),
    "follow_up_count" INTEGER NOT NULL DEFAULT 0,
    "paused_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "email_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "from_address" TEXT NOT NULL,
    "classification" "ReplyClassification" NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_up_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "subject_template" TEXT NOT NULL,
    "body_template" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "follow_up_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_up_rules" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "delay_hours" INTEGER NOT NULL,
    "max_follow_ups" INTEGER NOT NULL DEFAULT 2,
    "business_hours_only" BOOLEAN NOT NULL DEFAULT true,
    "business_start" TEXT NOT NULL DEFAULT '09:00',
    "business_end" TEXT NOT NULL DEFAULT '18:00',
    "business_days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "template_id" UUID NOT NULL,
    "send_mode" "FollowUpSendMode" NOT NULL DEFAULT 'DRAFT_REVIEW',
    "auto_send_approved_by_id" UUID,
    "auto_send_approved_at" TIMESTAMPTZ(6),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "follow_up_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_up_executions" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "FollowUpExecutionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "idempotency_key" TEXT NOT NULL,
    "scheduled_for" TIMESTAMPTZ(6) NOT NULL,
    "recipients" TEXT[],
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "provider_draft_id" TEXT,
    "provider_message_id" TEXT,
    "approved_by_id" UUID,
    "last_error" TEXT,
    "skip_reason" TEXT,
    "attempted_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "follow_up_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_environments" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "kind" "TestEnvironmentKind" NOT NULL,
    "allow_booking_mutations" BOOLEAN NOT NULL DEFAULT false,
    "encrypted_secret" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "test_environments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_scenarios" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "journey" "TestJourney" NOT NULL,
    "is_critical" BOOLEAN NOT NULL DEFAULT false,
    "mutates_bookings" BOOLEAN NOT NULL DEFAULT false,
    "viewports" TEXT[] DEFAULT ARRAY['desktop']::TEXT[],
    "config" JSONB NOT NULL DEFAULT '{}',
    "cron" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "test_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_runs" (
    "id" UUID NOT NULL,
    "scenario_id" UUID NOT NULL,
    "environment_id" UUID NOT NULL,
    "trigger" "TestTrigger" NOT NULL,
    "triggered_by_id" UUID,
    "viewport" TEXT NOT NULL,
    "status" "TestRunStatus" NOT NULL DEFAULT 'QUEUED',
    "failure_class" "FailureClass",
    "error_message" TEXT,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "idempotency_key" TEXT,
    "queued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "duration_ms" INTEGER,

    CONSTRAINT "test_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_artifacts" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "kind" "ArtifactKind" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approved_recipients" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "label" TEXT,
    "approved_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approved_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_reports" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ReportType" NOT NULL DEFAULT 'DAILY_OPERATIONS',
    "cron" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "formats" "ReportFormat"[],
    "recipients" TEXT[],
    "channel_integration_id" UUID,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "last_previewed_at" TIMESTAMPTZ(6),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scheduled_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_runs" (
    "id" UUID NOT NULL,
    "scheduled_report_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "is_preview" BOOLEAN NOT NULL DEFAULT false,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "ReportRunStatus" NOT NULL DEFAULT 'PENDING',
    "row_count" INTEGER,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "summary" JSONB,
    "files" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "triggered_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generated_at" TIMESTAMPTZ(6),

    CONSTRAINT "report_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_deliveries" (
    "id" UUID NOT NULL,
    "report_run_id" UUID NOT NULL,
    "channel" "DeliveryChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "provider_message_id" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "report_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_executions" (
    "id" UUID NOT NULL,
    "queue" TEXT NOT NULL,
    "job_name" TEXT NOT NULL,
    "job_id" TEXT,
    "idempotency_key" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB,
    "result" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "integrations_kind_mode_idx" ON "integrations"("kind", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_kind_mailbox_address_key" ON "integrations"("kind", "mailbox_address");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers"("code");

-- CreateIndex
CREATE INDEX "suppliers_name_idx" ON "suppliers"("name");

-- CreateIndex
CREATE INDEX "supplier_contacts_email_idx" ON "supplier_contacts"("email");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_contacts_supplier_id_email_key" ON "supplier_contacts"("supplier_id", "email");

-- CreateIndex
CREATE INDEX "hotels_city_idx" ON "hotels"("city");

-- CreateIndex
CREATE UNIQUE INDEX "hotels_name_city_country_key" ON "hotels"("name", "city", "country");

-- CreateIndex
CREATE UNIQUE INDEX "booking_sources_code_key" ON "booking_sources"("code");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_internal_ref_key" ON "bookings"("internal_ref");

-- CreateIndex
CREATE INDEX "bookings_booking_date_idx" ON "bookings"("booking_date");

-- CreateIndex
CREATE INDEX "bookings_check_in_idx" ON "bookings"("check_in");

-- CreateIndex
CREATE INDEX "bookings_status_idx" ON "bookings"("status");

-- CreateIndex
CREATE INDEX "bookings_supplier_id_idx" ON "bookings"("supplier_id");

-- CreateIndex
CREATE INDEX "bookings_assigned_to_id_idx" ON "bookings"("assigned_to_id");

-- CreateIndex
CREATE INDEX "bookings_dedupe_key_idx" ON "bookings"("dedupe_key");

-- CreateIndex
CREATE INDEX "bookings_channel_booking_date_idx" ON "bookings"("channel", "booking_date");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_source_id_external_ref_key" ON "bookings"("source_id", "external_ref");

-- CreateIndex
CREATE INDEX "booking_changes_booking_id_created_at_idx" ON "booking_changes"("booking_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "booking_documents_storage_key_key" ON "booking_documents"("storage_key");

-- CreateIndex
CREATE INDEX "booking_documents_booking_id_idx" ON "booking_documents"("booking_id");

-- CreateIndex
CREATE INDEX "booking_imports_created_at_idx" ON "booking_imports"("created_at");

-- CreateIndex
CREATE INDEX "reconciliation_issues_status_type_idx" ON "reconciliation_issues"("status", "type");

-- CreateIndex
CREATE INDEX "email_conversations_status_next_follow_up_at_idx" ON "email_conversations"("status", "next_follow_up_at");

-- CreateIndex
CREATE INDEX "email_conversations_owner_id_idx" ON "email_conversations"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_conversations_integration_id_provider_thread_id_key" ON "email_conversations"("integration_id", "provider_thread_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_conversation_id_provider_message_id_key" ON "email_messages"("conversation_id", "provider_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "follow_up_templates_name_key" ON "follow_up_templates"("name");

-- CreateIndex
CREATE UNIQUE INDEX "follow_up_rules_name_key" ON "follow_up_rules"("name");

-- CreateIndex
CREATE UNIQUE INDEX "follow_up_executions_idempotency_key_key" ON "follow_up_executions"("idempotency_key");

-- CreateIndex
CREATE INDEX "follow_up_executions_status_scheduled_for_idx" ON "follow_up_executions"("status", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "follow_up_executions_conversation_id_sequence_key" ON "follow_up_executions"("conversation_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "test_environments_name_key" ON "test_environments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "test_scenarios_key_key" ON "test_scenarios"("key");

-- CreateIndex
CREATE UNIQUE INDEX "test_runs_idempotency_key_key" ON "test_runs"("idempotency_key");

-- CreateIndex
CREATE INDEX "test_runs_scenario_id_queued_at_idx" ON "test_runs"("scenario_id", "queued_at");

-- CreateIndex
CREATE INDEX "test_runs_status_idx" ON "test_runs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "test_artifacts_storage_key_key" ON "test_artifacts"("storage_key");

-- CreateIndex
CREATE INDEX "test_artifacts_run_id_idx" ON "test_artifacts"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "approved_recipients_email_key" ON "approved_recipients"("email");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_reports_name_key" ON "scheduled_reports"("name");

-- CreateIndex
CREATE UNIQUE INDEX "report_runs_idempotency_key_key" ON "report_runs"("idempotency_key");

-- CreateIndex
CREATE INDEX "report_runs_scheduled_report_id_created_at_idx" ON "report_runs"("scheduled_report_id", "created_at");

-- CreateIndex
CREATE INDEX "report_deliveries_status_idx" ON "report_deliveries"("status");

-- CreateIndex
CREATE UNIQUE INDEX "report_deliveries_report_run_id_channel_recipient_key" ON "report_deliveries"("report_run_id", "channel", "recipient");

-- CreateIndex
CREATE UNIQUE INDEX "job_executions_idempotency_key_key" ON "job_executions"("idempotency_key");

-- CreateIndex
CREATE INDEX "job_executions_queue_status_idx" ON "job_executions"("queue", "status");

-- CreateIndex
CREATE INDEX "job_executions_created_at_idx" ON "job_executions"("created_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_contacts" ADD CONSTRAINT "supplier_contacts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_sources" ADD CONSTRAINT "booking_sources_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "booking_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_changes" ADD CONSTRAINT "booking_changes_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_changes" ADD CONSTRAINT "booking_changes_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_documents" ADD CONSTRAINT "booking_documents_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_documents" ADD CONSTRAINT "booking_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_imports" ADD CONSTRAINT "booking_imports_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "booking_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_imports" ADD CONSTRAINT "booking_imports_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_issues" ADD CONSTRAINT "reconciliation_issues_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_issues" ADD CONSTRAINT "reconciliation_issues_matched_booking_id_fkey" FOREIGN KEY ("matched_booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_issues" ADD CONSTRAINT "reconciliation_issues_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_conversations" ADD CONSTRAINT "email_conversations_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_conversations" ADD CONSTRAINT "email_conversations_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_conversations" ADD CONSTRAINT "email_conversations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_conversations" ADD CONSTRAINT "email_conversations_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "follow_up_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "email_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_rules" ADD CONSTRAINT "follow_up_rules_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "follow_up_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_rules" ADD CONSTRAINT "follow_up_rules_auto_send_approved_by_id_fkey" FOREIGN KEY ("auto_send_approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_executions" ADD CONSTRAINT "follow_up_executions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "email_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_executions" ADD CONSTRAINT "follow_up_executions_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "test_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "test_environments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_triggered_by_id_fkey" FOREIGN KEY ("triggered_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_artifacts" ADD CONSTRAINT "test_artifacts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "test_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approved_recipients" ADD CONSTRAINT "approved_recipients_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_channel_integration_id_fkey" FOREIGN KEY ("channel_integration_id") REFERENCES "integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_scheduled_report_id_fkey" FOREIGN KEY ("scheduled_report_id") REFERENCES "scheduled_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_triggered_by_id_fkey" FOREIGN KEY ("triggered_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_report_run_id_fkey" FOREIGN KEY ("report_run_id") REFERENCES "report_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
