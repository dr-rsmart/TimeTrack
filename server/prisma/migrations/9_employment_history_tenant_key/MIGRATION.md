# Migration 9 — EmploymentHistory tenant key

- **Why:** EmploymentHistory had no `companyProfileId` (the only tenant-scoped
  entity without one), which kept it out of the Prisma tenant auto-stamp /
  `assertTenantMatch` backstops and forced its RLS policy to JOIN through
  `Employee` (Phase 2, DB2).
- **What:**
  1. Adds nullable `companyProfileId` (legacy rows remain null until the
     controlled NOT-NULL backfill phase).
  2. Backfills it from the referenced employee's tenant.
  3. Adds an index.
  4. Extends the `timetrack_enforce_tenant_integrity` trigger to
     `EmploymentHistory → Employee` references.
  5. Switches the RLS policy to the direct tenant key.
- **Rollback:**
  ```sql
  DROP TRIGGER IF EXISTS "timetrack_tenant_integrity" ON "EmploymentHistory";
  ALTER TABLE "EmploymentHistory" DROP COLUMN IF EXISTS "companyProfileId";
  -- then restore the previous join-based RLS policy (see migration 6)
  ```
- **Follow-up (Phase 4):** enforce NOT NULL after `npm run tenant:preflight`
  reports zero legacy-null rows.
