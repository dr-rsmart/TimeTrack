/**
 * Employee identity bridge
 * -------------------------
 * `employeeId` is the durable relationship key. `employeeEmail` remains a
 * legacy/display fallback while existing rows are migrated. These helpers keep
 * the transition rules consistent across attendance, reports, and dashboards.
 */

export interface EmployeeIdentity {
  id: string;
  email: string;
}

export function normalizeEmployeeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Prisma-compatible filter that prefers employeeId but still includes legacy
 * rows whose employeeId is null. Legacy email matching is explicitly limited
 * to null employeeId rows so an email change cannot override a linked ID.
 */
export function employeeIdentityFilter(employees: EmployeeIdentity[]): Record<string, unknown> {
  if (employees.length === 0) return { employeeId: '__none__' };

  const ids = employees.map((employee) => employee.id);
  const emails = employees.map((employee) => normalizeEmployeeEmail(employee.email));

  return {
    OR: [
      { employeeId: { in: ids } },
      { employeeId: null, employeeEmail: { in: emails } },
    ],
  };
}

export function identityKey(employeeId: string | null | undefined, email: string): string {
  return employeeId ?? `legacy:${normalizeEmployeeEmail(email)}`;
}

/** Filter for one employee that prefers the relational ID and supports legacy rows. */
export function singleEmployeeIdentityFilter(employee: EmployeeIdentity): Record<string, unknown> {
  return employeeIdentityFilter([employee]);
}