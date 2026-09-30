CREATE TABLE "payroll_export_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_run_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"csv" text NOT NULL,
	"sha256" text NOT NULL,
	"rule_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"preview_hash" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_export_profiles" (
	"membership_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_export_batches" ADD CONSTRAINT "payroll_export_batches_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_batches" ADD CONSTRAINT "payroll_export_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_batches" ADD CONSTRAINT "payroll_export_batches_created_by_org_memberships_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_profiles" ADD CONSTRAINT "payroll_export_profiles_membership_id_org_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_profiles" ADD CONSTRAINT "payroll_export_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_profiles" ADD CONSTRAINT "payroll_export_profiles_updated_by_org_memberships_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."org_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_export_batches_run_uidx" ON "payroll_export_batches" USING btree ("payroll_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_export_profiles_org_external_uidx" ON "payroll_export_profiles" USING btree ("organization_id","external_id");