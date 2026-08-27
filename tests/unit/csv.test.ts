import { describe, it, expect } from 'vitest';
import {
  parseCsv,
  parseImportFile,
  validateImportRows,
  buildImportTemplateCsv,
  csvEscapeCell,
  detectDelimiter,
  normalizeDateValue,
  normalizeHeaderToken,
  IMPORT_COLUMNS,
  MAX_IMPORT_ROWS,
  type ImportRow,
} from '../../src/utils/csv';

describe('CSV Utilities (Bulk Onboarding)', () => {
  describe('parseCsv', () => {
    it('parses a simple grid', () => {
      expect(parseCsv('a,b,c\n1,2,3')).toEqual([
        ['a', 'b', 'c'],
        ['1', '2', '3'],
      ]);
    });

    it('handles CRLF and lone CR line endings', () => {
      expect(parseCsv('a,b\r\n1,2\r3,4')).toEqual([
        ['a', 'b'],
        ['1', '2'],
        ['3', '4'],
      ]);
    });

    it('strips a UTF-8 BOM', () => {
      const rows = parseCsv('\uFEFFname,email\nJane,j@x.com');
      expect(rows[0][0]).toBe('name');
    });

    it('keeps embedded commas, newlines and escaped quotes inside quoted fields', () => {
      const rows = parseCsv('name,notes\n"Smith, John","Line 1\nLine 2 ""quoted"""');
      expect(rows).toHaveLength(2);
      expect(rows[1][0]).toBe('Smith, John');
      expect(rows[1][1]).toBe('Line 1\nLine 2 "quoted"');
    });

    it('drops completely empty rows (trailing newlines)', () => {
      expect(parseCsv('a,b\n1,2\n\n')).toEqual([
        ['a', 'b'],
        ['1', '2'],
      ]);
    });

    it('handles a final field without trailing newline', () => {
      expect(parseCsv('a,b\n1,2')).toEqual([
        ['a', 'b'],
        ['1', '2'],
      ]);
    });
  });

  describe('parseImportFile', () => {
    it('maps headers via aliases case-insensitively, ignoring punctuation', () => {
      const cells = parseCsv('First Name,Last Name,E-mail Address,Job Title\nJane,Doe,j@x.com,Rep');
      const res = parseImportFile(cells);
      expect(res.missingRequired).toEqual([]);
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].rowNumber).toBe(2);
      expect(res.rows[0].values).toMatchObject({
        firstName: 'Jane',
        surname: 'Doe',
        email: 'j@x.com',
        position: 'Rep',
      });
    });

    it('reports missing required columns', () => {
      const res = parseImportFile(parseCsv('First Name,Phone\nJane,123'));
      expect(res.missingRequired).toContain('Surname');
      expect(res.missingRequired).toContain('Email');
    });

    it('lists unknown headers as ignored', () => {
      const res = parseImportFile(parseCsv('First Name,Surname,Email,FavouriteColour\nA,B,a@b.com,Blue'));
      expect(res.unknownHeaders).toEqual(['favouritecolour']);
      expect(res.missingRequired).toEqual([]);
    });

    it('returns missing-required for an empty file', () => {
      const res = parseImportFile([]);
      expect(res.rows).toHaveLength(0);
      expect(res.missingRequired).toHaveLength(IMPORT_COLUMNS.filter((c) => c.required).length);
    });
  });

  describe('csvEscapeCell / buildImportTemplateCsv', () => {
    it('escapes cells containing commas, quotes and newlines', () => {
      expect(csvEscapeCell('plain')).toBe('plain');
      expect(csvEscapeCell('a,b')).toBe('"a,b"');
      expect(csvEscapeCell('say "hi"')).toBe('"say ""hi"""');
      expect(csvEscapeCell('line1\nline2')).toBe('"line1\nline2"');
    });

    it('builds a parseable template with all columns and an example row', () => {
      const cells = parseCsv(buildImportTemplateCsv());
      expect(cells).toHaveLength(2);
      const res = parseImportFile(cells);
      expect(res.missingRequired).toEqual([]);
      expect(res.unknownHeaders).toEqual([]);
      const validated = validateImportRows(res.rows);
      expect(validated.errors).toHaveLength(0);
      expect(validated.valid).toHaveLength(1);
      // The parenthetical header "Hire Date (YYYY-MM-DD)" must map correctly
      expect(validated.valid[0].payload.hireDate).toBe('2024-01-15');
    });
  });

  describe('detectDelimiter', () => {
    it('detects comma for the standard template', () => {
      expect(detectDelimiter(buildImportTemplateCsv())).toBe(',');
    });

    it('detects semicolon-delimited files (ZA/EU Excel locale exports)', () => {
      const text = 'First Name;Surname;Email;Position;Role\nJane;Doe;j@x.com;Rep;employee';
      expect(detectDelimiter(text)).toBe(';');
    });

    it('detects tab-delimited files', () => {
      const text = 'First Name\tSurname\tEmail\nJane\tDoe\tj@x.com';
      expect(detectDelimiter(text)).toBe('\t');
    });

    it('defaults to comma when nothing matches', () => {
      expect(detectDelimiter('gibberish header\nno;known;columns')).toBe(',');
    });
  });

  describe('normalizeHeaderToken / normalizeDateValue', () => {
    it('strips parenthetical hints and punctuation from headers', () => {
      expect(normalizeHeaderToken('Hire Date (YYYY-MM-DD)')).toBe('hiredate');
      expect(normalizeHeaderToken(' Employee Number ')).toBe('employeenumber');
    });

    it('normalizes year-first and day-first dates to ISO', () => {
      expect(normalizeDateValue('2026-08-27')).toBe('2026-08-27');
      expect(normalizeDateValue('2026/08/27')).toBe('2026-08-27');
      expect(normalizeDateValue('2026/8/7')).toBe('2026-08-07');
      expect(normalizeDateValue('27/08/2026')).toBe('2026-08-27');
      expect(normalizeDateValue('15/01/2024')).toBe('2024-01-15');
    });

    it('falls back to month-first when day-first is impossible', () => {
      expect(normalizeDateValue('08/27/2026')).toBe('2026-08-27');
    });

    it('rejects impossible and unparseable dates', () => {
      expect(normalizeDateValue('2024-13-45')).toBeNull();
      expect(normalizeDateValue('2026-02-31')).toBeNull();
      expect(normalizeDateValue('15 Jan 2024')).toBeNull();
      expect(normalizeDateValue('')).toBeNull();
    });
  });

  describe('end-to-end import file handling', () => {
    it('imports a semicolon-delimited file with slash dates (real-world Excel export)', () => {
      const text = [
        'First Name;Surname;Email;Position;Role;Employee Number;Phone;Branch;Department;Hire Date (YYYY-MM-DD)',
        'Jerobiam;Julies;jj@smartpatel.co.za;Sales Representative;employee;EMP003;+27 21 905 0000;Cape Town;Sales;2026/08/27',
        'Joe;Julies;jj1@smartpatel.co.za;IT Software Developer;employee;EMP004;+27 21 905 0001;Cape Town;IT;2026/08/27',
      ].join('\r\n');

      const cells = parseCsv(text, detectDelimiter(text));
      const parsed = parseImportFile(cells);
      expect(parsed.missingRequired).toEqual([]);
      expect(parsed.unknownHeaders).toEqual([]);

      const validated = validateImportRows(parsed.rows);
      expect(validated.errors).toHaveLength(0);
      expect(validated.valid).toHaveLength(2);
      expect(validated.valid[0].payload).toMatchObject({
        firstName: 'Jerobiam',
        surname: 'Julies',
        email: 'jj@smartpatel.co.za',
        employeeNumber: 'EMP003',
        branch: 'Cape Town',
        department: 'Sales',
        hireDate: '2026-08-27',
      });
      expect(validated.valid[1].payload.email).toBe('jj1@smartpatel.co.za');
    });
  });


  describe('validateImportRows', () => {
    const row = (rowNumber: number, values: Record<string, string>): ImportRow => ({ rowNumber, values });

    it('accepts a fully valid row and normalizes the payload', () => {
      const res = validateImportRows([
        row(2, {
          firstName: 'Jane',
          surname: 'Doe',
          email: ' Jane.Doe@X.com ',
          role: 'Manager',
          hireDate: '2024-01-15',
          branch: 'Cape Town',
        }),
      ]);
      expect(res.errors).toHaveLength(0);
      expect(res.valid).toHaveLength(1);
      expect(res.valid[0].payload).toMatchObject({
        email: 'jane.doe@x.com',
        role: 'manager',
        hireDate: '2024-01-15',
        branch: 'Cape Town',
      });
    });

    it('flags missing required fields per row', () => {
      const res = validateImportRows([row(2, { firstName: '', surname: '', email: '' })]);
      expect(res.valid).toHaveLength(0);
      expect(res.errors).toHaveLength(1);
      expect(res.errors[0].rowNumber).toBe(2);
      expect(res.errors[0].message).toContain('First Name is required');
      expect(res.errors[0].message).toContain('Surname is required');
      expect(res.errors[0].message).toContain('Email is required');
    });

    it('flags invalid email addresses', () => {
      const res = validateImportRows([
        row(2, { firstName: 'A', surname: 'B', email: 'not-an-email' }),
      ]);
      expect(res.errors[0].message).toContain('Invalid email address');
    });

    it('flags duplicate emails within the file (case-insensitive)', () => {
      const res = validateImportRows([
        row(2, { firstName: 'A', surname: 'B', email: 'dup@x.com' }),
        row(3, { firstName: 'C', surname: 'D', email: ' DUP@x.com ' }),
      ]);
      expect(res.valid).toHaveLength(1);
      expect(res.errors).toHaveLength(1);
      expect(res.errors[0].rowNumber).toBe(3);
      expect(res.errors[0].message).toContain('Duplicate email');
    });

    it('flags invalid roles and invalid hire dates', () => {
      const res = validateImportRows([
        row(2, { firstName: 'A', surname: 'B', email: 'a@x.com', role: 'superuser', hireDate: '15 Jan 2024' }),
      ]);
      expect(res.errors).toHaveLength(1);
      expect(res.errors[0].message).toContain('Invalid role');
      expect(res.errors[0].message).toContain('Hire Date');
    });

    it('flags impossible dates that match the shape regex', () => {
      const res = validateImportRows([
        row(2, { firstName: 'A', surname: 'B', email: 'a@x.com', hireDate: '2024-13-45' }),
      ]);
      expect(res.errors).toHaveLength(1);
      expect(res.errors[0].message).toContain('Hire Date');
    });

    it('enforces the hard row cap and reports the overflow', () => {
      const rows: ImportRow[] = Array.from({ length: MAX_IMPORT_ROWS + 5 }, (_, i) =>
        row(i + 2, { firstName: `E${i}`, surname: 'Emp', email: `e${i}@x.com` }),
      );
      const res = validateImportRows(rows);
      expect(res.valid).toHaveLength(MAX_IMPORT_ROWS);
      expect(res.errors.some((e) => e.message.includes('limited to 500'))).toBe(true);
    });

    it('keeps valid rows even when other rows fail (partial success)', () => {
      const res = validateImportRows([
        row(2, { firstName: 'Good', surname: 'Row', email: 'good@x.com' }),
        row(3, { firstName: '', surname: 'Bad', email: 'bad' }),
        row(4, { firstName: 'Also', surname: 'Good', email: 'also@x.com' }),
      ]);
      expect(res.valid.map((v) => v.payload.email)).toEqual(['good@x.com', 'also@x.com']);
      expect(res.errors).toHaveLength(1);
      expect(res.errors[0].rowNumber).toBe(3);
    });
  });

});