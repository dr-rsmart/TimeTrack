/**
 * OpenAPI 3.1 document for the TimeTrack API.
 * -------------------------------------------
 * Generated from the same Zod schemas used for runtime validation
 * (server/src/validation.ts) so the spec cannot drift from the code.
 * Served at GET /api/docs (JSON).
 */

import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z } from './zod.js';
import {
  loginSchema,
  changePasswordSchema,
  createEmployeeSchema,
  updateEmployeeSchema,
  bulkCreateEmployeesSchema,
  createShiftSchema,
  updateShiftSchema,
  bulkCreateShiftsSchema,
  clockInSchema,
  clockOutSchema,
  manualTimeEntrySchema,
  bulkClockInSchema,
  bulkClockOutSchema,
  updateTimeEntrySchema,
  createGeofenceSchema,
  updateGeofenceSchema,
  updateSettingsSchema,
  createCompanySchema,
  registerPushTokenSchema,
} from './validation.js';

const registry = new OpenAPIRegistry();

const tag = (name: string) => ({ tags: [name] });

// Plain OpenAPI objects (inlined, no component registry — the zod-to-openapi
// component-ref path is not used so generation stays compatible with zod v4).
const errorResponse = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    code: { type: 'string' },
    details: { type: 'object', additionalProperties: {} },
    suggestions: { type: 'array', items: { type: 'string' } },
  },
} as const;

const pageResponse = {
  type: 'object',
  properties: {
    items: { type: 'array', items: {} },
    total: { type: 'integer' },
    limit: { type: 'integer' },
    offset: { type: 'integer' },
  },
} as const;

// Zod schemas, plain OpenAPI objects and $ref-style component objects are all
// accepted as response-body schemas by the registry; `any` here is the
// union of those shapes (matching the registry's own parameter typing).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function json200(schema: any, description = 'OK') {
  return { 200: { description, content: { 'application/json': { schema } } } };
}

const commonErrors = {
  400: {
    description: 'Validation failed',
    content: { 'application/json': { schema: errorResponse } },
  },
  401: {
    description: 'Authentication required',
    content: { 'application/json': { schema: errorResponse } },
  },
  403: {
    description: 'Access denied / out of scope',
    content: { 'application/json': { schema: errorResponse } },
  },
  404: {
    description: 'Not found',
    content: { 'application/json': { schema: errorResponse } },
  },
};

// ── Auth ──
registry.registerPath({
  method: 'post',
  path: '/auth/login',
  ...tag('Auth'),
  request: { body: { content: { 'application/json': { schema: loginSchema } } } },
  responses: {
    ...json200({ type: 'object', properties: { user: {}, token: { type: 'string' } } }),
    401: {
      description: 'Invalid email or password',
      content: { 'application/json': { schema: errorResponse } },
    },
  },
});
registry.registerPath({
  method: 'post',
  path: '/auth/logout',
  ...tag('Auth'),
  responses: json200({ type: 'object', properties: { success: { type: 'boolean' } } }),
});
registry.registerPath({
  method: 'get',
  path: '/auth/me',
  ...tag('Auth'),
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});
registry.registerPath({
  method: 'post',
  path: '/auth/change-password',
  ...tag('Auth'),
  request: { body: { content: { 'application/json': { schema: changePasswordSchema } } } },
  responses: {
    ...json200({ type: 'object', properties: { success: { type: 'boolean' } } }),
    ...commonErrors,
  },
});
// ── Employees ──
registry.registerPath({
  method: 'get',
  path: '/employees',
  ...tag('Employees'),
  responses: {
    200: {
      description: 'Paginated employee list',
      content: { 'application/json': { schema: pageResponse } },
    },
    ...commonErrors,
  },
});
registry.registerPath({
  method: 'post',
  path: '/employees',
  ...tag('Employees'),
  request: { body: { content: { 'application/json': { schema: createEmployeeSchema } } } },
  responses: { ...json200({ type: 'object' }, 'Created employee'), ...commonErrors },
});
registry.registerPath({
  method: 'post',
  path: '/employees/bulk',
  ...tag('Employees'),
  request: { body: { content: { 'application/json': { schema: bulkCreateEmployeesSchema } } } },
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});
registry.registerPath({
  method: 'get',
  path: '/employees/{id}',
  ...tag('Employees'),
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});
registry.registerPath({
  method: 'put',
  path: '/employees/{id}',
  ...tag('Employees'),
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
  request: { body: { content: { 'application/json': { schema: updateEmployeeSchema } } } },
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});
registry.registerPath({
  method: 'delete',
  path: '/employees/{id}',
  ...tag('Employees'),
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});

// ── Shifts ──
registry.registerPath({
  method: 'get',
  path: '/shifts',
  ...tag('Shifts'),
  responses: {
    200: {
      description: 'Paginated shift list',
      content: { 'application/json': { schema: pageResponse } },
    },
    ...commonErrors,
  },
});
registry.registerPath({
  method: 'post',
  path: '/shifts',
  ...tag('Shifts'),
  request: { body: { content: { 'application/json': { schema: createShiftSchema } } } },
  responses: { ...json200({ type: 'object' }, 'Created shift'), ...commonErrors },
});
registry.registerPath({
  method: 'post',
  path: '/shifts/bulk',
  ...tag('Shifts'),
  request: { body: { content: { 'application/json': { schema: bulkCreateShiftsSchema } } } },
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});
registry.registerPath({
  method: 'put',
  path: '/shifts/{id}',
  ...tag('Shifts'),
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
  request: { body: { content: { 'application/json': { schema: updateShiftSchema } } } },
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});
registry.registerPath({
  method: 'delete',
  path: '/shifts/{id}',
  ...tag('Shifts'),
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});
// ── Time entries / attendance ──
registry.registerPath({
  method: 'get',
  path: '/time-entries',
  ...tag('Time entries'),
  request: {
    query: z.object({
      date: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      employeeEmail: z.string().optional(),
      status: z.string().optional(),
      branch: z.string().optional(),
      department: z.string().optional(),
      limit: z.coerce.number().optional(),
      offset: z.coerce.number().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Paginated time-entry list',
      content: { 'application/json': { schema: pageResponse } },
    },
    ...commonErrors,
  },
});
registry.registerPath({
  method: 'post',
  path: '/time-entries/clock-in',
  ...tag('Time entries'),
  request: { body: { content: { 'application/json': { schema: clockInSchema } } } },
  responses: {
    ...json200({ type: 'object' }, 'Clocked in'),
    ...commonErrors,
    409: { description: 'Already clocked in' },
  },
});
registry.registerPath({
  method: 'post',
  path: '/time-entries/clock-out',
  ...tag('Time entries'),
  request: { body: { content: { 'application/json': { schema: clockOutSchema } } } },
  responses: {
    ...json200({ type: 'object' }, 'Clocked out'),
    ...commonErrors,
    404: { description: 'No active session' },
  },
});
registry.registerPath({
  method: 'get',
  path: '/time-entries/active',
  ...tag('Time entries'),
  responses: { ...json200({ type: 'object', nullable: true }), ...commonErrors },
});
registry.registerPath({
  method: 'post',
  path: '/time-entries/manual',
  ...tag('Time entries'),
  request: { body: { content: { 'application/json': { schema: manualTimeEntrySchema } } } },
  responses: { ...json200({ type: 'object' }, 'Created manual entry'), ...commonErrors },
});
registry.registerPath({
  method: 'post',
  path: '/time-entries/bulk-clock-in',
  ...tag('Time entries'),
  request: { body: { content: { 'application/json': { schema: bulkClockInSchema } } } },
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});
registry.registerPath({
  method: 'post',
  path: '/time-entries/bulk-clock-out',
  ...tag('Time entries'),
  request: { body: { content: { 'application/json': { schema: bulkClockOutSchema } } } },
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});
registry.registerPath({
  method: 'put',
  path: '/time-entries/{id}',
  ...tag('Time entries'),
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
  request: { body: { content: { 'application/json': { schema: updateTimeEntrySchema } } } },
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});
registry.registerPath({
  method: 'delete',
  path: '/time-entries/{id}',
  ...tag('Time entries'),
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});

// ── Dashboard ──
for (const path of [
  '/dashboard/summary',
  '/dashboard/attendance-detail',
  '/dashboard/hours-trend',
  '/dashboard/branch-distribution',
  '/dashboard/department-distribution',
  '/dashboard/department-performance',
  '/dashboard/recent-activity',
  '/dashboard/attendance-trend',
  '/dashboard/overtime-alerts',
  '/dashboard/overtime-forecast',
]) {
  registry.registerPath({
    method: 'get',
    path,
    ...tag('Dashboard'),
    responses: { ...json200({ type: 'object' }), ...commonErrors },
  });
}

// ── Reports ──
registry.registerPath({
  method: 'get',
  path: '/reports/payroll',
  ...tag('Reports'),
  request: {
    query: z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      branch: z.string().optional(),
      department: z.string().optional(),
      employeeEmail: z.string().optional(),
      employeeId: z.string().optional(),
    }),
  },
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});
registry.registerPath({
  method: 'post',
  path: '/reports/payroll/snapshot',
  ...tag('Reports'),
  request: {
    body: {
      content: { 'application/json': { schema: z.object({ from: z.string(), to: z.string() }) } },
    },
  },
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});
registry.registerPath({
  method: 'get',
  path: '/reports/payroll/snapshots',
  ...tag('Reports'),
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});
registry.registerPath({
  method: 'get',
  path: '/reports/attendance',
  ...tag('Reports'),
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});
registry.registerPath({
  method: 'get',
  path: '/reports/attendance-cost',
  ...tag('Reports'),
  request: {
    query: z.object({
      from: z.string(),
      to: z.string(),
      branch: z.string().optional(),
      department: z.string().optional(),
      employeeEmail: z.string().optional(),
    }),
  },
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});
registry.registerPath({
  method: 'get',
  path: '/reports/attendance-alerts',
  ...tag('Reports'),
  request: {
    query: z.object({
      days: z.string().optional(),
      grace: z.string().optional(),
    }),
  },
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});

// ── Settings ──
registry.registerPath({
  method: 'get',
  path: '/settings/settings',
  ...tag('Settings'),
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});
registry.registerPath({
  method: 'put',
  path: '/settings/settings',
  ...tag('Settings'),
  request: { body: { content: { 'application/json': { schema: updateSettingsSchema } } } },
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});
registry.registerPath({
  method: 'post',
  path: '/auth/push-token',
  ...tag('Auth'),
  request: { body: { content: { 'application/json': { schema: registerPushTokenSchema } } } },
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});
for (const path of [
  '/settings/holidays',
  '/settings/geofences/my',
  '/settings/geofences',
  '/settings/location-presets',
  '/settings/employees-for-geofence',
  '/settings/geocode',
]) {
  registry.registerPath({
    method: 'get',
    path,
    ...tag('Settings'),
    responses: { ...json200({ type: 'object' }), ...commonErrors },
  });
}
registry.registerPath({
  method: 'post',
  path: '/settings/geofences',
  ...tag('Settings'),
  request: { body: { content: { 'application/json': { schema: createGeofenceSchema } } } },
  responses: { ...json200({ type: 'object' }, 'Created geofence'), ...commonErrors },
});
registry.registerPath({
  method: 'put',
  path: '/settings/geofences/{id}',
  ...tag('Settings'),
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
  request: { body: { content: { 'application/json': { schema: updateGeofenceSchema } } } },
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});
registry.registerPath({
  method: 'delete',
  path: '/settings/geofences/{id}',
  ...tag('Settings'),
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});

// ── Audit ──
registry.registerPath({
  method: 'get',
  path: '/audit',
  ...tag('Audit'),
  responses: { ...json200(pageResponse), ...commonErrors },
});
registry.registerPath({
  method: 'get',
  path: '/audit/entities',
  ...tag('Audit'),
  responses: { ...json200({ type: 'array', items: { type: 'string' } }), ...commonErrors },
});

// ── Master ──
registry.registerPath({
  method: 'get',
  path: '/master/stats',
  ...tag('Master'),
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});
registry.registerPath({
  method: 'get',
  path: '/master/companies',
  ...tag('Master'),
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});
registry.registerPath({
  method: 'post',
  path: '/master/companies',
  ...tag('Master'),
  request: { body: { content: { 'application/json': { schema: createCompanySchema } } } },
  responses: { ...json200({ type: 'object' }, 'Created company'), ...commonErrors },
});
registry.registerPath({
  method: 'get',
  path: '/master/operators',
  ...tag('Master'),
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});
registry.registerPath({
  method: 'post',
  path: '/master/operators',
  ...tag('Master'),
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});
registry.registerPath({
  method: 'post',
  path: '/master/demo-login',
  ...tag('Master'),
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});
registry.registerPath({
  method: 'post',
  path: '/master/impersonate/{id}',
  ...tag('Master'),
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});
registry.registerPath({
  method: 'post',
  path: '/master/stop-impersonation',
  ...tag('Master'),
  responses: { ...json200({ type: 'object' }), ...commonErrors },
});

// ── Health & metrics ──
registry.registerPath({
  method: 'get',
  path: '/health',
  ...tag('Health'),
  responses: { ...json200({ type: 'object' }), 503: { description: 'Unhealthy' } },
});
registry.registerPath({
  method: 'get',
  path: '/metrics',
  ...tag('Health'),
  responses: { 200: { description: 'Prometheus text format' } },
});

export function buildOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(registry.definitions as never);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'TimeTrack API',
      version: '1.0.0',
      description:
        'Multi-tenant workforce management API. Served under both /api (legacy) and /api/v1 (contract surface). ' +
        'Pagination envelope: { items, total, limit, offset } with X-Total-Count / X-Limit / X-Offset headers.',
    },
    servers: [{ url: '/api/v1' }],
    tags: [
      { name: 'Auth' },
      { name: 'Employees' },
      { name: 'Shifts' },
      { name: 'Time entries' },
      { name: 'Dashboard' },
      { name: 'Reports' },
      { name: 'Settings' },
      { name: 'Audit' },
      { name: 'Master' },
      { name: 'Health' },
    ],
  });
}
