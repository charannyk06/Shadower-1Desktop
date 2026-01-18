ALTER TABLE "browser_session" ADD COLUMN "last_activity_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL;--> statement-breakpoint
ALTER TABLE "browser_session" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
CREATE INDEX "browser_session_expires_idx" ON "browser_session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "browser_session_activity_idx" ON "browser_session" USING btree ("last_activity_at");--> statement-breakpoint
CREATE INDEX "browser_session_cleanup_idx" ON "browser_session" USING btree ("status","expires_at");