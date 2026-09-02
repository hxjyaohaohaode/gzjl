CREATE TABLE "user_totp_factors" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"enabled_at" timestamp with time zone,
	"last_used_counter" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_totp_factors" ADD CONSTRAINT "user_totp_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "user_totp_factors_enabled_idx" ON "user_totp_factors" USING btree ("enabled_at");
