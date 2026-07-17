// @ts-nocheck
import { useState, useEffect } from "react";
import { client } from "@/api/Client";
import { useDemoRole } from "@/context/DemoRoleContext";

/**
 * Determines the current user's role by looking up their Employee record.
 * Falls back to the User entity role if no Employee record exists.
 *
 * When inside a DemoRoleProvider, the role is overridden by the demo role
 * so the Demo page can simulate different user types. The actualRole field
 * always reflects the true logged-in role.
 *
 * Permission hierarchy:
 *  - admin: full access (all pages, settings, employee management)
 *  - manager: workforce management + reports, but NO settings/parameters
 *  - employee: clock in/out + view own history only
 */
export function useUserRole() {
  const { demoRole } = useDemoRole();
  const [user, setUser] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const me = await client.auth.me();
        setUser(me);
        if (me?.email) {
          const matches = await client.entities.Employee.filter(
            { email: me.email },
            "-created_date",
            1
          );
          if (matches.length > 0) setEmployee(matches[0]);
        }
      } catch {
        // not logged in
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Use Employee role if set; fall back to User role (admin → admin, else employee)
  const actualRole = employee?.role || (user?.role === "admin" ? "admin" : "employee");
  const role = demoRole || actualRole;

  return {
    user,
    employee,
    role,
    actualRole,
    loading,
    isAdmin: role === "admin",
    isManager: role === "manager",
    isEmployee: role === "employee",
    canManage: role === "admin" || role === "manager",
    canConfigure: role === "admin",
  };
}