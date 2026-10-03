-- Protected first-owner setup: a permanent singleton marker recording that the
-- unauthenticated web setup flow is closed.
--
-- The CHECK constraint pins the primary key to the literal 'singleton', so the table can hold
-- at most one row and a concurrent second completion fails instead of inserting a duplicate.
-- The row is never deleted; `pnpm owner` recovery stays available regardless of the marker.

CREATE TABLE "installation_setup" (
    "id" TEXT NOT NULL,
    "completed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_by" TEXT,
    "method" TEXT NOT NULL,

    CONSTRAINT "installation_setup_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "installation_setup_singleton_check" CHECK ("id" = 'singleton')
);

-- Backfill: an installation that already has an owner must never expose the web setup flow.
-- `role` is a comma-separated list of code-declared role names, so membership is tested by
-- exact element match rather than a substring LIKE (which would also match 'co-owner').
-- The earliest bootstrap audit row, when present, is kept as the completion evidence.
INSERT INTO "installation_setup" ("id", "completed_at", "completed_by", "method")
SELECT
    'singleton',
    COALESCE(
        (
            SELECT MIN(a."created_at")
            FROM "audit_logs" a
            WHERE a."action" = 'owner.bootstrap'
        ),
        CURRENT_TIMESTAMP
    ),
    (
        SELECT a."target_id"
        FROM "audit_logs" a
        WHERE a."action" = 'owner.bootstrap'
        ORDER BY a."created_at" ASC, a."id" ASC
        LIMIT 1
    ),
    'migration-backfill'
WHERE EXISTS (
    SELECT 1
    FROM "app_user" u
    WHERE 'owner' = ANY (
        SELECT btrim(part) FROM unnest(string_to_array(COALESCE(u."role", ''), ',')) AS part
    )
)
OR EXISTS (
    SELECT 1 FROM "audit_logs" WHERE "action" = 'owner.bootstrap'
);
