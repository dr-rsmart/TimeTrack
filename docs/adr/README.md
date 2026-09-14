# Architecture Decision Records

| #    | Title                                                                                 | Status                    | Date       |
| ---- | ------------------------------------------------------------------------------------- | ------------------------- | ---------- |
| 0001 | [Non-expiring sessions with epoch revocation](./0001-non-expiring-sessions.md)        | Accepted                  | 2026-09-14 |
| 0002 | [UTC-noon DATE storage for business dates](./0002-utc-noon-dates.md)                  | Accepted                  | 2026-09-14 |
| 0003 | [Database RLS gated behind runtime bridge](./0003-rls-gating.md)                      | Accepted                  | 2026-09-14 |
| 0004 | [WebView-shell mobile client](./0004-webview-shell-mobile.md)                         | Accepted (review pending) | 2026-09-14 |
| 0005 | [Application-level tenancy with DB enforcement in depth](./0005-app-level-tenancy.md) | Accepted                  | 2026-09-14 |

## Process

- One ADR per significant, hard-to-reverse decision.
- Statuses: Proposed → Accepted → Superseded (link the replacement).
- New decisions MUST add an ADR in the same PR as the code.
