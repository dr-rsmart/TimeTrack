/**
 * CSV Import Utilities (Bulk Onboarding)
 * --------------------------------------
 * Dependency-free CSV parsing for the Workforce bulk import feature.
 * - `parseCsv`: RFC-4180 style parser (handles BOM, CRLF/LF, quoted fields
 *   with embedded commas, newlines and escaped quotes).
 * - `parseImportFile`: maps a header row onto canonical employee fields.
 * - `validateImportRows`: client-side validation mirroring the server's
 *   `bulkEmployeeRowSchema` so users see errors before uploading.
 * - `buildImportTemplateCsv`: generates the downloadable CSV template.
 */

export interface ImportColumn {
  /** API payload field name */
  key: string;
  /** Header label used in the template file */
  label: string;
  required: boolean;
  /** Lowercase header aliases accepted when reading a user's file */
  aliases: string[];
}

export const IMPORT_COLUMNS: ImportColumn[] = [
  { key: 'firstName', label: 'First Name', required: true, aliases: ['firstname', 'first name', 'first_name', 'given name'] },
  { key: 'surname', label: 'Surname', required: true, aliases: ['surname', 'lastname', 'last name', 'last_name', 'family name'] },
  { key: 'email', label: 'Email', required: true, aliases: ['email', 'email address', 'e-mail'] },
  { key: 'position', label: 'Position', required: false, aliases: ['position', 'job title', 'title', 'role title'] },
  { key: 'role', label: 'Role', required: false, aliases: ['role', 'user role', 'access role'] },
  { key: 'employeeNumber', label: 'Employee Number', required: false, aliases: ['employee number', 'employeenumber', 'employee_number', 'emp no', 'staff number', 'employee id'] },
  { key: 'phone', label: 'Phone', required: false, aliases: ['phone', 'phone number', 'mobile', 'cell', 'telephone'] },
  { key: 'branch', label: 'Branch', required: false, aliases: ['branch', 'location', 'site'] },
  { key: 'department', label: 'Department', required: false, aliases: ['department', 'dept', 'team'] },
  { key: 'hireDate', label: 'Hire Date (YYYY-MM-DD)', required: false, aliases: ['hiredate', 'hire date', 'hire_date', 'start date', 'startdate', 'start_date'] },
];

export const VALID_ROLES = ['admin', 'manager', 'employee'] as const;
export const MAX_IMPORT_ROWS = 500;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Field length caps (must mirror server bulkEmployeeRowSchema)
const FIELD_MAX: Record<string, number> = {
  firstName: 100,
  surname: 100,
  email: 255,
  position: 100,
  employeeNumber: 50,
  phone: 30,
  branch: 100,
  department: 100,
};

/**
 * RFC-4180 style CSV parser. Returns rows of cell strings.
 * Handles: UTF-8 BOM, CRLF/LF/CR line endings, quoted fields containing
 * commas/newlines, and escaped quotes ("" → ").
 */
export function parseCsv(text: string, delimiter: string = ','): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop rows that are entirely empty (trailing newlines, blank lines)
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/**
 * Normalizes a header cell for alias matching: lowercased, parenthetical
 * hints removed ("Hire Date (YYYY-MM-DD)" → "hire date"), punctuation/spaces
 * stripped. Shared by header mapping and delimiter detection.
 */
export function normalizeHeaderToken(s: string): string {
  return s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');
}

const DELIMITER_CANDIDATES = [',', ';', '\t'] as const;

/**
 * Auto-detects the field delimiter from the header row. Counts how many
 * known columns each candidate (comma, semicolon, tab) recognizes; the best
 * winner is used. Handles CSVs exported by Excel in locales where the list
 * separator is ";" (e.g. South Africa / EU) and tab-separated exports.
 * Defaults to comma when nothing matches.
 */
export function detectDelimiter(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const firstLine = text.split(/\r\n|\r|\n/, 1)[0] ?? '';
  let best: string = ',';
  let bestScore = 0;
  for (const d of DELIMITER_CANDIDATES) {
    const parts = firstLine.split(d).map((h) => normalizeHeaderToken(h.trim()));
    let score = 0;
    for (const col of IMPORT_COLUMNS) {
      const candidates = [col.key.toLowerCase(), ...col.aliases].map(normalizeHeaderToken);
      if (parts.some((p) => p !== '' && candidates.includes(p))) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** True when an ISO YYYY-MM-DD string is a real calendar date. */
function isValidIsoDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/**
 * Normalizes a user-provided hire date to the server's canonical YYYY-MM-DD.
 * Accepted: YYYY-MM-DD, YYYY/MM/DD (year-first) and DD/MM/YYYY (day-first,
 * with month-first fallback when day-first is impossible, e.g. 08/27/2026).
 * Returns null when the value cannot be interpreted as a valid date.
 */
export function normalizeDateValue(raw: string): string | null {
  const v = raw.trim();
  const yearFirst = v.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (yearFirst) {
    const iso = `${yearFirst[1]}-${yearFirst[2].padStart(2, '0')}-${yearFirst[3].padStart(2, '0')}`;
    return isValidIsoDate(iso) ? iso : null;
  }
  const yearLast = v.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (yearLast) {
    const a = yearLast[1].padStart(2, '0');
    const b = yearLast[2].padStart(2, '0');
    const y = yearLast[3];
    // Day-first is preferred (product's target locales); month-first only
    // when day-first is impossible.
    const dayFirst = `${y}-${b}-${a}`;
    if (isValidIsoDate(dayFirst)) return dayFirst;
    const monthFirst = `${y}-${a}-${b}`;
    if (isValidIsoDate(monthFirst)) return monthFirst;
    return null;
  }
  return null;
}

/** One data row mapped onto canonical field names. */
export interface ImportRow {
  /** Line number in the source CSV file (header = line 1, first data row = 2) */
  rowNumber: number;
  /** Trimmed raw values keyed by canonical field name */
  values: Record<string, string>;
}

export interface ParseFileResult {
  rows: ImportRow[];
  /** Required columns that were not present in the header row */
  missingRequired: string[];
  /** Header cells that did not match any known column (informational) */
  unknownHeaders: string[];
}

/**
 * Maps a parsed CSV (first row = headers) onto canonical import rows.
 * Headers are matched case-insensitively against each column's aliases.
 */
export function parseImportFile(cells: string[][]): ParseFileResult {
  if (cells.length === 0) {
    return { rows: [], missingRequired: IMPORT_COLUMNS.filter((c) => c.required).map((c) => c.label), unknownHeaders: [] };
  }

  const headers = cells[0].map((h) => h.trim().toLowerCase());

  // column key → index in the file
  const columnIndex = new Map<string, number>();
  const matched = new Set<number>();

  const normalizeHeader = (s: string) => normalizeHeaderToken(s.trim());
  for (const col of IMPORT_COLUMNS) {
    const candidates = [col.key.toLowerCase(), ...col.aliases].map(normalizeHeaderToken);
    const idx = headers.findIndex((h) => candidates.some((a) => a !== '' && normalizeHeader(h) === a));
    if (idx >= 0) {
      columnIndex.set(col.key, idx);
      matched.add(idx);
    }
  }

  const unknownHeaders = headers.filter((h, i) => h !== '' && !matched.has(i));
  const missingRequired = IMPORT_COLUMNS.filter((c) => c.required && !columnIndex.has(c.key)).map((c) => c.label);

  const rows: ImportRow[] = cells.slice(1).map((r, i) => {
    const values: Record<string, string> = {};
    for (const [key, idx] of columnIndex) {
      values[key] = (r[idx] ?? '').trim();
    }
    return { rowNumber: i + 2, values };
  });

  return { rows, missingRequired, unknownHeaders };
}

/** A row ready for submission (payload matches the API row schema). */
export interface PreparedImportRow {
  rowNumber: number;
  payload: Record<string, unknown>;
}

export interface RowValidationResult {
  valid: PreparedImportRow[];
  errors: Array<{ rowNumber: number; message: string }>;
}

/**
 * Validates mapped rows (required fields, email format, role whitelist,
 * hire-date format, in-file duplicate emails, length caps, row cap).
 * Mirrors the server-side `bulkEmployeeRowSchema` so bad rows are caught
 * before they leave the browser.
 */
export function validateImportRows(rows: ImportRow[]): RowValidationResult {
  const valid: PreparedImportRow[] = [];
  const errors: Array<{ rowNumber: number; message: string }> = [];
  const seenEmails = new Map<string, number>();

  if (rows.length > MAX_IMPORT_ROWS) {
    errors.push({
      rowNumber: rows[MAX_IMPORT_ROWS].rowNumber,
      message: `Import is limited to ${MAX_IMPORT_ROWS} rows at a time. Split the file and import in batches.`,
    });
    rows = rows.slice(0, MAX_IMPORT_ROWS);
  }

  for (const { rowNumber, values } of rows) {
    const rowErrors: string[] = [];
    const payload: Record<string, unknown> = {};

    // Required fields
    if (!values.firstName) rowErrors.push('First Name is required.');
    if (!values.surname) rowErrors.push('Surname is required.');
    if (!values.email) rowErrors.push('Email is required.');

    // Email format + duplicate check
    let normalizedEmail = '';
    if (values.email) {
      normalizedEmail = values.email.trim().toLowerCase();
      payload.email = normalizedEmail;
      if (!EMAIL_RE.test(normalizedEmail)) {
        rowErrors.push(`Invalid email address: ${values.email}`);
      } else {
        const firstSeen = seenEmails.get(normalizedEmail);
        if (firstSeen) {
          rowErrors.push(`Duplicate email in file: already used on line ${firstSeen}.`);
        } else {
          seenEmails.set(normalizedEmail, rowNumber);
        }
      }
    }

    // Role whitelist (blank → server default "employee")
    if (values.role) {
      const role = values.role.toLowerCase();
      if (!(VALID_ROLES as readonly string[]).includes(role)) {
        rowErrors.push(`Invalid role "${values.role}". Allowed: ${VALID_ROLES.join(', ')}.`);
      } else {
        payload.role = role;
      }
    }

    // Hire date (accepts YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY — normalized to YYYY-MM-DD)
    if (values.hireDate) {
      const iso = normalizeDateValue(values.hireDate);
      if (!iso) {
        rowErrors.push(`Hire Date must be a valid date (YYYY-MM-DD, YYYY/MM/DD or DD/MM/YYYY) — got "${values.hireDate}".`);
      } else {
        payload.hireDate = iso;
      }
    }

    // Optional string fields + length caps
    for (const key of ['firstName', 'surname', 'position', 'employeeNumber', 'phone', 'branch', 'department'] as const) {
      const v = values[key];
      if (!v) continue;
      const max = FIELD_MAX[key];
      if (max && v.length > max) {
        rowErrors.push(`${key} is too long (max ${max} characters).`);
      } else {
        payload[key] = v;
      }
    }

    if (rowErrors.length > 0) {
      errors.push({ rowNumber, message: rowErrors.join(' ') });
    } else {
      valid.push({ rowNumber, payload });
    }
  }

  return { valid, errors };
}

/** Escapes a single CSV cell per RFC-4180. */
export function csvEscapeCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Builds the downloadable CSV template (header + example row). */
export function buildImportTemplateCsv(): string {
  const headers = IMPORT_COLUMNS.map((c) => csvEscapeCell(c.label)).join(',');
  const example = [
    'Jane',
    'Doe',
    'jane.doe@company.com',
    'Sales Representative',
    'employee',
    'EMP001',
    '+27 82 000 0000',
    'Cape Town',
    'Sales',
    '2024-01-15',
  ];
  return `${headers}\r\n${example.map(csvEscapeCell).join(',')}\r\n`;
}