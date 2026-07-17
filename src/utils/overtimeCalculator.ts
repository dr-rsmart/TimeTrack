import moment from "moment";

/**
 * Calculate overtime breakdown for a set of time entries based on company settings.
 *
 * Rules applied:
 * 1. Daily overtime: hours beyond overtime_threshold_hours per regular workday
 * 2. Sunday overtime: all Sunday hours (multiplier applied for weighted total)
 * 3. Public holiday overtime: all holiday hours (multiplier applied for weighted total)
 * 4. Monthly threshold: when enabled, ordinary hours beyond monthly_overtime_threshold_hours
 *    per calendar month become overtime
 */
export function calculateOvertime(entries, settings = {}) {
  const {
    overtime_threshold_hours = 8,
    use_monthly_overtime_threshold = false,
    monthly_overtime_threshold_hours = 195,
    sunday_overtime_enabled = true,
    sunday_overtime_multiplier = 1.5,
    public_holiday_overtime_enabled = true,
    public_holiday_overtime_multiplier = 2.0,
    public_holidays = [],
  } = settings;

  const holidaySet = new Set(public_holidays);

  // Aggregate hours by date
  const byDate = {};
  entries.forEach((e) => {
    if (!e.date || e.status === "clocked_in") return;
    byDate[e.date] = (byDate[e.date] || 0) + (e.total_hours || 0);
  });

  let ordinaryHours = 0;
  let dailyOvertimeHours = 0;
  let sundayOvertimeHours = 0;
  let holidayOvertimeHours = 0;
  let monthlyOvertimeHours = 0;

  // Track ordinary hours per month for monthly threshold
  const monthlyOrdinary = {};
  const sortedDates = Object.keys(byDate).sort();

  sortedDates.forEach((date) => {
    const dayHours = byDate[date];
    const m = moment(date);
    const monthKey = m.format("YYYY-MM");
    const isSunday = m.format("dddd") === "Sunday";
    const isHoliday = holidaySet.has(date);

    if (!monthlyOrdinary[monthKey]) monthlyOrdinary[monthKey] = 0;

    if (isHoliday && public_holiday_overtime_enabled) {
      holidayOvertimeHours += dayHours;
    } else if (isSunday && sunday_overtime_enabled) {
      sundayOvertimeHours += dayHours;
    } else {
      if (dayHours <= overtime_threshold_hours) {
        ordinaryHours += dayHours;
        monthlyOrdinary[monthKey] += dayHours;
      } else {
        ordinaryHours += overtime_threshold_hours;
        monthlyOrdinary[monthKey] += overtime_threshold_hours;
        dailyOvertimeHours += dayHours - overtime_threshold_hours;
      }
    }
  });

  // Apply monthly overtime threshold
  if (use_monthly_overtime_threshold) {
    Object.entries(monthlyOrdinary).forEach(([, hours]) => {
      if (hours > monthly_overtime_threshold_hours) {
        const excess = hours - monthly_overtime_threshold_hours;
        monthlyOvertimeHours += excess;
        ordinaryHours -= excess;
      }
    });
  }

  const sundayWeighted = sundayOvertimeHours * sunday_overtime_multiplier;
  const holidayWeighted = holidayOvertimeHours * public_holiday_overtime_multiplier;
  const totalOvertimeHours = dailyOvertimeHours + sundayOvertimeHours + holidayOvertimeHours + monthlyOvertimeHours;
  const totalWeightedOvertime = dailyOvertimeHours + sundayWeighted + holidayWeighted + monthlyOvertimeHours;
  const totalHours = ordinaryHours + totalOvertimeHours;

  return {
    ordinaryHours: parseFloat(ordinaryHours.toFixed(2)),
    dailyOvertimeHours: parseFloat(dailyOvertimeHours.toFixed(2)),
    sundayOvertimeHours: parseFloat(sundayOvertimeHours.toFixed(2)),
    holidayOvertimeHours: parseFloat(holidayOvertimeHours.toFixed(2)),
    monthlyOvertimeHours: parseFloat(monthlyOvertimeHours.toFixed(2)),
    totalOvertimeHours: parseFloat(totalOvertimeHours.toFixed(2)),
    sundayWeightedOvertime: parseFloat(sundayWeighted.toFixed(2)),
    holidayWeightedOvertime: parseFloat(holidayWeighted.toFixed(2)),
    totalWeightedOvertime: parseFloat(totalWeightedOvertime.toFixed(2)),
    totalHours: parseFloat(totalHours.toFixed(2)),
  };
}