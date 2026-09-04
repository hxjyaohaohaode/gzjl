CREATE TABLE "ai_provider_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"source" text NOT NULL,
	"endpoint_host" text NOT NULL,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"http_status" integer,
	"error_summary" text,
	"provider_request_id" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_provider_checks_status_check" CHECK ("ai_provider_checks"."status" in ('running', 'succeeded', 'failed')),
	CONSTRAINT "ai_provider_checks_latency_check" CHECK ("ai_provider_checks"."latency_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ai_provider_checks" ADD CONSTRAINT "ai_provider_checks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_checks" ADD CONSTRAINT "ai_provider_checks_requested_by_org_memberships_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_provider_checks_org_checked_idx" ON "ai_provider_checks" USING btree ("organization_id","checked_at");
