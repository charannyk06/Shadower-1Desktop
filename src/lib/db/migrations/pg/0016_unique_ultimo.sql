CREATE TABLE "composio_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_id" text NOT NULL,
	"connected_apps" json DEFAULT '[]'::json,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "composio_connection_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "promo_code_redemption" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promo_code_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"purchase_type" varchar NOT NULL,
	"original_amount" text NOT NULL,
	"discount_amount" text NOT NULL,
	"final_amount" text NOT NULL,
	"stripe_checkout_session_id" text,
	"stripe_invoice_id" text,
	"redeemed_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"description" text,
	"discount_type" varchar NOT NULL,
	"discount_value" text NOT NULL,
	"applies_to" varchar DEFAULT 'all' NOT NULL,
	"applicable_tiers" json DEFAULT '[]'::json,
	"applicable_token_packs" json DEFAULT '[]'::json,
	"max_redemptions" text,
	"current_redemptions" text DEFAULT '0' NOT NULL,
	"max_per_user" text DEFAULT '1' NOT NULL,
	"new_users_only" boolean DEFAULT false NOT NULL,
	"min_amount" text,
	"starts_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"expires_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"stripe_coupon_id" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "promo_code_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "referral" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_id" uuid NOT NULL,
	"referee_id" uuid NOT NULL,
	"referral_code" varchar(20) NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"referrer_bonus" text DEFAULT '0' NOT NULL,
	"referee_bonus" text DEFAULT '0' NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "referral_referee_unique" UNIQUE("referee_id")
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tier" varchar DEFAULT 'free' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"stripe_price_id" text,
	"status" varchar DEFAULT 'active' NOT NULL,
	"current_period_start" timestamp,
	"current_period_end" timestamp,
	"cancel_at_period_end" boolean DEFAULT false,
	"cancel_at" timestamp,
	"purchased_tokens" text DEFAULT '0' NOT NULL,
	"purchased_tokens_used" text DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "subscription_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "usage_alert" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"alert_type" varchar NOT NULL,
	"limit_type" varchar NOT NULL,
	"threshold" text NOT NULL,
	"current_usage" text NOT NULL,
	"usage_limit" text NOT NULL,
	"email_sent" boolean DEFAULT false NOT NULL,
	"email_sent_at" timestamp,
	"acknowledged_at" timestamp,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "usage_alert_unique" UNIQUE("user_id","alert_type","limit_type","period_start")
);
--> statement-breakpoint
CREATE TABLE "usage_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type" varchar NOT NULL,
	"amount" text NOT NULL,
	"metadata" json,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"processed_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"metadata" json,
	CONSTRAINT "webhook_event_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_retry_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" json NOT NULL,
	"retry_count" text DEFAULT '0' NOT NULL,
	"max_retries" text DEFAULT '5' NOT NULL,
	"next_retry_at" timestamp NOT NULL,
	"last_error" text,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "referral_code" varchar(20);--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "referred_by_id" uuid;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "total_referrals" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "total_referral_bonus" text DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "composio_connection" ADD CONSTRAINT "composio_connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_code_redemption" ADD CONSTRAINT "promo_code_redemption_promo_code_id_promo_code_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_code"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_code_redemption" ADD CONSTRAINT "promo_code_redemption_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral" ADD CONSTRAINT "referral_referrer_id_user_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral" ADD CONSTRAINT "referral_referee_id_user_id_fk" FOREIGN KEY ("referee_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_alert" ADD CONSTRAINT "usage_alert_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_event" ADD CONSTRAINT "usage_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_retry_queue" ADD CONSTRAINT "webhook_retry_queue_event_id_webhook_event_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."webhook_event"("event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "redemption_user_idx" ON "promo_code_redemption" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "redemption_code_idx" ON "promo_code_redemption" USING btree ("promo_code_id");--> statement-breakpoint
CREATE INDEX "promo_code_code_idx" ON "promo_code" USING btree ("code");--> statement-breakpoint
CREATE INDEX "promo_code_active_idx" ON "promo_code" USING btree ("is_active","expires_at");--> statement-breakpoint
CREATE INDEX "referral_referrer_id_idx" ON "referral" USING btree ("referrer_id");--> statement-breakpoint
CREATE INDEX "referral_referee_id_idx" ON "referral" USING btree ("referee_id");--> statement-breakpoint
CREATE INDEX "referral_status_idx" ON "referral" USING btree ("status");--> statement-breakpoint
CREATE INDEX "usage_alert_user_id_idx" ON "usage_alert" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "usage_alert_type_idx" ON "usage_alert" USING btree ("alert_type","limit_type");--> statement-breakpoint
CREATE INDEX "usage_event_user_idx" ON "usage_event" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "usage_event_type_idx" ON "usage_event" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "usage_event_created_idx" ON "usage_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "webhook_event_id_idx" ON "webhook_event" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "webhook_event_processed_at_idx" ON "webhook_event" USING btree ("processed_at");--> statement-breakpoint
CREATE INDEX "webhook_retry_event_id_idx" ON "webhook_retry_queue" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "webhook_retry_status_idx" ON "webhook_retry_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "webhook_retry_next_retry_idx" ON "webhook_retry_queue" USING btree ("next_retry_at");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_referral_code_unique" UNIQUE("referral_code");