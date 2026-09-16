-- Cost of Late Coming (feature): per-employee hourly rate in ZAR.
-- Late clock-ins / early clock-outs are quantified as hours lost and
-- multiplied by this rate to show the Rand cost per employee/period.
-- Metadata-only ADD COLUMN (nullable, no default) — no table rewrite.
ALTER TABLE "Employee"
  ADD COLUMN IF NOT EXISTS "hourlyRate" DECIMAL(10,2);
