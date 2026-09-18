# Migration 21: Saturday overtime multiplier

Adds `CompanySettings.saturdayOvertimeEnabled` (default `false`) and
`CompanySettings.saturdayOvertimeMultiplier` (default `1.5`) so Saturday work
can be classified and weighted exactly like Sunday work. Overtime precedence
is Public Holiday > Sunday > Saturday. The feature defaults OFF so existing
payroll results are unchanged until an admin enables it in Company Settings.

- **Rollback:** drop both columns (see `migration.sql` footer).
