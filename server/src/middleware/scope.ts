/**
 * Manager Scope Middleware
 * ------------------------
 * Determines the data scope for manager users based on manager_id
 * relationships and branch/department assignment.
 *
 * The pure decision logic lives in `scopeRules.ts` (unit-tested); this module
 * only resolves the DB records and applies it.
 *
 * SECURITY: the default placeholders ('Unassigned'/'General') must never
 * create a visibility bridge — enforced by hasExplicitAssignment() in
 * scopeRules.ts.
 */

import prisma from '../prisma.js';
import type { AuthUser } from './auth.js';
import { buildManagerScopeClauses, isTargetInManagerScope } from '../scopeRules.js';

/**
 * Build a Prisma `where` filter for employees within a manager's scope.
 * Managers see:
 *   1. Direct reports (employees where manager_id = manager's employee id)
 *   2. Employees in the same branch AND department — ONLY when the manager
 *      has an explicit (non-default) branch and department assignment.
 */
export async function getManagerScopeFilter(
  authUser: AuthUser,
): Promise<Record<string, unknown>> {
  if (authUser.role !== 'manager') return {};

  // Find the manager's employee record
  const managerEmployee = await prisma.employee.findFirst({
    where: { email: { equals: authUser.email.toLowerCase().trim(), mode: 'insensitive' }, companyProfileId: authUser.companyProfileId ?? undefined },
    select: { id: true, branch: true, department: true },
  });

  if (!managerEmployee) return { id: '__no_scope__' };

  return { OR: buildManagerScopeClauses(managerEmployee) };
}

/**
 * Check if a specific employee (by email) is within a manager's scope.
 */
export async function isEmployeeInManagerScope(
  authUser: AuthUser,
  employeeEmail: string,
): Promise<boolean> {
  if (authUser.role !== 'manager') return true;

  const managerEmployee = await prisma.employee.findFirst({
    where: { email: { equals: authUser.email.toLowerCase().trim(), mode: 'insensitive' }, companyProfileId: authUser.companyProfileId ?? undefined },
    select: { id: true, branch: true, department: true },
  });

  if (!managerEmployee) return false;

  const target = await prisma.employee.findFirst({
    where: { email: { equals: employeeEmail.toLowerCase().trim(), mode: 'insensitive' }, companyProfileId: authUser.companyProfileId ?? undefined },
    select: { id: true, managerId: true, branch: true, department: true },
  });

  if (!target) return false;

  return isTargetInManagerScope(
    {
      id: managerEmployee.id,
      branch: managerEmployee.branch,
      department: managerEmployee.department,
    },
    {
      managerId: target.managerId,
      branch: target.branch,
      department: target.department,
    },
  );
}

/**
 * Check if a geofence is within a manager's scope (by branch association).
 * Geofences are admin-only by default, so managers get denied.
 */
export function isGeofenceInManagerScope(): boolean {
  return false; // Geofences are admin-only
}