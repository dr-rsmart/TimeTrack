/**
 * Export "Test Import" Preview (Feature Spec §4)
 * ==============================================
 * Payroll CSVs are built and downloaded client-side, so the server never sees
 * them. Before a manager commits a file to their payroll system, they need to
 * know exactly what that system will receive.
 *
 * This module round-trips an already-built `CsvPayload` back through the same
 * RFC-4180 parser used for onboarding imports (`csv.ts`). Whatever survives the
 * round-trip is precisely what a payroll importer will see: the same quoting,
 * the same column count and the same row shape. It is a preview of the file,
 * not a re-derivation of the data.
 */

import { csvEscapeCell, parseCsv } from './csv';
import type { CsvPayload } from './reportCsvExports';

export interface ImportPreview {
  /** First cell of each column (the header row). */
  headers: string[];
  /** Data rows, excluding the header row. */
  rows: string[][];
  /** Number of data rows. */
  rowCount: number;
  /** Number of columns in the header. */
  columnCount: number;
  /** Structural warnings, e.g. a data row whose width differs from the header. */
  warnings: string[];
}

/** Serialise a payload to CSV text using the canonical escaping rules. */
export function toCsvText(payload: CsvPayload): string {
  const escape = (v: string | number) => csvEscapeCell(String(v));
  const head = payload.headers.map(escape).join(',');
  const body = payload.data.map((r) => r.map(escape).join(','));
  return [head, ...body].join('\r\n');
}

/** Round-trip a payload and report what the payroll importer would see. */
export function previewImport(payload: CsvPayload): ImportPreview {
  const cells = parseCsv(toCsvText(payload), ',');
  const headers = cells[0] ?? [];
  const rows = cells.slice(1);

  const warnings: string[] = [];
  rows.forEach((row, i) => {
    if (row.length !== headers.length) {
      warnings.push(
        `Row ${i + 2} has ${row.length} column(s) but the header has ${headers.length}.`,
      );
    }
  });

  return {
    headers,
    rows,
    rowCount: rows.length,
    columnCount: headers.length,
    warnings,
  };
}
