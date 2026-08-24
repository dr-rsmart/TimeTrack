# TimeTrack — Production Operations, Observability, Disaster Recovery & Rollback Runbook

**Document Version:** 1.1.0  
**Effective Date:** 2026-08-18  
**Scope:** Express 5 Backend API, PostgreSQL Database, Redis Cluster, SSE Real-Time, Observability, Disaster Recovery & Rollback Runbooks.

---

## 1. Production Architecture Overview

TimeTrack is an enterprise multi-tenant workforce management platform. The production topology consists of:
- **API Tier:** Stateless Express 5 cluster running behind a reverse proxy (e.g. AWS ALB, NGINX, Cloudflare).
- **Persistence Tier:** PostgreSQL 16+ with connection pooling (`connection_limit=50`, `pool_timeout=30s`) and tenant defense-in-depth isolation.
- **Cache & Message Broker Tier:** Redis 7+ for distributed sliding-window rate limiting, session cache invalidation, and SSE pub/sub fan-out across API replicas.
- **Real-Time Tier:** Server-Sent Events (SSE) with monotonic sequence tracking, 500-event ring buffer replay (`Last-Event-ID`), and per-user connection throttling (max 10 concurrent streams).

---

## 2. Pre-Deployment Verification Checklist

Before promoting any build to production, execute the following commands in the CI/CD pipeline or deployment runner:

```bash
# 1. Full TypeScript Typecheck (Zero Errors)
npm run typecheck

# 2. Test Suite Execution (92+ Unit & E2E Tests)
npm test

# 3. Apply Production Database Migrations
cd server && npm run db:migrate:deploy

# 4. PostgreSQL Connection & Schema Integrity Verification
node server/db_check.mjs
```

### Environment Configuration Requirements

| Variable | Requirement | Description |
|---|---|---|
| `NODE_ENV` | `production` | Enables strict security headers (HSTS, secure cookies) and disables perf bypass. |
| `PORT` | e.g. `4000` | Port for the HTTP server to bind. |
| `DATABASE_URL` | `postgresql://...` | Connection URI with TLS (`sslmode=require` in production). |
| `JWT_SECRET` | 48+ char random | Secret for signing session JWTs. **Refuses to boot with dev defaults.** |
| `CORS_ORIGIN` | e.g. `https://time-track.tech` | Explicit frontend origin (wildcards disallowed). |
| `REDIS_URL` | `redis://...` | Connection URI for Redis. Required for multi-instance deployments. |

---

## 3. Observability, Health Checks & Tracing

### 3.1 Health Check Endpoints

The API provides two identical health check endpoints for load balancers and container orchestrators:
- `GET /health` (Root probe for AWS ALB / Kubernetes liveness & readiness)
- `GET /api/health` (Internal probe)

**Expected HTTP 200 Response Payload:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "uptime": 14520,
  "timestamp": "2026-08-18T20:30:00.000Z",
  "database": {
    "status": "healthy",
    "latencyMs": 8
  },
  "redis": {
    "configured": true,
    "status": "connected"
  },
  "realtime": {
    "activeClients": 142
  },
  "system": {
    "rssMb": 84,
    "heapUsedMb": 52
  }
}
```

*HTTP 503 Service Unavailable is returned immediately if the PostgreSQL database fails its heartbeat ping.*

### 3.2 Distributed Tracing & Correlation IDs

- Every incoming HTTP request is assigned a unique `X-Request-Id` (UUID v4) if not supplied by the upstream gateway.
- `X-Request-Id` is returned in all response headers and embedded in structured JSON logs (`durationMs`, `statusCode`, `tenantId`, `userId`).
- Log aggregators (Datadog, Loki, CloudWatch) can trace any request lifecycle using `requestId`.

### 3.3 Monitoring Metrics & Service Level Objectives (SLOs)

| Metric / SLI | Target / SLO | Alert Trigger | Severity | Action |
|---|---|---|---|---|
| **API Availability** | 99.9% uptime | Error rate > 1% for 5m | Critical | Page on-call; check DB/Redis latency |
| **P95 Latency (Clock-In/Out)** | < 150ms | P95 > 500ms for 3m | Warning | Check DB connection pool saturation |
| **P99 Latency (All Routes)** | < 1000ms | P99 > 2000ms for 3m | Warning | Investigate slow queries in pg_stat_statements |
| **Database Pool Utilization** | < 80% of 50 | Active conns > 42 for 2m | Critical | Scale connection limit or investigate connection leaks |
| **Redis Connection State** | Connected (100%) | Status != 'connected' for 1m | Warning | Check Redis Sentinel / cluster nodes |
| **Rate Limit Violations** | < 0.5% of requests | 429 spike > 5% | Warning | Inspect potential credential stuffing / brute force |

---

## 4. Redis High Availability & Failover Behavior

The Redis client (`server/src/redis.ts` and `server/src/sse.ts`) is configured for high availability:
- **`reconnectOnError`:** Automatically detects `READONLY` errors during AWS ElastiCache / Redis Sentinel primary promotions and replays the failed command on the newly elected master.
- **Exponential Backoff with Jitter:** Prevents connection thundering herd on network blips.
- **Fail-Safe Fallback:** If Redis is completely unreachable, rate limiting and SSE event broadcasting degrade gracefully to in-memory mode without dropping HTTP traffic.

---

## 5. Disaster Recovery Plan (DRP)

### 5.1 Recovery Objectives
- **RTO (Recovery Time Objective):** < 15 minutes for full service restoration.
- **RPO (Recovery Point Objective):** < 5 minutes of data loss (via continuous WAL archiving).

### 5.2 Backup & Restoration Playbook
1. **Automated Database Backups (`backup_db.mjs`):**
   - Automated snapshot script located at `server/backup_db.mjs`.
   - Generates custom-format PostgreSQL dumps with retention pruning:
     ```bash
     cd server && npm run db:backup
     # Or scheduled via cron:
     0 2 * * * cd /app/server && BACKUP_DIR=/var/backups/timetrack RETENTION_DAYS=14 node backup_db.mjs >> /var/log/timetrack_backup.log 2>&1
     ```
   - Continuous Write-Ahead Log (WAL) archiving enables Point-in-Time Recovery (PITR) to any second within 30 days.
2. **Restoration Drill Execution:**
   ```bash
   # Restore PostgreSQL database from snapshot:
   pg_restore --clean --if-exists -h $DB_HOST -U $DB_USER -d $DB_NAME backups/timetrack_backup_YYYY-MM-DD_HHmmss.dump
   
   # Verify database integrity post-restore:
   node server/db_check.mjs
   ```
3. **Emergency Regional Failover:**
   - Update DNS / Route 53 latency routing records to target standby region API cluster.
   - Promote read-replica in secondary region to primary database.

---

## 6. Rollback Procedures

### 6.1 API Application Rollback (Zero-Downtime)

If a deployment contains code defects or regression:
1. **Trigger Rolling Deployment of Previous Stable Image:**
   ```bash
   # Kubernetes example:
   kubectl rollout undo deployment/timetrack-api
   kubectl rollout status deployment/timetrack-api
   ```
2. **Verify Pod Readiness:** Confirm `/health` returns HTTP 200 on all replicas.
3. **Flush Stale Rate Limiting Keys (Optional):**
   ```bash
   redis-cli -u $REDIS_URL --scan --pattern "tt:rl:*" | xargs -r redis-cli -u $REDIS_URL del
   ```

### 6.2 Database Schema Emergency Rollback

1. **Pre-Deployment Backup Verification:** Ensure an automated snapshot exists prior to applying changes.
2. **Rollback Script Execution:** Apply targeted SQL reversal scripts from `server/prisma/migrations/`.
3. **Re-Run Health Verification:**
   ```bash
   node server/db_check.mjs
   ```

### 6.3 Emergency Maintenance Mode

If emergency maintenance is required:
1. Configure reverse proxy (Cloudflare/ALB) to return a 503 Maintenance Page.
2. Gracefully terminate API processes (`SIGTERM` triggers a 10s connection drain in `server/src/index.ts`).
3. Complete database maintenance or restoration.
4. Run `node server/db_check.mjs` and resume traffic.

---

## 7. Security & Audit Retention Management

- **Immutability:** `AuditLog` rows are append-only. Automated cron retention jobs purge only transient delivery logs and never purge compliance audit history.
- **Cold Storage Archiving:** At 12-month intervals, run `pg_dump` on `AuditLog` where `createdAt < NOW() - INTERVAL '1 year'` to S3 Glacier storage before archiving.
- **Rate Limit Monitoring:** Monitored via HTTP 429 response codes with `RATE_LIMITED` error payloads.
