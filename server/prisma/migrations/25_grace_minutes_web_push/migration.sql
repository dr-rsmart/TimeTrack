-- Migration 25: shared late/early grace + browser Web Push subscriptions.
--
-- Both changes are additive and replay-safe (IF NOT EXISTS).

-- ── Shared grace (report + alerts) ────────────────────────────────────────
-- Default 0 keeps the strict rule: 09:05 on a 09:00 start = 5 minutes late.
ALTER TABLE "CompanySettings"
  ADD COLUMN IF NOT EXISTS "lateGraceMinutes" INTEGER NOT NULL DEFAULT 0;

-- ── Web Push (VAPID) subscriptions ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "WebPushSubscription" (
  "id" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "employeeEmail" TEXT,
  "companyProfileId" TEXT,
  "userAgent" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WebPushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WebPushSubscription_endpoint_key"
  ON "WebPushSubscription"("endpoint");
CREATE INDEX IF NOT EXISTS "WebPushSubscription_userId_isActive_idx"
  ON "WebPushSubscription"("userId", "isActive");
CREATE INDEX IF NOT EXISTS "WebPushSubscription_companyProfileId_isActive_idx"
  ON "WebPushSubscription"("companyProfileId", "isActive");

ALTER TABLE "WebPushSubscription" DROP CONSTRAINT IF EXISTS "WebPushSubscription_userId_fkey";
ALTER TABLE "WebPushSubscription"
  ADD CONSTRAINT "WebPushSubscription_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Not RLS-enabled, mirroring DevicePushToken: rows are only read by the cron /
-- push fan-out (outside a request tenant context) and every write is scoped to
-- the authenticated caller's userId in the route handler.

-- Rollback:
--   DROP TABLE IF EXISTS "WebPushSubscription";
--   ALTER TABLE "CompanySettings" DROP COLUMN IF EXISTS "lateGraceMinutes";
