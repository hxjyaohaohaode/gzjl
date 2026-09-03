ALTER TABLE "work_sessions" ADD COLUMN "record_kind" text DEFAULT 'fact' NOT NULL;--> statement-breakpoint
CREATE INDEX "work_sessions_member_kind_start_idx" ON "work_sessions" USING btree ("membership_id","record_kind","start_at");--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_record_kind_check" CHECK ("work_sessions"."record_kind" in ('fact', 'plan'));