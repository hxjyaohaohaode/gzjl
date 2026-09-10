ALTER TABLE "organization_ai_settings" ALTER COLUMN "base_url" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "organization_ai_settings" ALTER COLUMN "model" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "organization_ai_settings" ADD COLUMN "generation_options" jsonb DEFAULT '{}'::jsonb NOT NULL;