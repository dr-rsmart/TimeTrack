/**
 * Metrics — In-Process Prometheus Counters
 * ----------------------------------------
 * Dependency-free request/system counters exposed at GET /metrics in the
 * Prometheus text exposition format. Scraped by the alert rules in
 * tests/perf/observability/prometheus-alerts.yml.
 */

interface HttpCounters {
  total: number;
  errors: number; // status >= 500
  byClass: Record<'2xx' | '3xx' | '4xx' | '5xx', number>;
}

const http: HttpCounters = {
  total: 0,
  errors: 0,
  byClass: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
};

const startedAt = Date.now();

/** Record a completed HTTP response (called once per request via middleware). */
export function recordHttpRequest(statusCode: number): void {
  http.total += 1;
  if (statusCode >= 500) http.errors += 1;
  if (statusCode >= 200 && statusCode < 300) http.byClass['2xx'] += 1;
  else if (statusCode >= 300 && statusCode < 400) http.byClass['3xx'] += 1;
  else if (statusCode >= 400 && statusCode < 500) http.byClass['4xx'] += 1;
  else if (statusCode >= 500) http.byClass['5xx'] += 1;
}

/** Snapshot of current counter values (for tests/health surfaces). */
export function getMetricSnapshot() {
  return {
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    httpRequestsTotal: http.total,
    httpErrorsTotal: http.errors,
    httpByStatusClass: { ...http.byClass },
  };
}

/**
 * Render the Prometheus text exposition format (v0.0.4).
 * Extra gauges (SSE clients, redis, memory) are supplied by the route so
 * this module stays dependency-free.
 */
export function renderMetrics(extra: { name: string; help: string; type: string; value: number }[] = []): string {
  const mem = process.memoryUsage();
  const lines: string[] = [];

  lines.push('# HELP process_uptime_seconds Process uptime in seconds.');
  lines.push('# TYPE process_uptime_seconds gauge');
  lines.push(`process_uptime_seconds ${Math.floor(process.uptime())}`);

  lines.push('# HELP process_resident_memory_bytes Resident memory size in bytes.');
  lines.push('# TYPE process_resident_memory_bytes gauge');
  lines.push(`process_resident_memory_bytes ${mem.rss}`);

  lines.push('# HELP nodejs_heap_used_bytes Node.js heap used in bytes.');
  lines.push('# TYPE nodejs_heap_used_bytes gauge');
  lines.push(`nodejs_heap_used_bytes ${mem.heapUsed}`);

  lines.push('# HELP http_requests_total Total completed HTTP requests.');
  lines.push('# TYPE http_requests_total counter');
  lines.push(`http_requests_total ${http.total}`);

  lines.push('# HELP http_errors_total Total HTTP responses with status >= 500.');
  lines.push('# TYPE http_errors_total counter');
  lines.push(`http_errors_total ${http.errors}`);

  lines.push('# HELP http_responses_total Completed HTTP responses by status class.');
  lines.push('# TYPE http_responses_total counter');
  for (const [cls, count] of Object.entries(http.byClass)) {
    lines.push(`http_responses_total{class="${cls}"} ${count}`);
  }

  for (const m of extra) {
    lines.push(`# HELP ${m.name} ${m.help}`);
    lines.push(`# TYPE ${m.name} ${m.type}`);
    lines.push(`${m.name} ${m.value}`);
  }

  return lines.join('\n') + '\n';
}
