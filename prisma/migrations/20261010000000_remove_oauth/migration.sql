-- Stop the old app and login worker before applying this migration.
DELETE FROM "ml_connections" WHERE "provider" IN ('codex', 'claude');
DROP TABLE "ml_login_jobs";
