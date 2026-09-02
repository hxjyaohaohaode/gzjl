INSERT INTO "permissions" ("code", "description", "sensitivity")
VALUES ('import.scope', 'import.scope', 'normal')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_code")
SELECT "id", 'import.scope'
FROM "access_roles"
WHERE "kind" = 'owner'
ON CONFLICT DO NOTHING;
