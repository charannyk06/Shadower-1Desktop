CREATE TABLE "agent_checkpoint" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_state_id" uuid NOT NULL,
	"checkpoint_number" integer NOT NULL,
	"step_number" integer NOT NULL,
	"reason" varchar NOT NULL,
	"state_snapshot" json NOT NULL,
	"used_for_recovery" boolean DEFAULT false NOT NULL,
	"metadata" json,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_execution_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_state_id" uuid NOT NULL,
	"step_number" integer NOT NULL,
	"action_type" varchar NOT NULL,
	"action_name" text,
	"input" json,
	"output" json,
	"duration_ms" integer,
	"tokens_used" json,
	"error" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"thread_id" uuid,
	"plan_data" json,
	"shared_context" json,
	"status" varchar DEFAULT 'planning' NOT NULL,
	"error_message" text,
	"steps_executed" integer DEFAULT 0 NOT NULL,
	"max_steps" integer DEFAULT 50 NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_sub_agent_relation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_agent_state_id" uuid NOT NULL,
	"child_agent_state_id" uuid NOT NULL,
	"parent_task_id" text,
	"instructions" text,
	"context_keys" json,
	"status" varchar DEFAULT 'spawned' NOT NULL,
	"result" json,
	"spawned_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "agent_tool_execution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_state_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"tool_source" varchar NOT NULL,
	"mcp_server_id" uuid,
	"input" json,
	"output" json,
	"success" boolean NOT NULL,
	"error" text,
	"duration_ms" integer,
	"cost" text,
	"started_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "agent_checkpoint" ADD CONSTRAINT "agent_checkpoint_agent_state_id_agent_state_id_fk" FOREIGN KEY ("agent_state_id") REFERENCES "public"."agent_state"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_execution_log" ADD CONSTRAINT "agent_execution_log_agent_state_id_agent_state_id_fk" FOREIGN KEY ("agent_state_id") REFERENCES "public"."agent_state"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_state" ADD CONSTRAINT "agent_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_state" ADD CONSTRAINT "agent_state_thread_id_chat_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_thread"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sub_agent_relation" ADD CONSTRAINT "agent_sub_agent_relation_parent_agent_state_id_agent_state_id_fk" FOREIGN KEY ("parent_agent_state_id") REFERENCES "public"."agent_state"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sub_agent_relation" ADD CONSTRAINT "agent_sub_agent_relation_child_agent_state_id_agent_state_id_fk" FOREIGN KEY ("child_agent_state_id") REFERENCES "public"."agent_state"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_execution" ADD CONSTRAINT "agent_tool_execution_agent_state_id_agent_state_id_fk" FOREIGN KEY ("agent_state_id") REFERENCES "public"."agent_state"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_execution" ADD CONSTRAINT "agent_tool_execution_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_execution" ADD CONSTRAINT "agent_tool_execution_mcp_server_id_mcp_server_id_fk" FOREIGN KEY ("mcp_server_id") REFERENCES "public"."mcp_server"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_checkpoint_state_id_idx" ON "agent_checkpoint" USING btree ("agent_state_id");--> statement-breakpoint
CREATE INDEX "agent_checkpoint_number_idx" ON "agent_checkpoint" USING btree ("agent_state_id","checkpoint_number");--> statement-breakpoint
CREATE INDEX "agent_checkpoint_step_idx" ON "agent_checkpoint" USING btree ("agent_state_id","step_number");--> statement-breakpoint
CREATE INDEX "agent_exec_log_state_id_idx" ON "agent_execution_log" USING btree ("agent_state_id");--> statement-breakpoint
CREATE INDEX "agent_exec_log_step_idx" ON "agent_execution_log" USING btree ("agent_state_id","step_number");--> statement-breakpoint
CREATE INDEX "agent_exec_log_action_type_idx" ON "agent_execution_log" USING btree ("action_type");--> statement-breakpoint
CREATE INDEX "agent_exec_log_created_idx" ON "agent_execution_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "agent_state_user_id_idx" ON "agent_state" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_state_thread_id_idx" ON "agent_state" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "agent_state_status_idx" ON "agent_state" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_sub_agent_parent_idx" ON "agent_sub_agent_relation" USING btree ("parent_agent_state_id");--> statement-breakpoint
CREATE INDEX "agent_sub_agent_child_idx" ON "agent_sub_agent_relation" USING btree ("child_agent_state_id");--> statement-breakpoint
CREATE INDEX "agent_sub_agent_status_idx" ON "agent_sub_agent_relation" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_tool_exec_state_id_idx" ON "agent_tool_execution" USING btree ("agent_state_id");--> statement-breakpoint
CREATE INDEX "agent_tool_exec_user_id_idx" ON "agent_tool_execution" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_tool_exec_tool_name_idx" ON "agent_tool_execution" USING btree ("tool_name");--> statement-breakpoint
CREATE INDEX "agent_tool_exec_source_idx" ON "agent_tool_execution" USING btree ("tool_source");--> statement-breakpoint
CREATE INDEX "agent_tool_exec_started_idx" ON "agent_tool_execution" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "agent_tool_exec_success_idx" ON "agent_tool_execution" USING btree ("success");