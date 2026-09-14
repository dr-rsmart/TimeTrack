# Migration 12 — TimeEntry.totalMinutes NOT NULL

- **Why:** completes the Phase 4 duration contract: `totalMinutes` becomes
  the guaranteed exact payable duration; `totalHours` remains only as a
  legacy compatibility column until the wire contract retires it.
- **What:** backfills remaining NULLs from `ROUND(totalHours * 60)`, then
  sets NOT NULL.
- **Rollback:** `ALTER TABLE "TimeEntry" ALTER COLUMN "totalMinutes" DROP NOT NULL;`
- **Preconditions verified locally:** zero rows with both `totalHours` and
  `totalMinutes` NULL (checked 2026-09-14).
