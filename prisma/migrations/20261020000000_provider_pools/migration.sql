-- Stop the old application and discovery workers before applying this migration.
ALTER TABLE "ml_models" ADD COLUMN "alias" TEXT;
ALTER TABLE "ml_connections" ADD COLUMN "discovery_revision" INTEGER NOT NULL DEFAULT 0;
DROP INDEX IF EXISTS "ml_connections_next_discovery_at_idx";
ALTER TABLE "ml_connections" DROP COLUMN "next_discovery_at";
