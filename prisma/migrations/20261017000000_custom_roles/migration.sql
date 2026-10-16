CREATE TABLE "custom_roles" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "custom_roles_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "custom_roles_normalized_name_key" ON "custom_roles"("normalized_name");
