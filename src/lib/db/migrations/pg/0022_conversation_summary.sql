-- Conversation Summary table for context compaction/long-term memory
-- Stores LLM-generated summaries when context is compacted to enable endless conversations

CREATE TABLE IF NOT EXISTS "conversation_summary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"summary" text NOT NULL,
	"messages_compacted" integer NOT NULL,
	"tokens_saved" integer NOT NULL,
	"summary_tokens" integer DEFAULT 0 NOT NULL,
	"parent_summary_id" uuid,
	"sequence_number" integer DEFAULT 1 NOT NULL,
	"model_provider" varchar(50),
	"model_name" varchar(100),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Foreign key constraints
DO $$ BEGIN
 ALTER TABLE "conversation_summary" ADD CONSTRAINT "conversation_summary_thread_id_chat_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_thread"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "conversation_summary" ADD CONSTRAINT "conversation_summary_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "conversation_summary" ADD CONSTRAINT "conversation_summary_parent_summary_id_fk" FOREIGN KEY ("parent_summary_id") REFERENCES "public"."conversation_summary"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS "conversation_summary_thread_idx" ON "conversation_summary" USING btree ("thread_id");
CREATE INDEX IF NOT EXISTS "conversation_summary_user_idx" ON "conversation_summary" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "conversation_summary_sequence_idx" ON "conversation_summary" USING btree ("thread_id","sequence_number");
CREATE INDEX IF NOT EXISTS "conversation_summary_parent_idx" ON "conversation_summary" USING btree ("parent_summary_id");
