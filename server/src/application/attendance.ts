/**
 * Attendance application use cases
 * ---------------------------------
 * HTTP-independent orchestration for clock-in and clock-out. The route layer
 * validates/parses HTTP input and translates these errors into responses; this
 * module owns authorization-aware attendance decisions, persistence, audit, and
 * realtime publication.
 */

import type { TimeEntry } from '@prisma/client';
import prisma from '../prisma.js';
import type { AuthUser } from '../middleware/auth.js';
import { isEmployeeInManagerScope } from '../middleware/scope.js';
import { logAudit } from '../audit.js';
import { broadcastScoped } from '../sse.js';
import {
  validateClockInLocation,
  validateClockOutLocation,
  type GeoPosition,
} from '../geoValidationService.js';
import { getReclockGuardSeconds, isWithinReclockWindow } from '../reclockGuard.js';
import { assertTenantMatch } from '../tenantContext.js';
import { tenantWhere } from '../tenantPolicy.js';
import { ATTENDANCE_STATUS } from '../domain/attendance.js';
import { calculateWorkedDuration } from '../domain/duration.js';
import { recordAutoClockOutcome } from '../metrics.js';
import {
  normalizeEmployeeEmail,
  singleEmployeeIdentityFilter,
} from '../domain/employeeIdentity.js';
import {
  businessNow,
  businessTimeToDate,
  getBusinessTimezone,
  timeStrToMinutes,
} from '../timezone.js';

export interface AttendanceUseCaseErrorOptions {
  status: number;
  code: string;
  details?: Record<string, unknown>;
  suggestions?: string[];
}

/** Structured error that the HTTP adapter can safely translate. */
export class AttendanceUseCaseError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly suggestions?: string[];

  constructor(message: string, options: AttendanceUseCaseErrorOptions) {
    super(message);
    this.name = 'AttendanceUseCaseError';
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.suggestions = options.suggestions;
  }
}

export interface ClockInCommand {
  actor: AuthUser;
  targetEmail?: string;
  position: GeoPosition | null;
  justification?: string;
  /** Offline outbox replay: ORIGINAL device capture instant of the punch. */
  capturedAt?: Date | null;
  /** True when the punch was queued offline and replayed on reconnect. */
  offline?: boolean;
  idempotencyKey?: string | null;
  clientIp: string;
}

export interface ClockOutCommand {
  actor: AuthUser;
  targetEmail?: string;
  position: GeoPosition | null;
  breakMinutes: number;
  /** Offline outbox replay: ORIGINAL device capture instant of the punch. */
  capturedAt?: Date | null;
  /** True when the punch was queued offline and replayed on reconnect. */
  offline?: boolean;
  idempotencyKey?: string | null;
  clientIp: string;
}

export interface AttendanceMutationResult {
  entry: TimeEntry;
  replayed: boolean;
}

export interface ManualTimeEntryCommand {
  actor: AuthUser;
  employeeId: string;
  date: string;
  clockIn: string;
  clockOut: string;
  breakMinutes: number;
  notes?: string;
  clientIp: string;
}

export interface BulkClockInCommand {
  actor: AuthUser;
  employeeEmails: string[];
  justification?: string;
  clientIp: string;
}

export interface BulkClockOutCommand {
  actor: AuthUser;
  employeeEmails: string[];
  breakMinutes: number;
  clientIp: string;
}

export interface AdjustTimeEntryCommand {
  actor: AuthUser;
  id: string;
  date?: string;
  clockIn?: string;
  clockOut?: string;
  breakMinutes?: number | null;
  reason: string;
  clientIp: string;
}

export interface DeleteTimeEntryCommand {
  actor: AuthUser;
  id: string;
  clientIp: string;
}

export interface BulkClockInResult {
  clockedIn: Array<{ email: string; id: string; employeeName: string | null }>;
  skipped: Array<{ email: string; reason: string }>;
}

export interface BulkClockOutResult {
  clockedOut: Array<{
    email: string;
    id: string;
    employeeName: string | null;
    totalHours: number | null;
  }>;
  skipped: Array<{ email: string; reason: string }>;
}

function toDateStr(date: Date): string {
  // TimeEntry DATE values are persisted at UTC noon. Reading the UTC date
  // keeps the business date stable regardless of the server's local timezone.
  return date.toISOString().slice(0, 10);
}

function toBusinessDateStr(date: Date): string {
  return businessNow(getBusinessTimezone(), date).dateStr;
}

function parseDate(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00Z`);
}

function parseClock(date: string, time: string): Date {
  const minutes = timeStrToMinutes(time);
  if (minutes === null) {
    throw new AttendanceUseCaseError('Invalid clock time.', {
      status: 400,
      code: 'BAD_REQUEST',
    });
  }
  // Manual form values are business wall-clock readings, not server-local
  // timestamps. Convert them to an instant in the configured business zone.
  return businessTimeToDate(getBusinessTimezone(), date, minutes);
}

function formatClock(date: Date): string {
  const business = businessNow(getBusinessTimezone(), date);
  return `${String(business.hours).padStart(2, '0')}:${String(business.minutes).padStart(2, '0')}`;
}

function assertEmployeeAccess(actor: AuthUser, companyProfileId: string | null): void {
  if (actor.role !== 'master' && companyProfileId !== actor.companyProfileId) {
    throw new AttendanceUseCaseError('Access denied.', {
      status: 403,
      code: 'ACCESS_DENIED',
    });
  }
}

async function assertManagerEmployeeScope(actor: AuthUser, email: string): Promise<void> {
  if (actor.role !== 'manager') return;
  if (!(await isEmployeeInManagerScope(actor, email))) {
    throw new AttendanceUseCaseError('This employee is outside your management scope.', {
      status: 403,
      code: 'OUT_OF_SCOPE',
    });
  }
}

function assertChronologicalTimes(clockIn: Date, clockOut: Date): void {
  if (clockOut <= clockIn) {
    throw new AttendanceUseCaseError('Clock-out must be after clock-in.', {
      status: 400,
      code: 'BAD_REQUEST',
    });
  }
}

// ── Offline punch acceptance policy ─────────────────────────────────────
// Clients (native shell + web monitor) queue automatic punches that could not
// reach the server and replay them on reconnect with `offline: true` and the
// ORIGINAL capture instant. Acceptance is bounded so stale back-dating can
// never silently enter payroll: beyond the window (or implausibly in the
// future) the punch is rejected with a terminal OFFLINE_PUNCH_EXPIRED error
// and the client drops it from its outbox.

/**
 * Acceptance window (hours) for offline-queued punches.
 * Configurable via OFFLINE_PUNCH_WINDOW_HOURS (default 4).
 */
export function getOfflinePunchWindowHours(): number {
  const raw = process.env.OFFLINE_PUNCH_WINDOW_HOURS;
  if (raw === undefined || raw === null || raw === '') return 4;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4;
}

/** Clock-skew tolerance for queued punches claiming a future capture time. */
const OFFLINE_FUTURE_SKEW_MS = 5 * 60_000;

/**
 * Validate an offline punch's capturedAt claim. Returns the accepted capture
 * instant for `offline: true` punches inside the bounded sync window, null for
 * normal (online) punches, and throws OFFLINE_PUNCH_EXPIRED when the claim is
 * too old or implausibly future-dated (payload integrity / payroll safety).
 */
export function resolveOfflineCapturedAt(command: {
  offline?: boolean;
  capturedAt?: Date | null;
}): Date | null {
  if (!command.offline) return null;
  const capturedAt = command.capturedAt ?? null;
  if (!capturedAt || Number.isNaN(capturedAt.getTime())) return null;
  const now = Date.now();
  const windowMs = getOfflinePunchWindowHours() * 3_600_000;
  if (
    capturedAt.getTime() > now + OFFLINE_FUTURE_SKEW_MS ||
    now - capturedAt.getTime() > windowMs
  ) {
    throw new AttendanceUseCaseError('This offline punch is outside the accepted sync window.', {
      status: 422,
      code: 'OFFLINE_PUNCH_EXPIRED',
      details: {
        captured_at: capturedAt.toISOString(),
        window_hours: getOfflinePunchWindowHours(),
      },
      suggestions: ['Clock in/out manually now, or ask your manager to adjust the time entry.'],
    });
  }
  return capturedAt;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isActiveEntryConflict(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const code = error.code;
  const message = typeof error.message === 'string' ? error.message : '';
  return (
    code === 'DUPLICATE_ACTIVE' ||
    code === 'P2002' ||
    code === 'P2034' ||
    message.includes('uniq_active_time_entry') ||
    message.includes('write conflict') ||
    message.includes('deadlock')
  );
}

function assertReplayTenant(entry: TimeEntry, actor: AuthUser): void {
  assertTenantMatch(entry);
  if (actor.role !== 'master' && entry.companyProfileId !== actor.companyProfileId) {
    throw new AttendanceUseCaseError('Access denied.', {
      status: 403,
      code: 'ACCESS_DENIED',
    });
  }
}

function throwGeofenceViolation(result: {
  distanceMetres?: number;
  geofenceName?: string;
  radiusMetres?: number;
  suggestions?: string[];
}): never {
  throw new AttendanceUseCaseError('You are outside your designated work location.', {
    status: 403,
    code: 'GEOFENCE_VIOLATION',
    details: {
      distance_metres: result.distanceMetres,
      geofence_name: result.geofenceName,
      radius_metres: result.radiusMetres,
    },
    suggestions: result.suggestions,
  });
}

export async function clockIn(command: ClockInCommand): Promise<AttendanceMutationResult> {
  const { actor } = command;
  const actorEmail = normalizeEmployeeEmail(actor.email);
  const targetEmail = normalizeEmployeeEmail(command.targetEmail || actorEmail);
  const canProxy = actor.role === 'admin' || actor.role === 'master' || actor.role === 'manager';
  const isManualOverride = canProxy && targetEmail !== actorEmail;

  if (command.idempotencyKey) {
    const replay = await prisma.timeEntry.findUnique({
      where: { clockInIdempotencyKey: command.idempotencyKey },
    });
    if (replay) {
      assertReplayTenant(replay, actor);
      return { entry: replay, replayed: true };
    }
  }

  // Offline queue replay: accept only within the bounded sync window and stamp
  // the entry at the ORIGINAL capture instant so payroll reflects real time.
  const offlineCapturedAt = resolveOfflineCapturedAt(command);

  let employee = await prisma.employee.findFirst({
    where: {
      ...tenantWhere(actor),
      email: { equals: targetEmail, mode: 'insensitive' },
    },
    include: { geofence: true },
  });

  // Only a self-service request can repair a legacy orphan. Proxy operations
  // fail closed because an orphan email is not a safe tenant identity key.
  if (!employee && actor.companyProfileId && targetEmail === actorEmail) {
    const orphanEmployee = await prisma.employee.findFirst({
      where: {
        email: { equals: targetEmail, mode: 'insensitive' },
        // Legacy orphan repair — only relevant on databases that predate
        // migration 17 (tenant columns NOT NULL). On migrated databases this
        // filter simply matches nothing; the cast keeps the pre-migration
        // runtime behavior intact without weakening the new schema types.
        companyProfileId: null as unknown as string,
      },
      include: { geofence: true },
    });
    if (orphanEmployee) {
      await prisma.employee.update({
        where: { id: orphanEmployee.id },
        data: { companyProfileId: actor.companyProfileId },
      });
      orphanEmployee.companyProfileId = actor.companyProfileId;
      employee = orphanEmployee;
    }
  }

  if (!employee) {
    throw new AttendanceUseCaseError('Employee record not found.', {
      status: 404,
      code: 'NOT_FOUND',
    });
  }

  if (actor.role === 'manager' && targetEmail !== actorEmail) {
    const inScope = await isEmployeeInManagerScope(actor, targetEmail);
    if (!inScope) {
      throw new AttendanceUseCaseError('This employee is outside your management scope.', {
        status: 403,
        code: 'OUT_OF_SCOPE',
      });
    }
  }

  if (!isManualOverride) {
    const guardSeconds = getReclockGuardSeconds();
    if (guardSeconds > 0) {
      const lastCompleted = await prisma.timeEntry.findFirst({
        where: {
          ...tenantWhere(actor),
          ...singleEmployeeIdentityFilter(employee),
          status: ATTENDANCE_STATUS.COMPLETED,
          clockOut: { not: null },
        },
        orderBy: { clockOut: 'desc' },
        select: { clockOut: true, updatedBy: true },
      });
      const systemClosed = lastCompleted?.updatedBy === 'system:cron';
      if (
        !systemClosed &&
        isWithinReclockWindow(
          lastCompleted?.clockOut ?? null,
          offlineCapturedAt ?? new Date(),
          guardSeconds,
        )
      ) {
        throw new AttendanceUseCaseError(
          `You clocked out less than ${guardSeconds} seconds ago. To prevent duplicate records, please wait a moment before clocking in again, or ask a manager to clock you in.`,
          {
            status: 409,
            code: 'RECLOCK_GUARD',
            suggestions: [
              `Wait ${guardSeconds} seconds after your last clock-out and try again.`,
              'If you need to clock in immediately, ask your manager or admin to clock you in manually.',
            ],
          },
        );
      }
    }
  }

  const geoResult = await validateClockInLocation(targetEmail, command.position, {
    isManualOverride,
    requesterRole: actor.role,
    employeeId: employee.id,
  });
  if (!geoResult.passed) throwGeofenceViolation(geoResult);

  const geofenceData: Record<string, unknown> = geoResult.geofenceName
    ? {
        geofenceId: geoResult.geofenceId,
        geofenceName: geoResult.geofenceName,
        geofenceAddress: geoResult.geofenceAddress,
        geofenceLatitude: geoResult.geofenceLatitude,
        geofenceLongitude: geoResult.geofenceLongitude,
        geofenceRadius: geoResult.radiusMetres,
        isAutoGeofence: !isManualOverride,
      }
    : {};

  // Offline replays stamp the entry at the accepted capture instant; the
  // business date derives from the same instant (correct shift-day attribution).
  const now = offlineCapturedAt ?? new Date();
  let entry: TimeEntry;
  try {
    entry = await prisma.$transaction(async (tx) => {
      const existingActive = await tx.timeEntry.findFirst({
        where: {
          ...tenantWhere(actor),
          employeeId: employee.id,
          status: ATTENDANCE_STATUS.ACTIVE,
        },
        select: { id: true },
      });
      if (existingActive) {
        const duplicate = new Error('DUPLICATE_ACTIVE_ENTRY');
        Object.assign(duplicate, { code: 'DUPLICATE_ACTIVE' });
        throw duplicate;
      }

      return tx.timeEntry.create({
        data: {
          employeeId: employee.id,
          employeeEmail: employee.email,
          employeeName: `${employee.firstName} ${employee.surname}`,
          branch: employee.branch,
          department: employee.department,
          clockIn: now,
          date: parseDate(toBusinessDateStr(now)),
          ...(offlineCapturedAt ? { isOfflineSynced: true } : {}),
          status: ATTENDANCE_STATUS.ACTIVE,
          totalMinutes: 0,
          ...(command.idempotencyKey ? { clockInIdempotencyKey: command.idempotencyKey } : {}),
          isManualOverride,
          clockedById: isManualOverride ? actor.id : null,
          clockedByName: isManualOverride ? actor.fullName : null,
          companyProfileId: employee.companyProfileId,
          createdBy: actor.id,
          updatedBy: actor.id,
          ...geofenceData,
        },
      });
    });
  } catch (error) {
    if (isActiveEntryConflict(error)) {
      throw new AttendanceUseCaseError(
        `Employee ${employee.firstName} ${employee.surname} is already clocked in. Clock out before starting a new session.`,
        {
          status: 409,
          code: 'ALREADY_CLOCKED_IN',
          suggestions: ['Clock out the current session before starting a new one.'],
        },
      );
    }
    throw error;
  }

  const changes = isManualOverride
    ? {
        employee_email: { before: null, after: entry.employeeEmail },
        employee_name: { before: null, after: entry.employeeName },
        clock_in: { before: null, after: entry.clockIn.toISOString() },
        is_manual_override: { before: false, after: true },
        clocked_by: { before: null, after: `${actor.fullName} (${actor.email})` },
        geofence_bypassed: { before: null, after: true },
        geo_validation_passed: { before: null, after: geoResult.passed },
        distance_from_geofence: { before: null, after: geoResult.distanceMetres ?? null },
      }
    : undefined;

  await logAudit({
    entity: 'TimeEntry',
    entityId: entry.id,
    action: isManualOverride ? 'override' : 'clock_in',
    actorId: actor.id,
    actorEmail: actor.email,
    actorRole: actor.role,
    justification: isManualOverride
      ? command.justification?.trim().slice(0, 500) ||
        `Manual clock-in for ${employee.firstName} ${employee.surname}`
      : undefined,
    ipAddress: command.clientIp,
    branch: entry.branch,
    department: entry.department,
    changes,
    required: true,
  });

  broadcastScoped('timeEntry', 'clockIn', entry, {
    companyProfileId: entry.companyProfileId,
    branch: entry.branch,
    department: entry.department,
  });

  if (offlineCapturedAt) recordAutoClockOutcome('offline_synced');

  return { entry, replayed: false };
}

export async function clockOut(command: ClockOutCommand): Promise<AttendanceMutationResult> {
  const { actor } = command;
  const actorEmail = normalizeEmployeeEmail(actor.email);

  if (command.idempotencyKey) {
    const replay = await prisma.timeEntry.findUnique({
      where: { clockOutIdempotencyKey: command.idempotencyKey },
    });
    if (replay) {
      assertReplayTenant(replay, actor);
      return { entry: replay, replayed: true };
    }
  }

  // Offline queue replay — bounded acceptance window (resolveOfflineCapturedAt).
  const offlineCapturedAt = resolveOfflineCapturedAt(command);

  const requestedEmail = command.targetEmail
    ? normalizeEmployeeEmail(command.targetEmail)
    : undefined;
  const isForceClockOut =
    actor.role !== 'employee' && Boolean(requestedEmail && requestedEmail !== actorEmail);
  const targetEmail = isForceClockOut ? requestedEmail! : actorEmail;

  const employee = await prisma.employee.findFirst({
    where: {
      ...tenantWhere(actor),
      email: { equals: targetEmail, mode: 'insensitive' },
    },
    select: { id: true, email: true },
  });
  if (!employee) {
    throw new AttendanceUseCaseError('Employee record not found.', {
      status: 404,
      code: 'NOT_FOUND',
    });
  }

  const active = await prisma.timeEntry.findFirst({
    where: {
      ...tenantWhere(actor),
      ...singleEmployeeIdentityFilter(employee),
      status: ATTENDANCE_STATUS.ACTIVE,
    },
    orderBy: { clockIn: 'desc' },
  });
  if (!active) {
    throw new AttendanceUseCaseError('No active clock-in session found.', {
      status: 404,
      code: 'NO_ACTIVE_SESSION',
      suggestions: [
        'The employee may have already clocked out.',
        "Verify the employee's current status.",
      ],
    });
  }

  if (isForceClockOut) {
    const inScope = await isEmployeeInManagerScope(actor, targetEmail);
    if (!inScope) {
      throw new AttendanceUseCaseError('This employee is outside your management scope.', {
        status: 403,
        code: 'OUT_OF_SCOPE',
      });
    }
  }

  if (!isForceClockOut) {
    const geoResult = await validateClockOutLocation(targetEmail, command.position, {
      requesterRole: actor.role,
      isManualOverride: false,
      employeeId: employee.id,
    });
    if (!geoResult.passed) throwGeofenceViolation(geoResult);
  }

  // An offline clock-out can never precede its session start; clamp to the
  // clock-in instant (zero duration) if the queue ordering was disturbed.
  const now = offlineCapturedAt
    ? offlineCapturedAt > active.clockIn
      ? offlineCapturedAt
      : active.clockIn
    : new Date();
  const duration = calculateWorkedDuration(active.clockIn, now, command.breakMinutes);
  const entry = await prisma.timeEntry.update({
    where: { id: active.id },
    data: {
      clockOut: now,
      status: ATTENDANCE_STATUS.COMPLETED,
      ...(offlineCapturedAt ? { isOfflineSynced: true } : {}),
      ...(command.idempotencyKey ? { clockOutIdempotencyKey: command.idempotencyKey } : {}),
      breakMinutes: command.breakMinutes,
      totalMinutes: duration.totalMinutes,
      totalHours: duration.totalHours,
      updatedBy: actor.id,
    },
  });

  if (offlineCapturedAt) recordAutoClockOutcome('offline_synced');

  const changes = isForceClockOut
    ? {
        clock_out: { before: null, after: entry.clockOut?.toISOString() },
        status: { before: ATTENDANCE_STATUS.ACTIVE, after: ATTENDANCE_STATUS.COMPLETED },
        total_hours: { before: null, after: entry.totalHours },
        forced_by: { before: null, after: `${actor.fullName} (${actor.email})` },
      }
    : undefined;

  await logAudit({
    entity: 'TimeEntry',
    entityId: entry.id,
    action: isForceClockOut ? 'force_clock_out' : 'clock_out',
    actorId: actor.id,
    actorEmail: actor.email,
    actorRole: actor.role,
    justification: isForceClockOut ? `Force clock-out for ${active.employeeEmail}` : undefined,
    ipAddress: command.clientIp,
    branch: entry.branch,
    department: entry.department,
    changes,
    required: true,
  });

  broadcastScoped('timeEntry', 'clockOut', entry, {
    companyProfileId: entry.companyProfileId,
    branch: entry.branch,
    department: entry.department,
  });

  return { entry, replayed: false };
}

export async function createManualTimeEntry(command: ManualTimeEntryCommand): Promise<TimeEntry> {
  const employee = await prisma.employee.findUnique({ where: { id: command.employeeId } });
  if (!employee) {
    throw new AttendanceUseCaseError('Employee not found.', { status: 404, code: 'NOT_FOUND' });
  }

  await assertManagerEmployeeScope(command.actor, employee.email);
  assertEmployeeAccess(command.actor, employee.companyProfileId);

  const clockIn = parseClock(command.date, command.clockIn);
  const clockOut = parseClock(command.date, command.clockOut);
  assertChronologicalTimes(clockIn, clockOut);
  const duration = calculateWorkedDuration(clockIn, clockOut, command.breakMinutes);

  const entry = await prisma.timeEntry.create({
    data: {
      employeeId: employee.id,
      employeeEmail: employee.email,
      employeeName: `${employee.firstName} ${employee.surname}`,
      branch: employee.branch,
      department: employee.department,
      clockIn,
      clockOut,
      date: parseDate(command.date),
      totalMinutes: duration.totalMinutes,
      totalHours: duration.totalHours,
      status: ATTENDANCE_STATUS.COMPLETED,
      breakMinutes: command.breakMinutes,
      isManualOverride: true,
      clockedById: command.actor.id,
      clockedByName: command.actor.fullName,
      companyProfileId: employee.companyProfileId,
      createdBy: command.actor.id,
      updatedBy: command.actor.id,
    },
  });

  const notes = command.notes?.trim().slice(0, 2000) ?? '';
  await logAudit({
    entity: 'TimeEntry',
    entityId: entry.id,
    action: 'manual_create',
    actorId: command.actor.id,
    actorEmail: command.actor.email,
    actorRole: command.actor.role,
    justification: notes
      ? `Manual time entry for ${employee.firstName} ${employee.surname} on ${command.date}: ${notes}`
      : `Manual time entry for ${employee.firstName} ${employee.surname} on ${command.date}`,
    ipAddress: command.clientIp,
    branch: entry.branch,
    department: entry.department,
    changes: {
      employee_email: { before: null, after: entry.employeeEmail },
      employee_name: { before: null, after: entry.employeeName },
      date: { before: null, after: command.date },
      clock_in: { before: null, after: entry.clockIn.toISOString() },
      clock_out: { before: null, after: entry.clockOut?.toISOString() },
      total_hours: { before: null, after: entry.totalHours },
      break_minutes: { before: null, after: entry.breakMinutes },
      is_manual_override: { before: false, after: true },
      created_by: { before: null, after: `${command.actor.fullName} (${command.actor.email})` },
    },
    required: true,
  });

  broadcastScoped('timeEntry', 'create', entry, {
    companyProfileId: entry.companyProfileId,
    branch: entry.branch,
    department: entry.department,
  });

  return entry;
}

export async function bulkClockIn(command: BulkClockInCommand): Promise<BulkClockInResult> {
  const now = new Date();
  const clockedIn: BulkClockInResult['clockedIn'] = [];
  const skipped: BulkClockInResult['skipped'] = [];
  const audits: Array<Promise<void>> = [];

  for (const rawEmail of command.employeeEmails) {
    const email = rawEmail.toLowerCase().trim();
    const employee = await prisma.employee.findFirst({
      where: { email, companyProfileId: command.actor.companyProfileId ?? undefined },
    });
    if (!employee) {
      skipped.push({ email: rawEmail, reason: 'Employee not found in your company' });
      continue;
    }

    try {
      await assertManagerEmployeeScope(command.actor, email);
      const entry = await prisma.$transaction(async (tx) => {
        const existingActive = await tx.timeEntry.findFirst({
          where: {
            ...tenantWhere(command.actor),
            ...singleEmployeeIdentityFilter(employee),
            status: ATTENDANCE_STATUS.ACTIVE,
          },
          select: { id: true },
        });
        if (existingActive) {
          const duplicate = new Error('DUPLICATE_ACTIVE_ENTRY');
          Object.assign(duplicate, { code: 'DUPLICATE_ACTIVE' });
          throw duplicate;
        }
        return tx.timeEntry.create({
          data: {
            employeeId: employee.id,
            employeeEmail: email,
            employeeName: `${employee.firstName} ${employee.surname}`,
            branch: employee.branch,
            department: employee.department,
            clockIn: now,
            date: parseDate(toBusinessDateStr(now)),
            status: ATTENDANCE_STATUS.ACTIVE,
            totalMinutes: 0,
            isManualOverride: true,
            clockedById: command.actor.id,
            clockedByName: command.actor.fullName,
            companyProfileId: employee.companyProfileId,
            createdBy: command.actor.id,
            updatedBy: command.actor.id,
          },
        });
      });

      clockedIn.push({ email, id: entry.id, employeeName: entry.employeeName });
      audits.push(
        logAudit({
          entity: 'TimeEntry',
          entityId: entry.id,
          action: 'bulk_clock_in',
          actorId: command.actor.id,
          actorEmail: command.actor.email,
          actorRole: command.actor.role,
          justification:
            command.justification?.trim().slice(0, 500) ||
            `Bulk proxy clock-in for ${employee.firstName} ${employee.surname}`,
          ipAddress: command.clientIp,
          branch: entry.branch,
          department: entry.department,
          changes: {
            employee_email: { before: null, after: email },
            employee_name: { before: null, after: entry.employeeName },
            clock_in: { before: null, after: entry.clockIn.toISOString() },
            is_manual_override: { before: false, after: true },
            clocked_by: {
              before: null,
              after: `${command.actor.fullName} (${command.actor.email})`,
            },
          },
          required: true,
        }),
      );
      broadcastScoped('timeEntry', 'clockIn', entry, {
        companyProfileId: entry.companyProfileId,
        branch: entry.branch,
        department: entry.department,
      });
    } catch (error) {
      if (isActiveEntryConflict(error))
        skipped.push({ email: rawEmail, reason: 'Already clocked in' });
      else if (error instanceof AttendanceUseCaseError && error.code === 'OUT_OF_SCOPE')
        skipped.push({ email: rawEmail, reason: 'Outside your management scope' });
      else throw error;
    }
  }

  await Promise.all(audits);
  return { clockedIn, skipped };
}

export async function bulkClockOut(command: BulkClockOutCommand): Promise<BulkClockOutResult> {
  const now = new Date();
  const clockedOut: BulkClockOutResult['clockedOut'] = [];
  const skipped: BulkClockOutResult['skipped'] = [];
  const audits: Array<Promise<void>> = [];

  for (const rawEmail of command.employeeEmails) {
    const email = rawEmail.toLowerCase().trim();
    try {
      await assertManagerEmployeeScope(command.actor, email);
      const employee = await prisma.employee.findFirst({
        where: { email, companyProfileId: command.actor.companyProfileId ?? undefined },
        select: { id: true, email: true },
      });
      if (!employee) {
        skipped.push({ email: rawEmail, reason: 'Employee not found in your company' });
        continue;
      }
      const active = await prisma.timeEntry.findFirst({
        where: {
          ...tenantWhere(command.actor),
          ...singleEmployeeIdentityFilter(employee),
          status: ATTENDANCE_STATUS.ACTIVE,
        },
        orderBy: { clockIn: 'desc' },
      });
      if (!active) {
        skipped.push({ email: rawEmail, reason: 'No active session' });
        continue;
      }

      const entry = await prisma.timeEntry.update({
        where: { id: active.id },
        data: {
          clockOut: now,
          status: ATTENDANCE_STATUS.COMPLETED,
          breakMinutes: command.breakMinutes,
          ...calculateWorkedDuration(active.clockIn, now, command.breakMinutes),
          updatedBy: command.actor.id,
        },
      });
      clockedOut.push({
        email,
        id: entry.id,
        employeeName: entry.employeeName,
        totalHours: entry.totalHours,
      });
      audits.push(
        logAudit({
          entity: 'TimeEntry',
          entityId: entry.id,
          action: 'bulk_clock_out',
          actorId: command.actor.id,
          actorEmail: command.actor.email,
          actorRole: command.actor.role,
          justification: `Bulk force clock-out for ${email}`,
          ipAddress: command.clientIp,
          branch: entry.branch,
          department: entry.department,
          changes: {
            clock_out: { before: null, after: entry.clockOut?.toISOString() },
            status: { before: ATTENDANCE_STATUS.ACTIVE, after: ATTENDANCE_STATUS.COMPLETED },
            total_hours: { before: null, after: entry.totalHours },
            forced_by: {
              before: null,
              after: `${command.actor.fullName} (${command.actor.email})`,
            },
          },
          required: true,
        }),
      );
      broadcastScoped('timeEntry', 'clockOut', entry, {
        companyProfileId: entry.companyProfileId,
        branch: entry.branch,
        department: entry.department,
      });
    } catch (error) {
      if (error instanceof AttendanceUseCaseError && error.code === 'OUT_OF_SCOPE')
        skipped.push({ email: rawEmail, reason: 'Outside your management scope' });
      else throw error;
    }
  }

  await Promise.all(audits);
  return { clockedOut, skipped };
}

export async function adjustTimeEntry(command: AdjustTimeEntryCommand): Promise<TimeEntry> {
  const existing = await prisma.timeEntry.findUnique({ where: { id: command.id } });
  if (!existing) {
    throw new AttendanceUseCaseError('Time entry not found.', { status: 404, code: 'NOT_FOUND' });
  }

  assertTenantMatch(existing);
  assertEmployeeAccess(command.actor, existing.companyProfileId);
  await assertManagerEmployeeScope(command.actor, existing.employeeEmail);

  const entryDateStr = command.date ?? toDateStr(existing.date);
  const existingClockIn = formatClock(existing.clockIn);
  const existingClockOut = existing.clockOut ? formatClock(existing.clockOut) : null;
  const effectiveClockIn = command.clockIn ?? existingClockIn;
  const effectiveClockOut = command.clockOut ?? existingClockOut;
  const effectiveBreakMinutes =
    command.breakMinutes !== undefined ? (command.breakMinutes ?? 0) : (existing.breakMinutes ?? 0);
  const clockIn = parseClock(entryDateStr, effectiveClockIn);
  const clockOut = effectiveClockOut ? parseClock(entryDateStr, effectiveClockOut) : null;

  if (clockOut) assertChronologicalTimes(clockIn, clockOut);

  const status = clockOut ? ATTENDANCE_STATUS.COMPLETED : existing.status;
  const duration = clockOut
    ? calculateWorkedDuration(clockIn, clockOut, effectiveBreakMinutes)
    : null;
  const totalMinutes = duration?.totalMinutes ?? existing.totalMinutes;
  const totalHours = duration?.totalHours ?? existing.totalHours;
  const reason = command.reason.trim().slice(0, 2000);

  const entry = await prisma.timeEntry.update({
    where: { id: command.id },
    data: {
      date: parseDate(entryDateStr),
      clockIn,
      clockOut,
      breakMinutes: effectiveBreakMinutes,
      totalMinutes,
      totalHours,
      status,
      isManuallyAdjusted: true,
      adjustedById: command.actor.id,
      adjustedByName: command.actor.fullName,
      adjustmentReason: reason,
      updatedBy: command.actor.id,
    },
  });

  await logAudit({
    entity: 'TimeEntry',
    entityId: entry.id,
    action: 'manual_adjust',
    actorId: command.actor.id,
    actorEmail: command.actor.email,
    actorRole: command.actor.role,
    justification: `Manual adjustment for ${existing.employeeName ?? existing.employeeEmail}: ${reason}`,
    ipAddress: command.clientIp,
    branch: entry.branch,
    department: entry.department,
    changes: {
      date: { before: toDateStr(existing.date), after: entryDateStr },
      clock_in: { before: existing.clockIn.toISOString(), after: entry.clockIn.toISOString() },
      clock_out: {
        before: existing.clockOut?.toISOString() ?? null,
        after: entry.clockOut?.toISOString() ?? null,
      },
      break_minutes: { before: existing.breakMinutes, after: entry.breakMinutes },
      total_hours: { before: existing.totalHours, after: entry.totalHours },
      status: { before: existing.status, after: entry.status },
      is_manually_adjusted: { before: existing.isManuallyAdjusted, after: true },
      adjusted_by: { before: null, after: `${command.actor.fullName} (${command.actor.email})` },
    },
    required: true,
  });

  broadcastScoped('timeEntry', 'update', entry, {
    companyProfileId: entry.companyProfileId,
    branch: entry.branch,
    department: entry.department,
  });

  return entry;
}

export async function deleteTimeEntry(command: DeleteTimeEntryCommand): Promise<{ id: string }> {
  const existing = await prisma.timeEntry.findUnique({ where: { id: command.id } });
  if (!existing) {
    throw new AttendanceUseCaseError('Time entry not found.', { status: 404, code: 'NOT_FOUND' });
  }

  assertTenantMatch(existing);
  assertEmployeeAccess(command.actor, existing.companyProfileId);
  await assertManagerEmployeeScope(command.actor, existing.employeeEmail);

  await prisma.timeEntry.delete({ where: { id: command.id } });

  await logAudit({
    entity: 'TimeEntry',
    entityId: command.id,
    action: 'delete',
    actorId: command.actor.id,
    actorEmail: command.actor.email,
    actorRole: command.actor.role,
    justification: `Deleted time entry for ${existing.employeeEmail}`,
    ipAddress: command.clientIp,
    branch: existing.branch,
    department: existing.department,
    changes: {
      employee_email: { before: existing.employeeEmail, after: null },
      employee_name: { before: existing.employeeName, after: null },
      date: { before: existing.date.toISOString().slice(0, 10), after: null },
      clock_in: { before: existing.clockIn.toISOString(), after: null },
      clock_out: { before: existing.clockOut?.toISOString() ?? null, after: null },
      total_hours: { before: existing.totalHours, after: null },
      status: { before: existing.status, after: null },
      is_manual_override: { before: existing.isManualOverride, after: null },
    },
    required: true,
  });

  broadcastScoped(
    'timeEntry',
    'delete',
    { id: command.id },
    {
      companyProfileId: existing.companyProfileId,
      branch: existing.branch,
      department: existing.department,
    },
  );

  return { id: command.id };
}
