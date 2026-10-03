-- Emailed first-owner setup: a pending verification request per candidate owner.
--
-- The emailed six-digit code is stored only as an HMAC-SHA256 digest, so the table never holds a
-- usable credential. `user_id` is unique and cascades, so a candidate account can have at most
-- one pending request and deleting the account removes it.

CREATE TABLE "owner_setup_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_sent_at" TIMESTAMPTZ(6),
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "owner_setup_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "owner_setup_requests_user_id_key" ON "owner_setup_requests" ("user_id");

CREATE INDEX "owner_setup_expires_idx" ON "owner_setup_requests" ("expires_at");

ALTER TABLE "owner_setup_requests"
    ADD CONSTRAINT "owner_setup_requests_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "app_user" ("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
