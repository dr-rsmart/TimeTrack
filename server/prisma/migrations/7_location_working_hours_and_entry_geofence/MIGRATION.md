# Migration 7: Location Working Hours + Entry Geofence

Adds `Geofence.workingStartTime`, `Geofence.workingEndTime`, and
`Geofence.workingDays`, defaulting existing locations to Monday?Friday,
08:00-17:00 in the configured business timezone.

Adds nullable `TimeEntry.geofenceId` so a completed or active attendance record
retains the exact work location used at clock-in. Existing entries remain valid
and continue to use the stale-entry safety close if no location is available.

Auto clock-out precedence:

1. Assigned shift end time.
2. Clock-in location working end time when no applicable shift end exists.
3. Existing stale active-entry safety close.
