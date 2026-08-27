/**
 * Manager Scope Rules — Pure Logic Module
 * ========================================
 * Decision logic for manager data scope, extracted from middleware/scope.ts
 * for unit testability.
 *
 * SECURITY: the default placeholder values must never create a visibility
 * bridge — a manager left on default branch/department must NOT automatically
 * see every other employee who also has default values. Same-branch+dept
 * scoping only applies with an explicit (non-default) assignment.
 */

export const DEFAULT_BRANCH = 'Unassigned';
export const DEFAULT_DEPARTMENT = 'General';

export interface ScopeActor {
  id: string;
  branch: string | null;
  department: string | null;
}

export interface ScopeTarget {
  managerId: string | null;
  branch: string | null;
  department: string | null;
}

/** True only when BOTH branch and department are explicit (non-default). */
export function hasExplicitAssignment(
  branch: string | null | undefined,
  department: string | null | undefined,
): boolean {
  return Boolean(
    branch && branch !== DEFAULT_BRANCH &&
    department && department !== DEFAULT_DEPARTMENT,
  );
}

/**
 * Pure scope decision: is `target` visible to `manager`?
 * A target is in scope when it is a direct report, OR the manager has an
 * explicit branch+department assignment that matches the target's.
 */
export function isTargetInManagerScope(manager: ScopeActor, target: ScopeTarget): boolean {
  // Direct reports are always in scope.
  if (target.managerId === manager.id) return true;

  // Same branch + department — only with an explicit (non-default)
  // assignment, preventing the default-value visibility bridge.
  return (
    hasExplicitAssignment(manager.branch, manager.department) &&
    target.branch === manager.branch &&
    target.department === manager.department
  );
}

/**
 * Build Prisma `OR` clauses for a manager's employee scope (pure — no DB).
 * Mirrors isTargetInManagerScope for list queries.
 */
export function buildManagerScopeClauses(manager: ScopeActor): Record<string, unknown>[] {
  const clauses: Record<string, unknown>[] = [{ managerId: manager.id }];

  if (hasExplicitAssignment(manager.branch, manager.department)) {
    clauses.push({
      AND: [{ branch: manager.branch }, { department: manager.department }],
    });
  }

  return clauses;
}
