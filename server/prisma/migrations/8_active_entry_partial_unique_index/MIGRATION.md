# Migration 8 — Active entry partial unique index

- **Why:** `server/src/index.ts` used to run `CREATE UNIQUE INDEX IF NOT EXISTS`
  at every boot (`ensureDatabaseIndexes`). Schema invariants belong in
  migrations, not boot-time side effects (Phase 2, BE3).
- **What:** records the `uniq_active_time_entry_employee` partial unique index
  on `TimeEntry(employeeEmail) WHERE status = 'active'`.
- **Rollback:**
  ```sql
  DROP INDEX IF EXISTS "uniq_active_time_entry_employee";
  ```
- **Safe:** `IF NOT EXISTS` makes it idempotent for databases where the
  boot-time creation already ran.
