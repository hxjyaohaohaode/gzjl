ALTER TABLE "exports" ADD COLUMN "progress" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "max_attempts" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "file_name" text;--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "content_type" text;--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "byte_size" integer;--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "row_count" integer;--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "exports_dispatch_idx" ON "exports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "exports_expiry_idx" ON "exports" USING btree ("status","expires_at");