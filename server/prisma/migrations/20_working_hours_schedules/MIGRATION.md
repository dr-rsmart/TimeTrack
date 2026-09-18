# Migration 20: per-day working-hours schedules

Adds `Geofence.workingHoursSchedules` and
`CompanySettings.defaultWorkingHoursSchedules` (JSONB arrays of
`{ days[], startTime, endTime }`) so admins can configure different hours per
day group (e.g. Mon–Thu 08:00–17:00, Fri 08:00–15:00, Sat 08:00–14:00) via the
new "Add hours" UI in Work Locations and Company Settings.

## Behaviour change (fixes the 17:00 auto clock-out report)

An EMPTY schedule list means "not explicitly configured" — the cron
working-end auto clock-out no longer fires for such geofences/companies. The
backfill only converts legacy hours that DIFFER from the untouched schema
defaults (`08:00`–`17:00`, Mon–Fri), so rows that were never customised stop
auto-closing sessions at the implicit 17:00. Admins who genuinely run
08:00–17:00 must re-save their hours once in the new UI to re-enable the
automatic close.

Priority (unchanged intent, now explicit): a location's schedules apply to
entries clocked in at that location; the company default schedules apply ONLY
when the employee has no geofence assignment at all.

- **Rollback:** drop both columns (see `migration.sql` footer). The legacy
  single-hours columns are untouched, so older server builds keep working.
