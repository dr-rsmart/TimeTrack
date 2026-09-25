# Migration 22: Late-penalty rate (Cost of Late Coming)

Adds `Employee.latePenaltyRate` (nullable `DECIMAL(10,2)`, ZAR). When set, the
Cost of Late report prices late clock-ins / early clock-outs at this rate;
when unset it falls back to `Employee.hourlyRate`, so existing behaviour is
unchanged for employees without a configured penalty rate.

- **Rollback:** drop the column (see `migration.sql` footer).
