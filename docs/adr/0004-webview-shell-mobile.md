# ADR 0004 — WebView-shell mobile client

- **Status:** Accepted (scheduled for review when native scope grows)
- **Date:** 2026-09-14 (backfilled)

## Context

Closed-alpha mobile rollout needed background geofence auto-punches
fast. A full native rebuild of the workforce UI would have delayed the
release by months.

## Decision

- Ship an Expo/React-Native shell hosting the production web app in a
  WebView, with NATIVE background location tasks, notifications, and
  token handoff to the web session.
- Auto-clock policy logic lives in the web app; the shell is a thin
  transport with retry/offline resilience.

## Consequences

- Positive: one UI codebase, fast iteration, web fixes reach mobile
  immediately.
- Negative: background logic duplicates punch paths and cannot run when
  the OS kills the shell; a shared `autoClock/geofence-core` extraction
  is the Phase 3 consolidation step. Revisit a native screens strategy
  if offline-first requirements emerge.
