# TimeTrack

**Multi-tenant workforce management platform** — time tracking, shift scheduling, and precision payroll. Rebuilt from scratch as an improved successor to the legacy **TimeTrack** system, applying lessons learned from 14 QA audit cycles.

---

## What's improved over legacy TimeTrack

| Area | Legacy TimeTrack | TimeTrack (rebuild) |
|---|---|---|
| **Schema typing** | Stringly-typed roles/statuses | Native Prisma enums (`Role`, `ShiftStatus`, `ShiftType`, `EmployeeStatus`) |
| **Naming** | Mixed snake_case/camelCase | Consistent camelCase across all models |
| **Payroll math** | `decimal.js` with `any` casts | Clean `decimal.js` with typed `Decimal` throughout |
| **Validation** | Zod v3/v4 mixed across client/server | Zod v4 on server with typed middleware factory |
| **SSE** | In-memory arrays, no pruning | Managed client registry, heartbeats, stale pruning, per-user connection caps |
| **Auth** | JWT with localStorage fallback | httpOnly cookie-first JWT (Bearer accepted; no query-string tokens) |
| **Indexes** | Added reactively after stress failures | Composite indexes designed upfront (`[employeeEmail, date, status]`, `[companyProfileId, date]`) |
| **Audit** | Fire-and-forget | Immutable audit trail with before/after diffs + IP redaction for managers |
| **Frontend** | Large coupled pages | Focused pages, typed API client, SSE-driven live refresh |
| **UI/UX** | Functional but flat design | Glassmorphism, animated nav pills, dark mode, persona-tailored dashboards, mobile bottom nav |

## UI/UX Design System (v2.0)

The rebuild introduces a modern, polished interface inspired by TimeTrack's 4.5-star rated UX:

- **Glassmorphism layout** — backdrop-blur header, gradient accent bar, radial dot-grid background
- **Animated navigation** — framer-motion layout pills for active route indication (desktop + mobile)
- **Dark/light theme** — system preference detection with manual toggle and localStorage persistence
- **Role badges** — color-coded identity chips (Master=blue, Admin=red, Manager=amber, Employee=green)
- **SSE status pill** — live connection indicator (Live/Syncing/Offline) in header
- **Persona dashboards**:
  - *Master*: Platform Control Center with tenant stats, company directory, system health
  - *Employee*: Personal greeting banner with position/ID/branch chips + SelfClockWidget (live timer, break tracking)
  - *Admin/Manager*: Team KPIs, attendance progress bar, shift status, hours trend chart, branch pie chart
- **Mobile-first** — bottom pill navigation on small screens, safe-area insets, touch-friendly targets
- **Micro-interactions** — staggered list animations, hover card elevation, button press feedback

## Feature set

- **Multi-tenant RBAC** — `master` (platform), `admin`, `manager` (branch/department scoped), `employee` (self only)
- **Employee directory** — search, branch/department filters, CRUD with optimistic locking
- **Shift scheduling** — weekly view, overlap detection, leave types, no-show auto-detection (cron, 2h grace)
- **Time tracking** — clock in/out with Haversine geofence validation, live session timer, manual overrides
- **Payroll engine** — Decimal-precision overtime: daily threshold, Sunday 1.5×, public holiday 2.0× (holiday precedence), monthly threshold option, leave-type exclusion
- **Dashboard** — KPIs, hours trend chart, branch distribution, live activity feed
- **Reports** — payroll summary with CSV export
- **Audit log** — entity/action filters, change diffs, GDPR-compliant IP redaction
- **Real-time** — scoped SSE broadcast with auto-reconnect (exponential backoff)

## Quick start

### Prerequisites

- Node.js 20+
- PostgreSQL running locally

### Setup

```bash
# 0. Configure environment (copy templates, fill in real values)
cp .env.example .env
cp server/.env.example server/.env
# Edit server/.env: set DATABASE_URL and generate a JWT_SECRET with:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 1. Install everything + push schema + seed demo data
npm run setup

# 2. Start both servers (API on :4000, web on :5173)
npm run dev
```

> **Security:** the server refuses to boot without a `JWT_SECRET`, rejects
> known-insecure default secrets in production, and disables the
> performance-test rate-limit bypass when `NODE_ENV=production`. `.env` files
> are git-ignored — never commit real credentials.

Open **http://localhost:5173** and use a quick-login button, or:

| Email | Role | Password |
|---|---|---|
| `master@smartpatel.co.za` | Platform Master (cross-tenant) | `Password123` |
| `admin@timetrack.com` | Company Admin | `Password123` |
| `thabo@timetrack.com` | Manager — Sandton HQ | `Password123` |
| `ayesha@timetrack.com` | Manager — Cape Town | `Password123` |
| `sipho@timetrack.com` | Employee — Sandton HQ | `Password123` |
| `lerato@timetrack.com` | Employee — Sandton HQ | `Password123` |
| `pieter@timetrack.com` | Employee — Sandton HQ | `Password123` |
| `naledi@timetrack.com` | Employee — Cape Town | `Password123` |
| `riaan@timetrack.com` | Employee — Cape Town | `Password123` |

### Configuration

Edit `server/.env` (see `server/.env.example` for the full template):

```env
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/tt_workforce"
JWT_SECRET="<generate a 48-byte hex secret>"
PORT=4000
CORS_ORIGIN="http://localhost:5173"
```

### Scripts

| Command | Description |
|---|---|
| `npm run dev` | Run API + web concurrently |
| `npm run setup` | Install deps, push schema, seed |
| `npm run seed` | Re-seed demo data |
| `npm run build` | Build frontend + server |
| `npm run typecheck` | Typecheck both projects |

## Architecture

```
React 18 SPA (Vite, Tailwind, Recharts)
        │  REST + SSE (credentials: include)
        ▼
Express 5 API ── JWT auth (httpOnly cookie) ── Zod validation
   ├── Fail-fast config (no hardcoded secrets; boot refuses missing JWT_SECRET)
   ├── Tenant context (AsyncLocalStorage) + Prisma auto-stamp + assertTenantMatch
   ├── Payroll engine (decimal.js)
   ├── Geofence engine (Haversine)
   ├── SSE broadcaster (scoped, pruned, heartbeats)
   ├── Cron runner (no-show detection, stale-entry auto-close, distributed lock)
   ├── Master platform routes (registration, impersonation, tenant suspension)
   └── Audit service (diff tracking, IP redaction, append-only — never purged)
        │
        ▼
PostgreSQL via Prisma (composite indexes, multi-tenant scoping)
```

### Key business rules (carried over from legacy scope)

1. **Full name SSOT** — derived from `firstName + surname`, never user-editable
2. **Branch/department defaults** — `Unassigned` / `General` (non-null)
3. **Shift overlap prevention** — server rejects overlapping shifts per employee/date
4. **No-show detection** — cron marks `scheduled` shifts as `no_show` 2h after start
5. **Holiday precedence** — public holiday multiplier overrides Sunday multiplier
6. **Leave exclusion** — Leave/Sick/PTO hours count as ordinary, never generate overtime
7. **IP redaction** — managers see redacted IPs in audit log (GDPR/POPIA)
8. **Optimistic locking** — employee updates carry a `version` field

## Project structure

```
├── src/                    # React frontend
│   ├── components/         # UI primitives + layout
│   ├── context/            # Auth context
│   ├── hooks/              # useSSE
│   ├── pages/              # Dashboard, Employees, Shifts, Time, Reports, Audit, Settings
│   └── services/           # Typed API client
└── server/                 # Express API
    ├── prisma/schema.prisma
    └── src/
        ├── routes/         # auth, employees, shifts, timeEntries, dashboard, reports, settings, audit
        ├── middleware/     # auth (JWT), scope (manager scoping)
        ├── payroll.ts      # Decimal overtime engine
        ├── geofence.ts     # Haversine validation
        ├── sse.ts          # Scoped broadcaster
        ├── cron.ts         # No-show detection
        ├── audit.ts        # Audit logging + IP redaction
        └── seed.ts         # Demo dataset