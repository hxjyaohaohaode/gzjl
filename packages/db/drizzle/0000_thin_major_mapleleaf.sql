CREATE TYPE "public"."access_role_kind" AS ENUM('owner', 'manager', 'member', 'custom');--> statement-breakpoint
CREATE TYPE "public"."credential_kind" AS ENUM('email', 'phone');--> statement-breakpoint
CREATE TYPE "public"."identity_source" AS ENUM('organization', 'self_declared');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('invited', 'active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."scope_kind" AS ENUM('organization', 'org_unit', 'project', 'self');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."progress_mode" AS ENUM('manual', 'weighted_children', 'milestone_based');--> statement-breakpoint
CREATE TYPE "public"."project_activity_type" AS ENUM('created', 'updated', 'moved', 'branched', 'merged', 'archived', 'deleted', 'restored', 'rolled_back');--> statement-breakpoint
CREATE TYPE "public"."project_edge_type" AS ENUM('depends_on', 'blocks', 'relates_to', 'replaces', 'merges_into');--> statement-breakpoint
CREATE TYPE "public"."project_member_role" AS ENUM('lead', 'member', 'observer');--> statement-breakpoint
CREATE TYPE "public"."project_node_status" AS ENUM('not_started', 'in_progress', 'blocked', 'in_review', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."project_node_type" AS ENUM('phase', 'milestone', 'task', 'deliverable', 'decision');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('planned', 'active', 'paused', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('not_requested', 'pending_review', 'approved', 'returned', 'locked');--> statement-breakpoint
CREATE TYPE "public"."correction_status" AS ENUM('pending', 'approved', 'rejected', 'applied_next_period');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('draft', 'submitted');--> statement-breakpoint
CREATE TYPE "public"."timer_status" AS ENUM('running', 'paused', 'on_break', 'stopped');--> statement-breakpoint
CREATE TYPE "public"."work_session_source" AS ENUM('manual', 'timer', 'import');--> statement-breakpoint
CREATE TYPE "public"."work_visibility" AS ENUM('private', 'management_only', 'project_visible');--> statement-breakpoint
CREATE TYPE "public"."attachment_kind" AS ENUM('file', 'url', 'text');--> statement-breakpoint
CREATE TYPE "public"."attachment_status" AS ENUM('pending_upload', 'available', 'upload_failed', 'quarantined', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."attachment_visibility" AS ENUM('private', 'management_only', 'project_visible');--> statement-breakpoint
CREATE TYPE "public"."approval_action" AS ENUM('submitted', 'approved', 'returned', 'cancelled', 'management_corrected', 'commented');--> statement-breakpoint
CREATE TYPE "public"."approval_request_status" AS ENUM('pending', 'approved', 'returned', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."compensation_type" AS ENUM('hourly', 'daily', 'monthly', 'fixed_period', 'project_based', 'hybrid');--> statement-breakpoint
CREATE TYPE "public"."pay_period_status" AS ENUM('open', 'calculating', 'pending_confirmation', 'settled', 'locked');--> statement-breakpoint
CREATE TYPE "public"."payroll_component_type" AS ENUM('base', 'weekday', 'weekend', 'holiday', 'night', 'overtime', 'project', 'allowance', 'bonus', 'deduction', 'rounding', 'correction');--> statement-breakpoint
CREATE TYPE "public"."payroll_run_status" AS ENUM('queued', 'calculating', 'review_required', 'ready', 'settled', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."rate_rule_type" AS ENUM('weekday', 'weekend', 'holiday', 'night_window', 'overtime', 'allowance', 'bonus', 'deduction', 'rounding', 'minimum_billable_unit');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('uploaded', 'validating', 'preview_ready', 'confirmed', 'importing', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'web_push', 'email', 'sms');--> statement-breakpoint
CREATE TYPE "public"."notification_severity" AS ENUM('info', 'warning', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."transfer_format" AS ENUM('csv', 'xlsx', 'pdf', 'json');--> statement-breakpoint
CREATE TABLE "access_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "access_role_kind" DEFAULT 'custom' NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"requested_name" text NOT NULL,
	"requested_identity_id" uuid,
	"action" text NOT NULL,
	"reason" text,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"source" "identity_source" NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"scope_kind" "scope_kind" NOT NULL,
	"scope_id" uuid,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "org_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"org_unit_id" uuid,
	"status" "membership_status" DEFAULT 'invited' NOT NULL,
	"position_title" text,
	"joined_at" timestamp with time zone,
	"left_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"leader_membership_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_owners" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"membership_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Shanghai' NOT NULL,
	"payroll_cutoff_day" integer DEFAULT 10 NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_payroll_cutoff_day_check" CHECK ("organizations"."payroll_cutoff_day" between 1 and 28)
);
--> statement-breakpoint
CREATE TABLE "ownership_transfer_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"from_membership_id" uuid NOT NULL,
	"to_membership_id" uuid NOT NULL,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"code" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"sensitivity" text DEFAULT 'normal' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "professional_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"description" text,
	"is_custom" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"permission_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"csrf_secret_hash" text NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "credential_kind" NOT NULL,
	"normalized_identifier" text NOT NULL,
	"password_hash" text NOT NULL,
	"verified_at" timestamp with time zone,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"locale" text DEFAULT 'zh-CN' NOT NULL,
	"timezone" text DEFAULT 'Asia/Shanghai' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credential_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"activity_type" "project_activity_type" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity_version" integer,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_branch_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"change_summary" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"parent_branch_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"source_node_id" uuid,
	"is_default" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"merged_into_branch_id" uuid,
	"merged_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"source_node_id" uuid NOT NULL,
	"target_node_id" uuid NOT NULL,
	"type" "project_edge_type" NOT NULL,
	"label" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "project_edges_distinct_nodes_check" CHECK ("project_edges"."source_node_id" <> "project_edges"."target_node_id")
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"role" "project_member_role" DEFAULT 'member' NOT NULL,
	"public_activity_visible" boolean DEFAULT true NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "project_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"node_id" uuid,
	"title" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_node_assignees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"is_responsible" boolean DEFAULT false NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_node_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"change_summary" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"parent_id" uuid,
	"type" "project_node_type" DEFAULT 'task' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "project_node_status" DEFAULT 'not_started' NOT NULL,
	"progress" numeric(5, 2) DEFAULT '0' NOT NULL,
	"progress_mode" "progress_mode" DEFAULT 'manual' NOT NULL,
	"weight" numeric(12, 4) DEFAULT '1' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"start_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_nodes_progress_check" CHECK ("project_nodes"."progress" between 0 and 100),
	CONSTRAINT "project_nodes_weight_check" CHECK ("project_nodes"."weight" >= 0)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT '#3468f5' NOT NULL,
	"status" "project_status" DEFAULT 'planned' NOT NULL,
	"visibility" text DEFAULT 'members' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"start_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recycle_bin_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"deleted_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"restore_until" timestamp with time zone,
	"restored_by" uuid,
	"restored_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "timer_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timer_state_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timer_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"work_session_id" uuid,
	"status" timer_status NOT NULL,
	"is_primary" boolean DEFAULT true NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"state_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accumulated_seconds" bigint DEFAULT 0 NOT NULL,
	"client_event_cursor" text,
	"version" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stopped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_breaks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_session_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_breaks_time_order_check" CHECK ("work_breaks"."end_at" > "work_breaks"."start_at")
);
--> statement-breakpoint
CREATE TABLE "work_expectation_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"timezone" text NOT NULL,
	"reference_windows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_seconds_per_week" bigint,
	"manual_entry_lookback_days" integer DEFAULT 7 NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_expectation_profiles_lookback_check" CHECK ("work_expectation_profiles"."manual_entry_lookback_days" between 0 and 365)
);
--> statement-breakpoint
CREATE TABLE "work_session_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_session_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"base_version" integer NOT NULL,
	"proposed_snapshot" jsonb NOT NULL,
	"reason" text NOT NULL,
	"status" "correction_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_session_project_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_session_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"project_node_id" uuid NOT NULL,
	"project_branch_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"allocation_basis_points" integer DEFAULT 10000 NOT NULL,
	CONSTRAINT "work_session_project_links_allocation_check" CHECK ("work_session_project_links"."allocation_basis_points" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "work_session_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_session_id" uuid NOT NULL,
	"tag" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_session_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_session_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"change_reason" text,
	"changed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"gross_seconds" bigint NOT NULL,
	"break_seconds" bigint DEFAULT 0 NOT NULL,
	"net_seconds" bigint NOT NULL,
	"billable_seconds" bigint,
	"source" "work_session_source" NOT NULL,
	"content" text NOT NULL,
	"result" text DEFAULT '' NOT NULL,
	"blockers" text DEFAULT '' NOT NULL,
	"next_step" text DEFAULT '' NOT NULL,
	"primary_project_node_id" uuid,
	"work_type_id" uuid,
	"visibility" "work_visibility" DEFAULT 'management_only' NOT NULL,
	"parallel_work" boolean DEFAULT false NOT NULL,
	"submission_status" "submission_status" DEFAULT 'draft' NOT NULL,
	"approval_status" "approval_status" DEFAULT 'not_requested' NOT NULL,
	"anomaly_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "work_sessions_time_order_check" CHECK ("work_sessions"."end_at" > "work_sessions"."start_at"),
	CONSTRAINT "work_sessions_gross_nonnegative_check" CHECK ("work_sessions"."gross_seconds" > 0),
	CONSTRAINT "work_sessions_duration_consistency_check" CHECK ("work_sessions"."net_seconds" = "work_sessions"."gross_seconds" - "work_sessions"."break_seconds"),
	CONSTRAINT "work_sessions_break_bounds_check" CHECK ("work_sessions"."break_seconds" >= 0 and "work_sessions"."break_seconds" < "work_sessions"."gross_seconds")
);
--> statement-breakpoint
CREATE TABLE "work_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#3468f5' NOT NULL,
	"description" text,
	"billable_by_default" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachment_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attachment_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachment_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attachment_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"object_key" text,
	"sha256" text,
	"replaced_by" uuid NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"kind" "attachment_kind" NOT NULL,
	"status" "attachment_status" DEFAULT 'pending_upload' NOT NULL,
	"original_name" text,
	"object_key" text,
	"external_url" text,
	"text_content" text,
	"mime_type" text,
	"size_bytes" bigint,
	"sha256" text,
	"visibility" "attachment_visibility" DEFAULT 'management_only' NOT NULL,
	"note" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"approval_request_id" uuid NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"action" "approval_action" NOT NULL,
	"reason" text,
	"before_snapshot" jsonb,
	"after_snapshot" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"rule_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity_version" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"assigned_reviewer_id" uuid,
	"status" "approval_request_status" DEFAULT 'pending' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"anomaly_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "approval_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"entity_type" text NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reviewer_scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compensation_plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"compensation_plan_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"type" "compensation_type" NOT NULL,
	"base_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"base_unit" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pending_review_counts_in_estimate" boolean DEFAULT true NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compensation_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "compensation_type" NOT NULL,
	"currency" text DEFAULT 'CNY' NOT NULL,
	"active_version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"cutoff_at" timestamp with time zone NOT NULL,
	"status" "pay_period_status" DEFAULT 'open' NOT NULL,
	"settled_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_periods_time_order_check" CHECK ("pay_periods"."ends_at" > "pay_periods"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "payroll_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"pay_period_id" uuid NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"currency" text NOT NULL,
	"reason" text NOT NULL,
	"source_entity_type" text,
	"source_entity_id" uuid,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_item_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_item_id" uuid NOT NULL,
	"type" "payroll_component_type" NOT NULL,
	"label" text NOT NULL,
	"source_entity_type" text,
	"source_entity_id" uuid,
	"source_version" text,
	"quantity" numeric(20, 6),
	"unit" text,
	"rate" numeric(20, 6),
	"multiplier" numeric(12, 6),
	"amount" numeric(20, 6) NOT NULL,
	"calculation_trace" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_run_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"compensation_plan_version_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"approved_seconds" bigint DEFAULT 0 NOT NULL,
	"pending_seconds" bigint DEFAULT 0 NOT NULL,
	"gross_amount" numeric(20, 6) NOT NULL,
	"adjustment_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"final_amount" numeric(20, 6) NOT NULL,
	"estimate" boolean DEFAULT false NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_items_amount_consistency_check" CHECK ("payroll_items"."final_amount" = "payroll_items"."gross_amount" + "payroll_items"."adjustment_amount")
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pay_period_id" uuid NOT NULL,
	"run_number" integer NOT NULL,
	"status" "payroll_run_status" DEFAULT 'queued' NOT NULL,
	"calculation_version" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"error_summary" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_run_id" uuid NOT NULL,
	"snapshot_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_item_id" uuid NOT NULL,
	"document_attachment_id" uuid,
	"document_hash" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rate_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"compensation_plan_version_id" uuid NOT NULL,
	"type" "rate_rule_type" NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"calculation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"scope" jsonb NOT NULL,
	"task_type" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_template_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"source_summary" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"error_summary" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_report_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ai_report_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity_version" text,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ai_job_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"structured_output" jsonb NOT NULL,
	"source_count" integer NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_membership_id" uuid,
	"actor_type" text DEFAULT 'user' NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"request_id" text,
	"ip_hash" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"format" "transfer_format" NOT NULL,
	"export_type" text NOT NULL,
	"scope" jsonb NOT NULL,
	"field_policy_snapshot" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"object_key" text,
	"sha256" text,
	"error_summary" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"import_type" text NOT NULL,
	"source_object_key" text NOT NULL,
	"source_hash" text NOT NULL,
	"status" "import_status" DEFAULT 'uploaded' NOT NULL,
	"validation_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confirmed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"category" text NOT NULL,
	"in_app_enabled" boolean DEFAULT true NOT NULL,
	"push_enabled" boolean DEFAULT false NOT NULL,
	"email_enabled" boolean DEFAULT false NOT NULL,
	"quiet_hours" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"muted_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"recipient_membership_id" uuid NOT NULL,
	"reminder_rule_id" uuid,
	"category" text NOT NULL,
	"severity" "notification_severity" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"action_url" text,
	"dedupe_key" text NOT NULL,
	"valid_until" timestamp with time zone,
	"read_at" timestamp with time zone,
	"handled_at" timestamp with time zone,
	"ignored_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity_version" integer NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempt" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"endpoint_hash" text NOT NULL,
	"endpoint_ciphertext" text NOT NULL,
	"p256dh_ciphertext" text NOT NULL,
	"auth_ciphertext" text NOT NULL,
	"user_agent" text,
	"last_success_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"severity" "notification_severity" DEFAULT 'info' NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cooldown_seconds" integer DEFAULT 3600 NOT NULL,
	"channels" jsonb DEFAULT '["in_app"]'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_membership_id" uuid NOT NULL,
	"page" text NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb NOT NULL,
	"layout" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_roles" ADD CONSTRAINT "access_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_change_requests" ADD CONSTRAINT "identity_change_requests_membership_id_org_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_change_requests" ADD CONSTRAINT "identity_change_requests_requested_identity_id_professional_identities_id_fk" FOREIGN KEY ("requested_identity_id") REFERENCES "public"."professional_identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_change_requests" ADD CONSTRAINT "identity_change_requests_reviewed_by_org_memberships_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."org_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_identities" ADD CONSTRAINT "member_identities_membership_id_org_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_identities" ADD CONSTRAINT "member_identities_identity_id_professional_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."professional_identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_membership_id_org_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_role_id_access_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."access_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_granted_by_org_memberships_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."org_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_parent_id_org_units_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."org_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_owners" ADD CONSTRAINT "organization_owners_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_owners" ADD CONSTRAINT "organization_owners_membership_id_org_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_transfer_events" ADD CONSTRAINT "ownership_transfer_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_transfer_events" ADD CONSTRAINT "ownership_transfer_events_from_membership_id_org_memberships_id_fk" FOREIGN KEY ("from_membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_transfer_events" ADD CONSTRAINT "ownership_transfer_events_to_membership_id_org_memberships_id_fk" FOREIGN KEY ("to_membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_identities" ADD CONSTRAINT "professional_identities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_access_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."access_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_code_permissions_code_fk" FOREIGN KEY ("permission_code") REFERENCES "public"."permissions"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_credential_id_user_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."user_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_activity_log" ADD CONSTRAINT "project_activity_log_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_activity_log" ADD CONSTRAINT "project_activity_log_actor_membership_id_org_memberships_id_fk" FOREIGN KEY ("actor_membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_branch_versions" ADD CONSTRAINT "project_branch_versions_branch_id_project_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."project_branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_branch_versions" ADD CONSTRAINT "project_branch_versions_created_by_org_memberships_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_branches" ADD CONSTRAINT "project_branches_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_branches" ADD CONSTRAINT "project_branches_parent_branch_id_project_branches_id_fk" FOREIGN KEY ("parent_branch_id") REFERENCES "public"."project_branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_branches" ADD CONSTRAINT "project_branches_created_by_org_memberships_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_branches" ADD CONSTRAINT "project_branches_merged_into_branch_id_project_branches_id_fk" FOREIGN KEY ("merged_into_branch_id") REFERENCES "public"."project_branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_edges" ADD CONSTRAINT "project_edges_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_edges" ADD CONSTRAINT "project_edges_source_node_id_project_nodes_id_fk" FOREIGN KEY ("source_node_id") REFERENCES "public"."project_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_edges" ADD CONSTRAINT "project_edges_target_node_id_project_nodes_id_fk" FOREIGN KEY ("target_node_id") REFERENCES "public"."project_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_edges" ADD CONSTRAINT "project_edges_created_by_org_memberships_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_membership_id_org_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_node_id_project_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."project_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_node_assignees" ADD CONSTRAINT "project_node_assignees_node_id_project_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."project_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_node_assignees" ADD CONSTRAINT "project_node_assignees_membership_id_org_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_node_versions" ADD CONSTRAINT "project_node_versions_node_id_project_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."project_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_node_versions" ADD CONSTRAINT "project_node_versions_created_by_org_memberships_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_nodes" ADD CONSTRAINT "project_nodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_nodes" ADD CONSTRAINT "project_nodes_branch_id_project_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."project_branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_nodes" ADD CONSTRAINT "project_nodes_parent_id_project_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."project_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_nodes" ADD CONSTRAINT "project_nodes_created_by_org_memberships_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_org_memberships_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recycle_bin_entries" ADD CONSTRAINT "recycle_bin_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recycle_bin_entries" ADD CONSTRAINT "recycle_bin_entries_deleted_by_org_memberships_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recycle_bin_entries" ADD CONSTRAINT "recycle_bin_entries_restored_by_org_memberships_id_fk" FOREIGN KEY ("restored_by") REFERENCES "public"."org_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timer_events" ADD CONSTRAINT "timer_events_timer_state_id_timer_states_id_fk" FOREIGN KEY ("timer_state_id") REFERENCES "public"."timer_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timer_states" ADD CONSTRAINT "timer_states_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timer_states" ADD CONSTRAINT "timer_states_membership_id_org_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timer_states" ADD CONSTRAINT "timer_states_work_session_id_work_sessions_id_fk" FOREIGN KEY ("work_session_id") REFERENCES "public"."work_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_breaks" ADD CONSTRAINT "work_breaks_work_session_id_work_sessions_id_fk" FOREIGN KEY ("work_session_id") REFERENCES "public"."work_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_expectation_profiles" ADD CONSTRAINT "work_expectation_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_expectation_profiles" ADD CONSTRAINT "work_expectation_profiles_membership_id_org_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_expectation_profiles" ADD CONSTRAINT "work_expectation_profiles_created_by_org_memberships_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_session_corrections" ADD CONSTRAINT "work_session_corrections_work_session_id_work_sessions_id_fk" FOREIGN KEY ("work_session_id") REFERENCES "public"."work_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_session_corrections" ADD CONSTRAINT "work_session_corrections_requested_by_org_memberships_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_session_corrections" ADD CONSTRAINT "work_session_corrections_reviewed_by_org_memberships_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."org_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_session_project_links" ADD CONSTRAINT "work_session_project_links_work_session_id_work_sessions_id_fk" FOREIGN KEY ("work_session_id") REFERENCES "public"."work_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_session_project_links" ADD CONSTRAINT "work_session_project_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_session_project_links" ADD CONSTRAINT "work_session_project_links_project_node_id_project_nodes_id_fk" FOREIGN KEY ("project_node_id") REFERENCES "public"."project_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_session_project_links" ADD CONSTRAINT "work_session_project_links_project_branch_id_project_branches_id_fk" FOREIGN KEY ("project_branch_id") REFERENCES "public"."project_branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_session_tags" ADD CONSTRAINT "work_session_tags_work_session_id_work_sessions_id_fk" FOREIGN KEY ("work_session_id") REFERENCES "public"."work_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_session_versions" ADD CONSTRAINT "work_session_versions_work_session_id_work_sessions_id_fk" FOREIGN KEY ("work_session_id") REFERENCES "public"."work_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_session_versions" ADD CONSTRAINT "work_session_versions_changed_by_org_memberships_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_membership_id_org_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_primary_project_node_id_project_nodes_id_fk" FOREIGN KEY ("primary_project_node_id") REFERENCES "public"."project_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_work_type_id_work_types_id_fk" FOREIGN KEY ("work_type_id") REFERENCES "public"."work_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_types" ADD CONSTRAINT "work_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_links" ADD CONSTRAINT "attachment_links_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_links" ADD CONSTRAINT "attachment_links_created_by_org_memberships_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_versions" ADD CONSTRAINT "attachment_versions_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_versions" ADD CONSTRAINT "attachment_versions_replaced_by_org_memberships_id_fk" FOREIGN KEY ("replaced_by") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_org_memberships_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_actor_membership_id_org_memberships_id_fk" FOREIGN KEY ("actor_membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_rule_id_approval_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."approval_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_org_memberships_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_assigned_reviewer_id_org_memberships_id_fk" FOREIGN KEY ("assigned_reviewer_id") REFERENCES "public"."org_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_created_by_org_memberships_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_plan_versions" ADD CONSTRAINT "compensation_plan_versions_compensation_plan_id_compensation_plans_id_fk" FOREIGN KEY ("compensation_plan_id") REFERENCES "public"."compensation_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_plan_versions" ADD CONSTRAINT "compensation_plan_versions_created_by_org_memberships_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_plans" ADD CONSTRAINT "compensation_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_plans" ADD CONSTRAINT "compensation_plans_membership_id_org_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_plans" ADD CONSTRAINT "compensation_plans_created_by_org_memberships_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_periods" ADD CONSTRAINT "pay_periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_membership_id_org_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_pay_period_id_pay_periods_id_fk" FOREIGN KEY ("pay_period_id") REFERENCES "public"."pay_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_created_by_org_memberships_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_approved_by_org_memberships_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."org_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_item_components" ADD CONSTRAINT "payroll_item_components_payroll_item_id_payroll_items_id_fk" FOREIGN KEY ("payroll_item_id") REFERENCES "public"."payroll_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_membership_id_org_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_compensation_plan_version_id_compensation_plan_versions_id_fk" FOREIGN KEY ("compensation_plan_version_id") REFERENCES "public"."compensation_plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_pay_period_id_pay_periods_id_fk" FOREIGN KEY ("pay_period_id") REFERENCES "public"."pay_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_requested_by_org_memberships_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_snapshots" ADD CONSTRAINT "payroll_snapshots_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_payroll_item_id_payroll_items_id_fk" FOREIGN KEY ("payroll_item_id") REFERENCES "public"."payroll_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_rules" ADD CONSTRAINT "rate_rules_compensation_plan_version_id_compensation_plan_versions_id_fk" FOREIGN KEY ("compensation_plan_version_id") REFERENCES "public"."compensation_plan_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_requested_by_org_memberships_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_report_sources" ADD CONSTRAINT "ai_report_sources_ai_report_id_ai_reports_id_fk" FOREIGN KEY ("ai_report_id") REFERENCES "public"."ai_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_reports" ADD CONSTRAINT "ai_reports_ai_job_id_ai_jobs_id_fk" FOREIGN KEY ("ai_job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_membership_id_org_memberships_id_fk" FOREIGN KEY ("actor_membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_requested_by_org_memberships_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_requested_by_org_memberships_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_membership_id_org_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_membership_id_org_memberships_id_fk" FOREIGN KEY ("recipient_membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_reminder_rule_id_reminder_rules_id_fk" FOREIGN KEY ("reminder_rule_id") REFERENCES "public"."reminder_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_membership_id_org_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_rules" ADD CONSTRAINT "reminder_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_rules" ADD CONSTRAINT "reminder_rules_created_by_org_memberships_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_owner_membership_id_org_memberships_id_fk" FOREIGN KEY ("owner_membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_roles_org_name_uidx" ON "access_roles" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "identity_change_requests_status_idx" ON "identity_change_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "member_identities_member_identity_uidx" ON "member_identities" USING btree ("membership_id","identity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_roles_grant_uidx" ON "member_roles" USING btree ("membership_id","role_id","scope_kind","scope_id");--> statement-breakpoint
CREATE INDEX "member_roles_membership_idx" ON "member_roles" USING btree ("membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_memberships_org_user_uidx" ON "org_memberships" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "org_memberships_user_idx" ON "org_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_units_org_parent_name_uidx" ON "org_units" USING btree ("organization_id","parent_id","name");--> statement-breakpoint
CREATE INDEX "org_units_org_parent_idx" ON "org_units" USING btree ("organization_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_owners_membership_uidx" ON "organization_owners" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "ownership_transfer_events_org_status_idx" ON "ownership_transfer_events" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "professional_identities_org_name_uidx" ON "professional_identities" USING btree ("organization_id","normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_role_code_uidx" ON "role_permissions" USING btree ("role_id","permission_code");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uidx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_active_idx" ON "sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_credentials_identifier_uidx" ON "user_credentials" USING btree ("normalized_identifier");--> statement-breakpoint
CREATE INDEX "user_credentials_user_idx" ON "user_credentials" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_tokens_hash_uidx" ON "verification_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "verification_tokens_credential_idx" ON "verification_tokens" USING btree ("credential_id","purpose");--> statement-breakpoint
CREATE INDEX "project_activity_log_project_created_idx" ON "project_activity_log" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_branch_versions_branch_version_uidx" ON "project_branch_versions" USING btree ("branch_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "project_branches_project_name_uidx" ON "project_branches" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "project_branches_project_idx" ON "project_branches" USING btree ("project_id","archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_edges_unique_uidx" ON "project_edges" USING btree ("source_node_id","target_node_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_project_member_uidx" ON "project_members" USING btree ("project_id","membership_id");--> statement-breakpoint
CREATE INDEX "project_members_membership_idx" ON "project_members" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "project_milestones_project_due_idx" ON "project_milestones" USING btree ("project_id","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_node_assignees_node_member_uidx" ON "project_node_assignees" USING btree ("node_id","membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_node_versions_node_version_uidx" ON "project_node_versions" USING btree ("node_id","version");--> statement-breakpoint
CREATE INDEX "project_nodes_branch_parent_idx" ON "project_nodes" USING btree ("branch_id","parent_id");--> statement-breakpoint
CREATE INDEX "project_nodes_project_status_idx" ON "project_nodes" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_org_key_uidx" ON "projects" USING btree ("organization_id","key");--> statement-breakpoint
CREATE INDEX "projects_org_status_idx" ON "projects" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "recycle_bin_entity_uidx" ON "recycle_bin_entries" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "recycle_bin_org_deleted_idx" ON "recycle_bin_entries" USING btree ("organization_id","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "timer_events_state_event_uidx" ON "timer_events" USING btree ("timer_state_id","event_id");--> statement-breakpoint
CREATE INDEX "timer_events_state_occurred_idx" ON "timer_events" USING btree ("timer_state_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "timer_states_one_primary_active_uidx" ON "timer_states" USING btree ("membership_id") WHERE "timer_states"."is_primary" = true and "timer_states"."status" in ('running', 'paused', 'on_break');--> statement-breakpoint
CREATE INDEX "timer_states_member_idx" ON "timer_states" USING btree ("membership_id","updated_at");--> statement-breakpoint
CREATE INDEX "work_breaks_session_start_idx" ON "work_breaks" USING btree ("work_session_id","start_at");--> statement-breakpoint
CREATE INDEX "work_expectation_profiles_member_effective_idx" ON "work_expectation_profiles" USING btree ("membership_id","effective_from");--> statement-breakpoint
CREATE INDEX "work_session_corrections_status_idx" ON "work_session_corrections" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "work_session_project_links_session_node_uidx" ON "work_session_project_links" USING btree ("work_session_id","project_node_id");--> statement-breakpoint
CREATE INDEX "work_session_project_links_node_idx" ON "work_session_project_links" USING btree ("project_node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_session_tags_session_tag_uidx" ON "work_session_tags" USING btree ("work_session_id","tag");--> statement-breakpoint
CREATE UNIQUE INDEX "work_session_versions_session_version_uidx" ON "work_session_versions" USING btree ("work_session_id","version");--> statement-breakpoint
CREATE INDEX "work_sessions_member_start_idx" ON "work_sessions" USING btree ("membership_id","start_at");--> statement-breakpoint
CREATE INDEX "work_sessions_org_approval_idx" ON "work_sessions" USING btree ("organization_id","approval_status");--> statement-breakpoint
CREATE INDEX "work_sessions_primary_node_idx" ON "work_sessions" USING btree ("primary_project_node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_types_org_name_uidx" ON "work_types" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_links_attachment_entity_uidx" ON "attachment_links" USING btree ("attachment_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "attachment_links_entity_idx" ON "attachment_links" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_versions_attachment_version_uidx" ON "attachment_versions" USING btree ("attachment_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_object_key_uidx" ON "attachments" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "attachments_org_status_idx" ON "attachments" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "attachments_uploaded_by_idx" ON "attachments" USING btree ("uploaded_by","uploaded_at");--> statement-breakpoint
CREATE INDEX "approval_actions_request_created_idx" ON "approval_actions" USING btree ("approval_request_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_entity_version_uidx" ON "approval_requests" USING btree ("entity_type","entity_id","entity_version");--> statement-breakpoint
CREATE INDEX "approval_requests_org_status_priority_idx" ON "approval_requests" USING btree ("organization_id","status","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_rules_org_name_uidx" ON "approval_rules" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "compensation_plan_versions_plan_version_uidx" ON "compensation_plan_versions" USING btree ("compensation_plan_id","version");--> statement-breakpoint
CREATE INDEX "compensation_plan_versions_effective_idx" ON "compensation_plan_versions" USING btree ("compensation_plan_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "compensation_plans_member_name_uidx" ON "compensation_plans" USING btree ("membership_id","name");--> statement-breakpoint
CREATE INDEX "compensation_plans_org_member_idx" ON "compensation_plans" USING btree ("organization_id","membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_periods_org_range_uidx" ON "pay_periods" USING btree ("organization_id","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "pay_periods_org_status_idx" ON "pay_periods" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "payroll_adjustments_period_member_idx" ON "payroll_adjustments" USING btree ("pay_period_id","membership_id");--> statement-breakpoint
CREATE INDEX "payroll_item_components_item_idx" ON "payroll_item_components" USING btree ("payroll_item_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_items_run_member_uidx" ON "payroll_items" USING btree ("payroll_run_id","membership_id");--> statement-breakpoint
CREATE INDEX "payroll_items_member_idx" ON "payroll_items" USING btree ("membership_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_period_number_uidx" ON "payroll_runs" USING btree ("pay_period_id","run_number");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_period_input_hash_uidx" ON "payroll_runs" USING btree ("pay_period_id","input_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_snapshots_run_uidx" ON "payroll_snapshots" USING btree ("payroll_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payslips_item_uidx" ON "payslips" USING btree ("payroll_item_id");--> statement-breakpoint
CREATE INDEX "rate_rules_plan_priority_idx" ON "rate_rules" USING btree ("compensation_plan_version_id","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_jobs_scope_input_uidx" ON "ai_jobs" USING btree ("organization_id","task_type","input_hash");--> statement-breakpoint
CREATE INDEX "ai_jobs_status_queued_idx" ON "ai_jobs" USING btree ("status","queued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_report_sources_report_entity_uidx" ON "ai_report_sources" USING btree ("ai_report_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_reports_job_uidx" ON "ai_reports" USING btree ("ai_job_id");--> statement-breakpoint
CREATE INDEX "audit_logs_org_created_idx" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "exports_requester_status_idx" ON "exports" USING btree ("requested_by","status");--> statement-breakpoint
CREATE UNIQUE INDEX "imports_org_source_hash_uidx" ON "imports" USING btree ("organization_id","source_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_member_category_uidx" ON "notification_preferences" USING btree ("membership_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_recipient_dedupe_uidx" ON "notifications" USING btree ("recipient_membership_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_recipient_unread_idx" ON "notifications" USING btree ("recipient_membership_id","read_at");--> statement-breakpoint
CREATE INDEX "outbox_events_unpublished_idx" ON "outbox_events" USING btree ("published_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_uidx" ON "push_subscriptions" USING btree ("endpoint_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_rules_org_category_name_uidx" ON "reminder_rules" USING btree ("organization_id","category","name");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_views_owner_page_name_uidx" ON "saved_views" USING btree ("owner_membership_id","page","name");