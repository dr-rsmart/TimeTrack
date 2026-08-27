/**
 * Zod Validation Schemas & Middleware
 * -----------------------------------
 * Server-side input validation on all mutation endpoints.
 */

import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

// ── Shared field schemas ──
const emailSchema = z.string().email().max(255).transform((v) => v.toLowerCase());
const dateStrSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeStrSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const latSchema = z.number().min(-90).max(90);
const lngSchema = z.number().min(-180).max(180);

// ── Auth ──
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(255),
});

/**
 * Password complexity rules for new/changed passwords.
 * Minimum 8 chars with at least one uppercase, one lowercase and one digit.
 */
export const newPasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters long.')
  .max(128)
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter.')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter.')
  .regex(/[0-9]/, 'Password must contain at least one number.');

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(255),
  newPassword: newPasswordSchema,
});

// ── Employees ──
export const createEmployeeSchema = z.object({
  firstName: z.string().min(1).max(100),
  surname: z.string().min(1).max(100),
  email: emailSchema,
  position: z.string().max(100).nullish(),
  role: z.enum(['admin', 'manager', 'employee']).default('employee'),
  employeeNumber: z.string().max(50).nullish(),
  phone: z.string().max(30).nullish(),
  branch: z.string().max(100).default('Unassigned'),
  department: z.string().max(100).default('General'),
  hireDate: dateStrSchema.nullish(),
  salaryInfo: z.record(z.string(), z.unknown()).nullish(),
  jurisdiction: z.string().max(50).nullish(),
  taxId: z.string().max(50).nullish(),
  employmentType: z.string().max(50).nullish(),
  managerId: z.string().nullish(),
  geofenceId: z.string().nullish(),
});

export const updateEmployeeSchema = createEmployeeSchema
  .partial()
  .extend({ version: z.number().int().optional() });

// ── Bulk Employee Import (CSV bulk onboarding) ──
/**
 * Per-row schema for bulk onboarding. Derived from the single-create schema
 * so field rules stay in one place; payroll-only and ID-reference fields
 * (salaryInfo, taxId, managerId, geofenceId, …) are intentionally excluded —
 * those stay manage-once-imported.
 */
export const bulkEmployeeRowSchema = createEmployeeSchema.omit({
  salaryInfo: true,
  jurisdiction: true,
  taxId: true,
  employmentType: true,
  managerId: true,
  geofenceId: true,
});

/** Hard cap on rows per import request (keeps payloads well under the 1MB body limit). */
export const BULK_IMPORT_MAX_ROWS = 500;

/**
 * Outer envelope for POST /employees/bulk. Rows are typed loosely here: their
 * shape is validated INDIVIDUALLY inside the import handler so one bad row is
 * reported per-row (partial success) instead of rejecting the whole request.
 * `companyProfileId` is master-only: it selects the target company.
 */
export const bulkCreateEmployeesSchema = z.object({
  rows: z
    .array(z.record(z.string(), z.unknown()))
    .min(1)
    .max(BULK_IMPORT_MAX_ROWS),
  companyProfileId: z.string().max(50).optional(),
});

// ── Shifts ──
export const createShiftSchema = z.object({
  date: dateStrSchema,
  startTime: timeStrSchema.nullish(),
  endTime: timeStrSchema.nullish(),
  shiftType: z
    .enum(['full_day', 'half_day', 'Holiday', 'Leave', 'Sick', 'PTO', 'Unpaid'])
    .default('full_day'),
  employeeId: z.string().nullish(),
  location: z.string().max(255).nullish(),
  notes: z.string().max(2000).nullish(),
  /**
   * Explicit store/branch for the shift. Used for unassigned shifts (which
   * have no employee to derive a branch from); when an employee IS assigned,
   * the route prefers the employee's own branch.
   */
  branch: z.string().max(100).nullish(),
});

export const updateShiftSchema = createShiftSchema.partial().extend({
  status: z.enum(['scheduled', 'active', 'completed', 'cancelled', 'no_show']).optional(),
  version: z.number().int().optional(),
});

/** Maximum number of days a bulk shift assignment (POST /shifts/bulk) may span. */
export const BULK_SHIFT_MAX_DAYS = 366;

/**
 * Expand a bulk-shift date range into an inclusive list of YYYY-MM-DD days.
 * `endDate` omitted (or falsy) → single-day range. Malformed dates, an end
 * before the start, or a range exceeding BULK_SHIFT_MAX_DAYS → error object.
 * Pure function (unit-tested) — uses UTC noon to avoid timezone drift.
 */
export function expandShiftDateRange(
  date: string,
  endDate?: string,
): { ok: true; days: string[] } | { ok: false; error: string; field: string } {
  const from = new Date(date + 'T12:00:00Z');
  const to = new Date((endDate ?? date) + 'T12:00:00Z');
  if (Number.isNaN(from.getTime())) {
    return { ok: false, error: 'A valid start date (YYYY-MM-DD) is required.', field: 'date' };
  }
  if (Number.isNaN(to.getTime())) {
    return { ok: false, error: 'A valid end date (YYYY-MM-DD) is required.', field: 'endDate' };
  }
  if (to.getTime() < from.getTime()) {
    return { ok: false, error: 'End date must be on or after the start date.', field: 'endDate' };
  }
  const dayCount = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
  if (dayCount > BULK_SHIFT_MAX_DAYS) {
    return {
      ok: false,
      error: `Date range is too long: ${dayCount} days. Maximum is ${BULK_SHIFT_MAX_DAYS} days.`,
      field: 'endDate',
    };
  }
  const days: string[] = [];
  for (let i = 0; i < dayCount; i++) {
    const d = new Date(from.getTime() + i * 86400000);
    days.push(d.toISOString().slice(0, 10));
  }
  return { ok: true, days };
}

// ── Time Entries ──
export const clockInSchema = z.object({
  latitude: latSchema.nullish(),
  longitude: lngSchema.nullish(),
  employee_email: emailSchema.optional(),
  justification: z.string().max(500).optional(),
});

export const clockOutSchema = z.object({
  breakMinutes: z.number().int().min(0).max(720).nullish(),
  employee_email: emailSchema.optional(),
  latitude: latSchema.optional(),
  longitude: lngSchema.optional(),
});

export const manualTimeEntrySchema = z.object({
  employeeId: z.string(),
  date: dateStrSchema,
  clockIn: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  clockOut: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  breakMinutes: z.number().int().min(0).max(720).nullish(),
  notes: z.string().max(2000).nullish(),
});

export const bulkClockInSchema = z.object({
  employeeEmails: z.array(emailSchema).min(1).max(100),
  justification: z.string().max(500).optional(),
});

export const bulkClockOutSchema = z.object({
  employeeEmails: z.array(emailSchema).min(1).max(100),
  breakMinutes: z.number().int().min(0).max(720).nullish(),
});

/**
 * Admin/Manager edit of an existing time entry.
 * All fields are optional — only supplied values are updated.
 * `reason` is required so every manual adjustment is auditable.
 */
export const updateTimeEntrySchema = z.object({
  date: dateStrSchema.optional(),
  clockIn: timeStrSchema.optional(),
  clockOut: timeStrSchema.optional(),
  breakMinutes: z.number().int().min(0).max(720).nullish(),
  reason: z.string().min(1, 'A reason is required for manual adjustments.').max(2000),
});

// ── Geofences ──
export const createGeofenceSchema = z.object({
  name: z.string().min(1).max(100),
  address: z.string().max(255).nullish(),
  latitude: latSchema,
  longitude: lngSchema,
  radiusMeters: z.number().int().min(10).max(100000).default(200),
});

export const updateGeofenceSchema = createGeofenceSchema.partial();

// ── Company Settings ──
export const updateSettingsSchema = z.object({
  ordinaryHoursPerDay: z.number().min(1).max(24).optional(),
  overtimeThresholdHours: z.number().min(1).max(24).optional(),
  workDays: z.array(z.string()).optional(),
  useMonthlyOvertimeThreshold: z.boolean().optional(),
  monthlyOvertimeThresholdHours: z.number().min(1).max(500).optional(),
  sundayOvertimeEnabled: z.boolean().optional(),
  sundayOvertimeMultiplier: z.number().min(1).max(5).optional(),
  publicHolidayOvertimeEnabled: z.boolean().optional(),
  publicHolidayOvertimeMultiplier: z.number().min(1).max(5).optional(),
  publicHolidays: z.array(dateStrSchema).optional(),
});

// ── Company Profile ──
export const createCompanySchema = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().max(30).nullish(),
  address: z.string().max(255).nullish(),
  vatNumber: z.string().max(50).nullish(),
  registrationNumber: z.string().max(50).nullish(),
});

/**
 * Validation middleware factory.
 * Validates req.body against the given schema; on failure returns 400.
 */
export function validate(schema: z.ZodType) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation failed.',
        details: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}