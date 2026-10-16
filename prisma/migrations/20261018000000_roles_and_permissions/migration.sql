-- custom_roles becomes the general roles table: system roles live here too.
ALTER TABLE "custom_roles" RENAME TO "roles";
ALTER TABLE "roles" RENAME CONSTRAINT "custom_roles_pkey" TO "roles_pkey";
ALTER INDEX "custom_roles_normalized_name_key" RENAME TO "roles_normalized_name_key";
ALTER TABLE "roles" ADD COLUMN "system" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "permissions" (
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "permissions_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "role_permissions" (
    "role_key" TEXT NOT NULL,
    "permission_key" TEXT NOT NULL,
    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_key", "permission_key")
);

CREATE INDEX "role_permissions_permission_key_idx" ON "role_permissions"("permission_key");

ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_key_fkey" FOREIGN KEY ("role_key") REFERENCES "roles"("key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "permissions"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: generated from src/lib/permissions.ts; `pnpm db:seed` keeps it in sync afterwards.
INSERT INTO "permissions" ("key", "description", "restricted") VALUES
  ('dashboard:read', 'View the administration overview', false),
  ('users:read', 'List user profiles and assigned roles', false),
  ('users:update', 'Change user names and account status', false),
  ('roles:read', 'View roles and their permissions', false),
  ('roles:update', 'Create, edit and delete roles (owner only)', true),
  ('roles:assign', 'Assign and remove user roles (owner only)', true),
  ('permissions:read', 'View the permission catalog', false),
  ('audit:read', 'View security and administrative audit events', false),
  ('providers:read', 'View ML providers (owner only)', true),
  ('providers:manage', 'Manage ML providers (owner only)', true),
  ('user:create', 'Create users from the administration UI', false),
  ('user:list', 'List users', false),
  ('user:get', 'Open a user inspector', false),
  ('user:update', 'Change user profile fields', false),
  ('user:set-role', 'Change a user role (owner only)', true),
  ('user:set-password', 'Set a user password', false),
  ('user:set-email', 'Change a user email address', false),
  ('user:ban', 'Ban and unban users', false),
  ('user:delete', 'Delete users (owner only)', true),
  ('user:impersonate', 'Sign in as another user', false),
  ('user:impersonate-admins', 'Impersonate another administrator (owner only)', true),
  ('session:list', 'View a user session list', false),
  ('session:revoke', 'Revoke a user session', false),
  ('session:delete', 'Delete a user session', false);

-- Existing custom role grants move from the JSON column into the join; owner-only and unknown
-- keys were never grantable and are dropped.
INSERT INTO "role_permissions" ("role_key", "permission_key")
SELECT DISTINCT r."key", p."key"
FROM "roles" r
CROSS JOIN LATERAL jsonb_array_elements_text(r."permissions") AS grant_key(value)
JOIN "permissions" p ON p."key" = grant_key.value AND NOT p."restricted"
WHERE NOT r."system";

ALTER TABLE "roles" DROP COLUMN "permissions";

-- System roles and their default grants (Owner and User stay pinned to code at runtime).
INSERT INTO "roles" ("key", "name", "normalized_name", "description", "system", "updated_at") VALUES
  ('user', 'User', 'user', 'Signed-in account with no administrative access.', true, CURRENT_TIMESTAMP),
  ('viewer', 'Viewer', 'viewer', 'Read-only access to administration screens.', true, CURRENT_TIMESTAMP),
  ('administrator', 'Administrator', 'administrator', 'Manage accounts and sessions. Cannot assign roles, delete users, or impersonate anyone.', true, CURRENT_TIMESTAMP),
  ('owner', 'Owner', 'owner', 'Full administration, including role assignment and user removal.', true, CURRENT_TIMESTAMP);

INSERT INTO "role_permissions" ("role_key", "permission_key") VALUES
  ('viewer', 'user:list'),
  ('viewer', 'user:get'),
  ('viewer', 'dashboard:read'),
  ('viewer', 'users:read'),
  ('viewer', 'roles:read'),
  ('viewer', 'permissions:read'),
  ('viewer', 'audit:read'),
  ('administrator', 'user:create'),
  ('administrator', 'user:list'),
  ('administrator', 'user:get'),
  ('administrator', 'user:update'),
  ('administrator', 'user:ban'),
  ('administrator', 'user:set-password'),
  ('administrator', 'user:set-email'),
  ('administrator', 'session:list'),
  ('administrator', 'session:revoke'),
  ('administrator', 'dashboard:read'),
  ('administrator', 'users:read'),
  ('administrator', 'users:update'),
  ('administrator', 'roles:read'),
  ('administrator', 'permissions:read'),
  ('administrator', 'audit:read'),
  ('owner', 'providers:read'),
  ('owner', 'providers:manage'),
  ('owner', 'user:create'),
  ('owner', 'user:list'),
  ('owner', 'user:set-role'),
  ('owner', 'user:ban'),
  ('owner', 'user:impersonate'),
  ('owner', 'user:impersonate-admins'),
  ('owner', 'user:delete'),
  ('owner', 'user:set-password'),
  ('owner', 'user:set-email'),
  ('owner', 'user:get'),
  ('owner', 'user:update'),
  ('owner', 'session:list'),
  ('owner', 'session:revoke'),
  ('owner', 'session:delete'),
  ('owner', 'dashboard:read'),
  ('owner', 'users:read'),
  ('owner', 'users:update'),
  ('owner', 'roles:read'),
  ('owner', 'roles:update'),
  ('owner', 'roles:assign'),
  ('owner', 'permissions:read'),
  ('owner', 'audit:read');

-- Assignment and delete guards now read the renamed table; system roles can never be deleted.
CREATE OR REPLACE FUNCTION check_custom_role_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assigned_key text;
BEGIN
  FOR assigned_key IN SELECT btrim(value) FROM unnest(string_to_array(coalesce(NEW.role, ''), ',')) AS value LOOP
    IF left(assigned_key, 7) = 'custom_' THEN
      PERFORM 1 FROM roles WHERE key = assigned_key FOR KEY SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown custom role' USING ERRCODE = '23503';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION check_custom_role_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.system THEN
    RAISE EXCEPTION 'System roles cannot be deleted' USING ERRCODE = '23503';
  END IF;
  IF EXISTS (
    SELECT 1 FROM app_user
    WHERE OLD.key = ANY(string_to_array(replace(coalesce(role, ''), ' ', ''), ','))
  ) THEN
    RAISE EXCEPTION 'Role is assigned to users' USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;

ALTER TRIGGER custom_role_delete_check ON "roles" RENAME TO role_delete_check;
