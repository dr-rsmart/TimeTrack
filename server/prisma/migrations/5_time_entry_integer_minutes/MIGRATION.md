# Migration 5 — TimeEntry integer minutes

- **Why:** `totalHours` is floating-point, which drifts on repeated
  round-trips and breaks exact payroll reconciliation.
- **What:** adds nullable `TimeEntry.totalMinutes` (whole minutes) as the
  exact persisted payable duration. Writes dual-write both representations;
  reads prefer `totalMinutes` with legacy fallback.
- **Rollback:** `ALTER TABLE "TimeEntry" DROP COLUMN "totalMinutes";`
- **Notes:** backfill is a SEPARATE operator step (never automatic):
  `npm run duration:preflight -- --strict` then
  `npm run duration:backfill -- --apply --json`. NOT NULL enforcement and
  `totalHours` retirement are a later contract phase.
