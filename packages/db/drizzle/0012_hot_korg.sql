CREATE TABLE "reimbursement_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"expense_date" text NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"currency" text DEFAULT 'CNY' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"pay_period_id" uuid,
	"reviewed_by" uuid,
	"review_note" text,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reimbursement_positive_amount" CHECK ("reimbursement_requests"."amount" > 0),
	CONSTRAINT "reimbursement_valid_status" CHECK ("reimbursement_requests"."status" in ('draft', 'pending', 'approved', 'rejected', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "reimbursement_requests" ADD CONSTRAINT "reimbursement_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement_requests" ADD CONSTRAINT "reimbursement_requests_membership_id_org_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement_requests" ADD CONSTRAINT "reimbursement_requests_pay_period_id_pay_periods_id_fk" FOREIGN KEY ("pay_period_id") REFERENCES "public"."pay_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement_requests" ADD CONSTRAINT "reimbursement_requests_reviewed_by_org_memberships_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."org_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reimbursement_org_member_status_idx" ON "reimbursement_requests" USING btree ("organization_id","membership_id","status");
--> statement-breakpoint
CREATE FUNCTION guard_reimbursement_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE claim_state text;
BEGIN
  IF TG_TABLE_NAME = 'attachment_links' THEN
    IF NEW.entity_type = 'reimbursement' THEN
      SELECT status INTO claim_state FROM reimbursement_requests WHERE id = NEW.entity_id FOR UPDATE;
      IF claim_state IS NULL OR claim_state <> 'draft' THEN
        RAISE EXCEPTION 'Reimbursement evidence is frozen' USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSE
    FOR claim_state IN
      SELECT r.status FROM reimbursement_requests r
      JOIN attachment_links l ON l.entity_id = r.id AND l.entity_type = 'reimbursement'
      WHERE l.attachment_id = OLD.id FOR UPDATE OF r
    LOOP
      IF claim_state <> 'draft' THEN
        RAISE EXCEPTION 'Reimbursement evidence is frozen' USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER reimbursement_evidence_link_guard BEFORE INSERT OR UPDATE ON attachment_links
FOR EACH ROW EXECUTE FUNCTION guard_reimbursement_evidence();
--> statement-breakpoint
CREATE TRIGGER reimbursement_evidence_update_guard BEFORE UPDATE ON attachments
FOR EACH ROW EXECUTE FUNCTION guard_reimbursement_evidence();
