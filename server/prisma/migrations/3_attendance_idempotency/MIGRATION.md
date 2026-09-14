# Migration 3 — Attendance idempotency

- **Why:** retried clock-in/clock-out requests (mobile flaky networks, browser
  retries) could double-punch without a database-level guard.
- **What:** adds durable idempotency/retry-key columns with unique indexes on
  `TimeEntry` so a retried logical punch maps to the same row.
- **Rollback:**
  ```sql
  ALTER TABLE "TimeEntry" DROP COLUMN IF EXISTS <retry columns>;
  ```
  (See migration.sql for exact column/index names.)
- **Notes:** application use cases in `server/src/application/attendance.ts`
  scope keys per actor/action; the DB index is the backstop.
