CREATE TABLE "browser_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid,
	"user_id" uuid NOT NULL,
	"provider" varchar NOT NULL,
	"session_id" text NOT NULL,
	"status" varchar DEFAULT 'active' NOT NULL,
	"current_url" text,
	"replay_url" text,
	"screenshots" json DEFAULT '[]'::json,
	"metadata" json,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "research_task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid,
	"user_id" uuid NOT NULL,
	"query" text NOT NULL,
	"depth" varchar DEFAULT 'standard' NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"current_step" text,
	"progress" integer DEFAULT 0 NOT NULL,
	"sources" json DEFAULT '[]'::json,
	"findings" json DEFAULT '[]'::json,
	"citations" json DEFAULT '[]'::json,
	"report" text,
	"error" text,
	"browser_session_id" uuid,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "browser_session" ADD CONSTRAINT "browser_session_thread_id_chat_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_session" ADD CONSTRAINT "browser_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_task" ADD CONSTRAINT "research_task_thread_id_chat_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_task" ADD CONSTRAINT "research_task_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_task" ADD CONSTRAINT "research_task_browser_session_id_browser_session_id_fk" FOREIGN KEY ("browser_session_id") REFERENCES "public"."browser_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "browser_session_thread_idx" ON "browser_session" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "browser_session_user_idx" ON "browser_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "browser_session_provider_idx" ON "browser_session" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "browser_session_status_idx" ON "browser_session" USING btree ("status");--> statement-breakpoint
CREATE INDEX "browser_session_session_id_idx" ON "browser_session" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "research_task_thread_idx" ON "research_task" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "research_task_user_idx" ON "research_task" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "research_task_status_idx" ON "research_task" USING btree ("status");--> statement-breakpoint
CREATE INDEX "research_task_created_idx" ON "research_task" USING btree ("created_at");