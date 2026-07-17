import { client } from "@/api/Client";
import moment from "moment";

/**
 * Fetches the full employee document by email and builds a complete
 * clock-in payload with all profile fields snapshotted. Missing optional
 * fields default to empty strings so clock-in works even if the employee
 * profile isn't fully filled in.
 *
 * @param {string} employeeEmail - Email of the employee to clock in
 * @param {object} actingUser - The authenticated admin/manager user object
 * @param {boolean} isOverride - Whether this is a manual override
 * @returns {Promise<object>} Complete TimeEntry payload
 * @throws {Error} if the employee is not found
 */
export async function buildClockInPayload(employeeEmail, actingUser, isOverride = true) {
  const matches = await client.entities.Employee.filter(
    { email: employeeEmail },
    "-created_date",
    1
  );

  if (!matches || matches.length === 0) {
    throw new Error(`Employee not found for email: ${employeeEmail}`);
  }

  const employee = matches[0];

  // Backfill first_name / surname from full_name if not explicitly set
  let { first_name, surname } = employee;
  if (!first_name || !surname) {
    const parts = (employee.full_name || "").trim().split(/\s+/);
    first_name = first_name || parts[0] || "";
    surname = surname || parts.slice(1).join(" ") || "";
  }

  const now = moment();
  return {
    employee_email: employee.email,
    employee_name: employee.full_name || `${first_name} ${surname}`.trim(),
    first_name,
    surname,
    employee_code: employee.employee_number || "",
    phone: employee.phone || "",
    branch: employee.branch || "",
    department: employee.department || "",
    clock_in: now.toISOString(),
    date: now.format("YYYY-MM-DD"),
    status: "clocked_in",
    is_manual_override: isOverride,
    clocked_by_id: isOverride ? (actingUser?.id || null) : null,
    clocked_by_name: isOverride ? (actingUser?.full_name || actingUser?.email || "Unknown") : null,
  };
}

/**
 * Builds the clock-out payload for an existing active entry.
 * @param {object} activeEntry - The active TimeEntry record
 * @param {object} actingUser - The authenticated admin/manager user object
 * @returns {object} Complete clock-out update payload
 */
export function buildClockOutPayload(activeEntry, actingUser) {
  if (!activeEntry || !activeEntry.id) {
    throw new Error("No active time entry found to clock out.");
  }

  const now = moment();
  const diff = now.diff(moment(activeEntry.clock_in), "minutes");
  const totalHours = Math.max(0, (diff - (activeEntry.break_minutes || 0)) / 60);

  return {
    clock_out: now.toISOString(),
    total_hours: parseFloat(totalHours.toFixed(2)),
    status: "completed",
    is_manual_override: true,
    clocked_by_id: actingUser?.id || null,
    clocked_by_name: actingUser?.full_name || actingUser?.email || "Unknown",
  };
}