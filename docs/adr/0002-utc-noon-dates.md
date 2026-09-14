# ADR 0002 — UTC-noon DATE storage for business dates

- **Status:** Accepted
- **Date:** 2026-09-14 (backfilled; behavior shipped earlier)

## Context

`Shift.date` / `TimeEntry.date` are business dates ("which workday does
this punch belong to?"), not instants. Storing local-midnight timestamps
breaks when the server, the device and the business timezone differ.

## Decision

- DATE columns store `YYYY-MM-DDT12:00:00Z` (UTC noon) via `parseDate`.
- All wall-clock comparisons and manual attendance times run in the
  business timezone (`CRON_TIMEZONE`, default `Africa/Johannesburg`).

## Consequences

- Positive: dates are timezone-stable everywhere; date math is trivial.
- Negative: any raw SQL or future code that writes local-midnight dates
  will corrupt grouping — covered by `server/src/timezone.ts` unit tests
  and the timezone convention section in ARCHITECTURE.md.
