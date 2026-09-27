-- Better Auth admin plugin: code-declared roles on app_user, ban status, and
-- session impersonation. Replaces the roles/permissions join tables.
--
-- The backfill runs before the tables are dropped so existing assignments survive as
-- comma-separated role names on app_user.role. Names that are no longer declared in
-- src/lib/permissions.ts grant nothing after this migration (fail closed).

-- 1. New columns.
ALTER TABLE "app_user"
    ADD COLUMN "role" TEXT,
    ADD COLUMN "banned" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "ban_reason" TEXT,
    ADD COLUMN "ban_expires" TIMESTAMPTZ(6);

ALTER TABLE "session" ADD COLUMN "impersonated_by" TEXT;

-- 2. Backfill roles from the join tables, defaulting to the no-access role.
UPDATE "app_user" u
SET "role" = COALESCE(
    (
        SELECT string_agg(r."name", ',' ORDER BY r."name")
        FROM "user_roles" ur
        JOIN "roles" r ON r."id" = ur."role_id"
        WHERE ur."user_id" = u."id"
    ),
    'user'
);

-- 3. A disabled account becomes a ban.
UPDATE "app_user" SET "banned" = true WHERE "disabled" = true;

-- 4. Drop the normalised RBAC tables now that app_user.role is authoritative.
DROP TABLE "role_permissions";
DROP TABLE "user_roles";
DROP TABLE "permissions";
DROP TABLE "roles";

-- 5. The admin plugin owns account status through the ban fields.
ALTER TABLE "app_user" DROP COLUMN "disabled";
