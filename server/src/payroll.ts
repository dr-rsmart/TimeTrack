/**
 * Payroll Rule Engine
 * -------------------
 * Centralized module for payroll/overtime calculation rules.
 * Uses decimal.js for high-precision arithmetic to eliminate
 * floating-point rounding errors in pay-rate conversions.
 */

import Decimal from 'decimal.js';

// ── Multiplier & threshold defaults ──
export const DEFAULT_OVERTIME_THRESHOLD_HOURS = 8;
export const DEFAULT_SUNDAY_MULTIPLIER = 1.5;
export const DEFAULT_HOLIDAY_MULTIPLIER = 2.0;
export const DEFAULT_MONTHLY_THRESHOLD_HOURS = 195;

// ── Leave types that should NOT contribute to overtime ──
export const LEAVE_TYPES = new Set([
  'Holiday',
  'Leave',
  'Sick',
  'PTO',
  'Unpaid',
  'Bereavement',
  'Maternity',
  'Paternity',
]);

/** Normalise a leave-type string to its canonical form or null if it's regular work. */
export function normaliseLeaveType(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  for (const lt of LEAVE_TYPES) {
    if (lt.toLowerCase() === trimmed.toLowerCase()) return lt;
  }
  return null;
}

export interface PayrollSettings {
  overtimeThresholdHours: number;
  useMonthlyOvertimeThreshold: boolean;
  monthlyOvertimeThresholdHours: number;
  sundayOvertimeEnabled: boolean;
  sundayOvertimeMultiplier: number;
  publicHolidayOvertimeEnabled: boolean;
  publicHolidayOvertimeMultiplier: number;
  publicHolidays: string[];
}

export function defaultSettings(): PayrollSettings {
  return {
    overtimeThresholdHours: DEFAULT_OVERTIME_THRESHOLD_HOURS,
    useMonthlyOvertimeThreshold: false,
    monthlyOvertimeThresholdHours: DEFAULT_MONTHLY_THRESHOLD_HOURS,
    sundayOvertimeEnabled: true,
    sundayOvertimeMultiplier: DEFAULT_SUNDAY_MULTIPLIER,
    publicHolidayOvertimeEnabled: true,
    publicHolidayOvertimeMultiplier: DEFAULT_HOLIDAY_MULTIPLIER,
    publicHolidays: [],
  };
}

export interface OvertimeResult {
  ordinaryHours: number;
  dailyOvertimeHours: number;
  sundayOvertimeHours: number;
  holidayOvertimeHours: number;
  monthlyOvertimeHours: number;
  totalOvertimeHours: number;
  sundayWeightedOvertime: number;
  holidayWeightedOvertime: number;
  totalWeightedOvertime: number;
  totalHours: number;
}

const D = (v: number | string): Decimal => new Decimal(v);
const toNum = (d: Decimal): number => parseFloat(d.toFixed(2));

/**
 * Calculate overtime breakdown from per-date hour totals.
 * All internal arithmetic uses Decimal for high precision;
 * results are converted to float at the boundary.
 *
 * @param byDate          – Record of date string (YYYY-MM-DD) → total hours for that day
 * @param shiftTypeByDate – (optional) Record of date → shift_type string (e.g. "Leave", "Sick")
 * @param settings        – Payroll settings (thresholds, multipliers, holidays)
 */
export function computeOvertime(
  byDate: Record<string, number>,
  shiftTypeByDate: Record<string, string | null | undefined> | undefined,
  settings: PayrollSettings,
): OvertimeResult {
  const {
    overtimeThresholdHours,
    useMonthlyOvertimeThreshold,
    monthlyOvertimeThresholdHours,
    sundayOvertimeEnabled,
    sundayOvertimeMultiplier,
    publicHolidayOvertimeEnabled,
    publicHolidayOvertimeMultiplier,
    publicHolidays,
  } = settings;

  const holidaySet = new Set(publicHolidays);

  let ordinaryHours = D(0);
  let dailyOvertimeHours = D(0);
  let sundayOvertimeHours = D(0);
  let holidayOvertimeHours = D(0);
  let monthlyOvertimeHours = D(0);

  const monthlyOrdinary: Record<string, Decimal> = {};
  const sortedDates = Object.keys(byDate).sort();

  const threshold = D(overtimeThresholdHours);
  const monthlyThreshold = D(monthlyOvertimeThresholdHours);
  const sundayMult = D(sundayOvertimeMultiplier);
  const holidayMult = D(publicHolidayOvertimeMultiplier);

  for (const date of sortedDates) {
    const dayHours = D(byDate[date]);
    if (dayHours.lte(0)) continue;

    const dt = new Date(date + 'T00:00:00');
    const monthKey = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    const isSunday = dt.getDay() === 0;
    const isHoliday = holidaySet.has(date);
    const leaveType = shiftTypeByDate ? normaliseLeaveType(shiftTypeByDate[date]) : null;

    if (!monthlyOrdinary[monthKey]) monthlyOrdinary[monthKey] = D(0);

    // Leave hours: count as ordinary (do NOT generate overtime)
    if (leaveType) {
      ordinaryHours = ordinaryHours.plus(dayHours);
      monthlyOrdinary[monthKey] = monthlyOrdinary[monthKey].plus(dayHours);
      continue;
    }

    // Public Holiday multiplier takes precedence over Sunday
    if (isHoliday && publicHolidayOvertimeEnabled) {
      holidayOvertimeHours = holidayOvertimeHours.plus(dayHours);
    } else if (isSunday && sundayOvertimeEnabled) {
      sundayOvertimeHours = sundayOvertimeHours.plus(dayHours);
    } else {
      if (dayHours.lte(threshold)) {
        ordinaryHours = ordinaryHours.plus(dayHours);
        monthlyOrdinary[monthKey] = monthlyOrdinary[monthKey].plus(dayHours);
      } else {
        ordinaryHours = ordinaryHours.plus(threshold);
        monthlyOrdinary[monthKey] = monthlyOrdinary[monthKey].plus(threshold);
        const diff = dayHours.minus(threshold);
        dailyOvertimeHours = dailyOvertimeHours.plus(diff);
      }
    }
  }

  if (useMonthlyOvertimeThreshold) {
    for (const hours of Object.values(monthlyOrdinary)) {
      if (hours.gt(monthlyThreshold)) {
        const excess = hours.minus(monthlyThreshold);
        monthlyOvertimeHours = monthlyOvertimeHours.plus(excess);
        ordinaryHours = ordinaryHours.minus(excess);
      }
    }
  }

  const sundayWeighted = sundayOvertimeHours.times(sundayMult);
  const holidayWeighted = holidayOvertimeHours.times(holidayMult);
  const totalOvertimeHours = dailyOvertimeHours
    .plus(sundayOvertimeHours)
    .plus(holidayOvertimeHours)
    .plus(monthlyOvertimeHours);
  const totalWeightedOvertime = dailyOvertimeHours
    .plus(sundayWeighted)
    .plus(holidayWeighted)
    .plus(monthlyOvertimeHours);
  const totalHours = ordinaryHours.plus(totalOvertimeHours);

  return {
    ordinaryHours: toNum(ordinaryHours),
    dailyOvertimeHours: toNum(dailyOvertimeHours),
    sundayOvertimeHours: toNum(sundayOvertimeHours),
    holidayOvertimeHours: toNum(holidayOvertimeHours),
    monthlyOvertimeHours: toNum(monthlyOvertimeHours),
    totalOvertimeHours: toNum(totalOvertimeHours),
    sundayWeightedOvertime: toNum(sundayWeighted),
    holidayWeightedOvertime: toNum(holidayWeighted),
    totalWeightedOvertime: toNum(totalWeightedOvertime),
    totalHours: toNum(totalHours),
  };
}