import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { businessDateString, businessTimeString, DEFAULT_BUSINESS_TIMEZONE } from './businessTime';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatHours(hours: number | null | undefined): string {
  if (hours == null) return '—';
  return `${hours.toFixed(2)}h`;
}

export function formatDate(
  dateStr: string | Date | null | undefined,
  timeZone = DEFAULT_BUSINESS_TIMEZONE,
): string {
  if (!dateStr) return '—';
  const date = businessDateString(dateStr, timeZone);
  if (date === '—') return date;
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString('en-ZA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatTime(
  dateStr: string | Date | null | undefined,
  timeZone = DEFAULT_BUSINESS_TIMEZONE,
): string {
  return businessTimeString(dateStr, timeZone);
}

export function toDateStr(d: Date, timeZone = DEFAULT_BUSINESS_TIMEZONE): string {
  return businessDateString(d, timeZone);
}

/** Download rows as a CSV file. */
export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join(
    '\n',
  );
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
