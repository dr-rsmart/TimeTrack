# ADR 0001 — Non-expiring sessions with epoch revocation

- **Status:** Accepted
- **Date:** 2026-09-14 (backfilled; behavior shipped earlier)

## Context

TimeTrack targets clock-in kiosks, shared-site tablets and long-shift
workers. Absolute session expiry forces mid-shift re-authentication and
support tickets. At the same time, immediate revocation on logout,
password rotation, suspension and termination is a hard security
requirement.

## Decision

- JWTs carry no `exp` claim; sessions persist until explicitly revoked.
- `User.pwdEpoch` bumps on every password change/reset and explicit
  logout; tokens signed with an older epoch are rejected (fail-closed
  caches + cluster-wide invalidation).
- Suspension, termination and role revocation are re-checked on every
  authenticated request.

## Consequences

- Positive: no forced mid-shift logouts; revocation is immediate and
  cluster-consistent.
- Negative: a stolen token stays valid until rotation — mitigations are
  httpOnly/SameSite cookies, short-lived native bearer tokens for the
  shell, and audit logging. Revisit with refresh-token rotation if threat
  model changes.
