# Migration 0_init: Baseline Multi-Tenant Schema

## Details
- **Created**: Initial release
- **Database**: PostgreSQL 15+
- **Applied By**: `npx prisma migrate deploy`

## Key Entities
- `CompanyProfile`: Root tenant container
- `User`: RBAC authentication and role management (master, admin, manager, employee)
- `Employee`: Workforce profiles with branch & department assignments
- `Shift`: Scheduling entries
- `TimeEntry`: Concurrency-safe clock records with partial unique indexing
- `AuditLog`: Immutable audit trail with tenant resolution
- `Geofence`: Geographic coordinates for clock-in perimeter enforcement
