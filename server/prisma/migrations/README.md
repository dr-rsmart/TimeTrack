# Database Migration & Schema Versioning Strategy

## Overview
TimeTrack utilizes Prisma Migrate alongside idempotent SQL migrations for PostgreSQL.

## Migration Principles
1. **Zero Downtime Transitions**:
   - Additive schema alterations (new columns with default values or nullable).
   - Partial unique indexes are created using `IF NOT EXISTS` constructs.
   - Dual-write / backfill / drop-column phases for breaking field reorganizations.
2. **Multi-Tenant Scoping**:
   - Every tenant data table must enforce non-null `companyProfileId` referencing `CompanyProfile(id)`.
   - Tenant isolation indexes and partial unique constraints are validated automatically at boot.

## Migration History
- `0_init`: Initial baseline schema containing `User`, `CompanyProfile`, `Employee`, `Shift`, `TimeEntry`, `CompanySettings`, `Geofence`, `LocationPreset`, `AuditLog`, `RetentionPolicy`, `CronLock`, `EmploymentHistory`.
