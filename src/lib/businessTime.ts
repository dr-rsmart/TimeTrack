/** Business-timezone formatting helpers shared by attendance UI. */

export const DEFAULT_BUSINESS_TIMEZONE = 'Africa/Johannesburg';

function getParts(value: string | Date, timeZone: string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const result: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) result[part.type] = part.value;
  return result;
}

export function businessDateString(
  value: string | Date,
  timeZone = DEFAULT_BUSINESS_TIMEZONE,
): string {
  const result = getParts(value, timeZone);
  if (!result) return '—';
  return `${result.year}-${result.month}-${result.day}`;
}

export function businessTimeString(
  value: string | Date | null | undefined,
  timeZone = DEFAULT_BUSINESS_TIMEZONE,
): string {
  if (!value) return '—';
  const result = getParts(value, timeZone);
  if (!result) return '—';
  return `${result.hour}:${result.minute}`;
}

/** Convert a business wall-clock HH:mm into minutes since midnight. */
export function timeToMinutes(value: string): number | null {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

export function businessHour(
  value: string | Date = new Date(),
  timeZone = DEFAULT_BUSINESS_TIMEZONE,
): number | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  }).format(date);
  return Number(hour) % 24;
}
