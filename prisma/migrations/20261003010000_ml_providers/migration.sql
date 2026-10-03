CREATE TABLE "ml_connections" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "base_url" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "encrypted_credential" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "discovery_status" TEXT NOT NULL DEFAULT 'pending',
  "discovery_error" TEXT,
  "last_discovered_at" TIMESTAMPTZ(6),
  "next_discovery_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cooldown_until" TIMESTAMPTZ(6),
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "ml_connections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ml_connections_provider_check" CHECK ("provider" IN ('openai','anthropic','openrouter','custom','codex','claude')),
  CONSTRAINT "ml_connections_status_check" CHECK ("status" IN ('pending','ready','reconnect_required')),
  CONSTRAINT "ml_connections_discovery_status_check" CHECK ("discovery_status" IN ('pending','ok','failed','unsupported'))
);
CREATE TABLE "ml_models" (
  "id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "upstream_id" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "discovered" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ml_models_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ml_gateway_keys" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "prefix" TEXT NOT NULL,
  "hash" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  "revoked_at" TIMESTAMPTZ(6),
  "last_used_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ml_gateway_keys_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ml_login_jobs" (
  "id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "encrypted_state" TEXT,
  "encrypted_input" TEXT,
  "login_url" TEXT,
  "instructions" TEXT,
  "error" TEXT,
  "claimed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "ml_login_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ml_login_jobs_status_check" CHECK ("status" IN ('queued','running','waiting','completed','canceled','failed'))
);
CREATE INDEX "ml_connections_next_discovery_at_idx" ON "ml_connections"("next_discovery_at");
CREATE UNIQUE INDEX "ml_models_connection_id_upstream_id_key" ON "ml_models"("connection_id", "upstream_id");
CREATE UNIQUE INDEX "ml_gateway_keys_hash_key" ON "ml_gateway_keys"("hash");
CREATE INDEX "ml_login_jobs_status_expires_at_idx" ON "ml_login_jobs"("status", "expires_at");
CREATE INDEX "ml_login_jobs_connection_id_created_at_idx" ON "ml_login_jobs"("connection_id", "created_at");
ALTER TABLE "ml_models" ADD CONSTRAINT "ml_models_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "ml_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ml_login_jobs" ADD CONSTRAINT "ml_login_jobs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "ml_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
