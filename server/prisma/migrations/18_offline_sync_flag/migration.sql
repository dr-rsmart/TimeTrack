-- Offline punch outbox: flag time entries whose punch was captured OFFLINE
-- and synced later from the client outbox within the bounded acceptance
-- window (server/src/application/attendance.ts resolveOfflineCapturedAt).
ALTER TABLE "TimeEntry" ADD COLUMN "isOfflineSynced" BOOLEAN NOT NULL DEFAULT false;