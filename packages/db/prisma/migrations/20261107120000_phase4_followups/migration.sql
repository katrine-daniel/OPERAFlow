-- Phase 4: supplier follow-ups.

-- RFC 5322 Message-ID of the tracked original, used for In-Reply-To / References threading headers.
ALTER TABLE "email_conversations" ADD COLUMN "original_internet_message_id" TEXT;

-- Subject of each observed message (shown in the review timeline). Bodies are never stored.
ALTER TABLE "email_messages" ADD COLUMN "subject" TEXT;

-- Rendered follow-up content, so reviewers approve exactly what will be sent.
ALTER TABLE "follow_up_executions" ADD COLUMN "subject" TEXT;
ALTER TABLE "follow_up_executions" ADD COLUMN "body" TEXT;

CREATE INDEX "email_messages_conversation_id_received_at_idx" ON "email_messages" ("conversation_id", "received_at");
