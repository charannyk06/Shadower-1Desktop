CREATE TABLE "thread_sandbox_context" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"context_storage_key" varchar(512),
	"context_size_bytes" text DEFAULT '0' NOT NULL,
	"file_metadata" json DEFAULT '[]'::json,
	"total_files_count" integer DEFAULT 0 NOT NULL,
	"last_execution_at" timestamp,
	"last_accessed_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "thread_sandbox_context_thread_id_unique" UNIQUE("thread_id")
);
--> statement-breakpoint
ALTER TABLE "thread_sandbox_context" ADD CONSTRAINT "thread_sandbox_context_thread_id_chat_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_sandbox_context" ADD CONSTRAINT "thread_sandbox_context_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "thread_sandbox_context_thread_idx" ON "thread_sandbox_context" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "thread_sandbox_context_user_idx" ON "thread_sandbox_context" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "thread_sandbox_context_cleanup_idx" ON "thread_sandbox_context" USING btree ("last_accessed_at");