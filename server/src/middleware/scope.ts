/**
 * Manager Scope Middleware
 * ------------------------
 * Determines the data scope for manager users based on
 * manager_id relationships and branch/department assignment.
 */

import prisma from '../prisma.js';
import type { AuthUser } from './auth.js';

/**
 * Default placeholder values for unassigned branch/department.
 * SECURITY: these defaults must never create a visibility bridge — a manager
 * left on default values must NOT automatically see every other employee who
 * also has default values. Same-branch+department scoping only applies when
 * the manager has been explicitly assigned to a real branch AND department.
 */
const DEFAULT_BRANCH = 'Unassigned';
const DEFAULT_DEPARTMENT = 'General';

function hasExplicitAssignment(branch: string | null, department: string | null): boolean {
  return Boolean(
    branch && branch !== DEFAULT_BRANCH &&
    department && department !== DEFAULT_DEPARTMENT,
  );
}

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
    where: { email: authUser.email, companyProfileId: authUser.companyProfileId ?? undefined },
    select: { id: true, branch: true, department: true },
  });

  if (!managerEmployee) return { id: '__no_scope__' };

  // Direct reports are always in scope.
  const clauses: Record<string, unknown>[] = [{ managerId: managerEmployee.id }];

  // Same branch+department only when explicitly assigned (no default leak).
  if (hasExplicitAssignment(managerEmployee.branch, managerEmployee.department)) {
    clauses.push({
      AND: [
        { branch: managerEmployee.branch },
        { department: managerEmployee.department },
      ],
    });
  }

  return { OR: clauses };
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
    where: { email: authUser.email, companyProfileId: authUser.companyProfileId ?? undefined },
    select: { id: true, branch: true, department: true },
  });

  if (!managerEmployee) return false;

  const target = await prisma.employee.findFirst({
    where: { email: employeeEmail, companyProfileId: authUser.companyProfileId ?? undefined },
    select: { id: true, managerId: true, branch: true, department: true },
  });

  if (!target) return false;

  // Direct report
  if (target.managerId === managerEmployee.id) return true;

  // Same branch + department — only when the manager has an explicit
  // (non-default) assignment, preventing the default-value visibility bridge.
  if (
    hasExplicitAssignment(managerEmployee.branch, managerEmployee.department) &&
    target.branch === managerEmployee.branch &&
    target.department === managerEmployee.department
  ) {
    return true;
  }

  return false;
}

/**
 * Check if a geofence is within a manager's scope (by branch association).
 * Geofences are admin-only by default, so managers get denied.
 */
export function isGeofenceInManagerScope(): boolean {
  return false; // Geofences are admin-only
}