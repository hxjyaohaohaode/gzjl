CREATE TABLE "organization_ai_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"base_url" text DEFAULT 'https://open.bigmodel.cn/api/paas/v4' NOT NULL,
	"model" text DEFAULT 'glm-4.7-flash' NOT NULL,
	"api_key_ciphertext" text,
	"daily_request_limit" integer DEFAULT 20 NOT NULL,
	"monthly_request_limit" integer DEFAULT 300 NOT NULL,
	"max_output_tokens" integer DEFAULT 1200 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_ai_settings_daily_limit_check" CHECK ("organization_ai_settings"."daily_request_limit" between 1 and 10000),
	CONSTRAINT "organization_ai_settings_monthly_limit_check" CHECK ("organization_ai_settings"."monthly_request_limit" between 1 and 300000),
	CONSTRAINT "organization_ai_settings_max_output_check" CHECK ("organization_ai_settings"."max_output_tokens" between 128 and 16000)
);
--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD COLUMN "max_output_tokens" integer DEFAULT 1200 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD COLUMN "provider_request_id" text;--> statement-breakpoint
ALTER TABLE "organization_ai_settings" ADD CONSTRAINT "organization_ai_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_events_org_created_idx" ON "outbox_events" USING btree ("organization_id","created_at","id");--> statement-breakpoint
