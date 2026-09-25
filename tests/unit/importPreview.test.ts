import { describe, expect, it } from 'vitest';
import { previewImport, toCsvText } from '../../src/utils/importPreview';
import type { CsvPayload } from '../../src/utils/reportCsvExports';

function payload(overrides: Partial<CsvPayload> = {}): CsvPayload {
  return {
    filename: 'payroll-summary-2026-09-01-to-2026-09-30.csv',
    headers: ['Employee Number', 'Employee', 'Total Hours'],
    data: [
      ['EMP001', 'Jane Doe', 182],
      ['EMP002', 'Smith, John', 160.5],
    ],
    ...overrides,
  };
}

describe('toCsvText', () => {
  it('escapes cells containing commas and joins with CRLF', () => {
    const text = toCsvText(payload());
    expect(text.split('\r\n')).toHaveLength(3);
    expect(text).toContain('"Smith, John"');
  });
});

describe('previewImport', () => {
  it('round-trips the header and every data row faithfully', () => {
    const preview = previewImport(payload());
    expect(preview.headers).toEqual(['Employee Number', 'Employee', 'Total Hours']);
    expect(preview.rowCount).toBe(2);
    expect(preview.columnCount).toBe(3);
    expect(preview.rows[0]).toEqual(['EMP001', 'Jane Doe', '182']);
    expect(preview.rows[1]).toEqual(['EMP002', 'Smith, John', '160.5']);
    expect(preview.warnings).toEqual([]);
  });

  it('survives embedded quotes and newlines through the round-trip', () => {
    const preview = previewImport(
      payload({ data: [['EMP001', 'Doe "DJ" Jane', 'Line 1\nLine 2']] }),
    );
    expect(preview.rows[0][1]).toBe('Doe "DJ" Jane');
    expect(preview.rows[0][2]).toBe('Line 1\nLine 2');
  });

  it('flags data rows whose width differs from the header', () => {
    const preview = previewImport(payload({ data: [['EMP001'], ['EMP002', 'Jane Doe', 160]] }));
    expect(preview.warnings).toHaveLength(1);
    expect(preview.warnings[0]).toContain('Row 2');
  });

  it('handles an empty payload gracefully', () => {
    const preview = previewImport(payload({ data: [] }));
    expect(preview.headers).toEqual(['Employee Number', 'Employee', 'Total Hours']);
    expect(preview.rowCount).toBe(0);
    expect(preview.rows).toEqual([]);
  });
});
