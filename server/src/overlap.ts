/**
 * Shift Overlap Detection — Pure Logic Module
 * ============================================
 * Extracted from routes/shifts.ts for unit testability.
 * Overlap rule: newStart < existingEnd && newEnd > existingStart
 */

export interface ShiftTimeWindow {
  startTime: string | null;
  endTime: string | null;
}

/**
 * Check if two time windows overlap.
 * Times are HH:MM strings compared lexicographically (valid for 24h format).
 * Overlap if: newStart < existingEnd && newEnd > existingStart
 */
export function timesOverlap(
  newStart: string,
  newEnd: string,
  existingStart: string,
  existingEnd: string,
): boolean {
  return newStart < existingEnd && newEnd > existingStart;
}

/**
 * Count how many existing shifts overlap with the proposed time window.
 * Skips shifts with null start/end times.
 */
export function countOverlaps(
  proposedStart: string | null,
  proposedEnd: string | null,
  existingShifts: ShiftTimeWindow[],
): number {
  if (!proposedStart || !proposedEnd) return 0;

  let overlaps = 0;
  for (const s of existingShifts) {
    if (!s.startTime || !s.endTime) continue;
    if (timesOverlap(proposedStart, proposedEnd, s.startTime, s.endTime)) {
      overlaps++;
    }
  }
  return overlaps;
}

/**
 * Validate that a proposed time window is well-formed.
 * Returns true if start < end (both HH:MM format).
 */
export function isValidTimeWindow(start: string, end: string): boolean {
  return start < end;
}

/**
 * Safely parse a YYYY-MM-DD string into a Date for PostgreSQL DATE columns.
 * Uses UTC noon to prevent timezone-induced date shifting.
 */
export function parseDate(dateStr: string): Date {
  return new Date(dateStr + 'T12:00:00Z');
}