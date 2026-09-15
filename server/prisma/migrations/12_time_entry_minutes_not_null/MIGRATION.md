# Migration 12 — TimeEntry.totalMinutes NOT NULL

- **Why:** completes the Phase 4 duration contract: `totalMinutes` becomes
  the guaranteed exact payable duration; `totalHours` remains only as a
  legacy compatibility column until the wire contract retires it.
- **What:** backfills remaining NULLs from `ROUND(totalHours * 60)`, then
  sets NOT NULL.
- **Live sessions (2026-09-15):** open (`status = 'active'`) entries carry
  NULL `totalHours` by design; they are backfilled with `totalMinutes = 0` —
  the same sentinel the application writes at clock-in
  (`server/src/application/attendance.ts`), replaced with the exact duration
  at clock-out. A clocked-in employee therefore can never abort the deploy.
  The loud abort remains for non-active rows with no duration data at all.
- **Rollback:** `ALTER TABLE "TimeEntry" ALTER COLUMN "totalMinutes" DROP NOT NULL;`
- **Preconditions verified locally:** zero rows with both `totalHours` and
  `totalMinutes` NULL (checked 2026-09-14). Re-verified 2026-09-15 against
  the Railway production clone (entry 009): the only NULL-duration row was a
  live active session; this file was edited BEFORE migration 12 had been
  successfully applied on any persistent database, so Prisma checksums are
  unaffected (the failed clone attempt is resolved with
  `prisma migrate resolve --rolled-back 12_time_entry_minutes_not_null`).
