/**
 * Import Employees Modal (Bulk Onboarding)
 * ----------------------------------------
 * Upload a CSV file to onboard up to 500 employees at once. The file is
 * parsed and validated in the browser (preview + per-row errors) and only
 * the valid rows are posted to POST /employees/bulk, which creates each
 * Employee + login User atomically with the standard temporary password.
 *
 * Flow: Download template → fill in → Choose CSV → review preview → Import.
 */

import { useEffect, useRef, useState } from 'react';
import { FileSpreadsheet, Download, Upload, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { employeeApi, ApiError } from '../../services/api';
import {
  Button, Badge, Modal, Spinner,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../ui';
import {
  parseCsv, parseImportFile, validateImportRows, buildImportTemplateCsv,
  detectDelimiter, MAX_IMPORT_ROWS, type PreparedImportRow,
} from '../../utils/csv';

interface ImportEmployeesModalProps {
  open: boolean;
  onClose: () => void;
  /** Called after a (full or partial) successful import so the parent can refresh. */
  onDone?: () => void;
}

interface PreviewState {
  fileName: string;
  valid: PreparedImportRow[];
  clientErrors: Array<{ rowNumber: number; message: string }>;
  unknownHeaders: string[];
}

export default function ImportEmployeesModal({ open, onClose, onDone }: ImportEmployeesModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  /** Server-side rejections, mapped back to CSV line numbers. */
  const [serverErrors, setServerErrors] = useState<Array<{ rowNumber: number; message: string }> | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);

  // Reset state when the modal closes
  useEffect(() => {
    if (!open) {
      setPreview(null);
      setReading(false);
      setImporting(false);
      setServerErrors(null);
      setImportedCount(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [open]);

  const downloadTemplate = () => {
    const blob = new Blob([buildImportTemplateCsv()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'employee-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileSelected = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error('File is too large (max 2 MB). Split it into smaller batches.');
      return;
    }
    setReading(true);
    setServerErrors(null);
    setImportedCount(null);
    try {
      const text = await file.text();
      // Auto-detect the delimiter: Excel in ZA/EU locales saves CSV with ";"
      // separators; TSV exports use tabs; the app's template uses commas.
      const cells = parseCsv(text, detectDelimiter(text));
      const parsed = parseImportFile(cells);
      if (parsed.missingRequired.length > 0) {
        toast.error(`Missing required column(s): ${parsed.missingRequired.join(', ')}. Download the template to see the expected format.`);
        setPreview(null);
        return;
      }
      if (parsed.rows.length === 0) {
        toast.error('The file contains no employee rows.');
        setPreview(null);
        return;
      }
      const validated = validateImportRows(parsed.rows);
      setPreview({
        fileName: file.name,
        valid: validated.valid,
        clientErrors: validated.errors,
        unknownHeaders: parsed.unknownHeaders,
      });
    } catch (err) {
      console.error('[ImportEmployees] Failed to read file:', err);
      toast.error('Could not read that file. Make sure it is a valid CSV file.');
    } finally {
      setReading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleImport = async () => {
    if (!preview || preview.valid.length === 0) return;
    setImporting(true);
    try {
      const res = await employeeApi.bulkCreate(preview.valid.map((v) => v.payload));
      setImportedCount(res.imported);
      // Server errors reference positions in the submitted rows array —
      // map them back to the original CSV line numbers for the user.
      const mapped = res.errors.map((e) => ({
        rowNumber: preview.valid[e.row - 1]?.rowNumber ?? e.row,
        message: e.message,
      }));
      setServerErrors(mapped);
      if (res.imported > 0) {
        toast.success(`Imported ${res.imported} employee(s)${res.skipped > 0 ? ` · ${res.skipped} skipped` : ''}`);
        onDone?.();
      } else {
        toast.error('No employees were imported — see the errors below.');
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Bulk import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal open={open} onClose={() => !importing && onClose()} title="Bulk Import Employees" wide>
      <div className="space-y-5">
        {/* Intro notice */}
        <div className="flex items-start gap-3 rounded-lg border border-brand/30 bg-brand/10 p-3 text-sm">
          <FileSpreadsheet className="h-5 w-5 shrink-0 text-brand" />
          <p className="text-muted-foreground">
            Upload a CSV to onboard up to {MAX_IMPORT_ROWS} employees at once. Each imported employee
            also gets a login account with the temporary password{' '}
            <span className="font-mono font-semibold">Password123</span> — they will set their own
            password on first sign-in.
          </p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => handleFileSelected(e.target.files?.[0])}
        />

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={downloadTemplate} disabled={importing}>
            <Download className="h-4 w-4" /> Download Template
          </Button>
          <Button onClick={() => fileInputRef.current?.click()} disabled={importing || reading}>
            {reading ? <Spinner className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
            {preview ? 'Choose another file…' : 'Choose CSV File…'}
          </Button>
        </div>

        {!preview && !reading && (
          <p className="text-sm text-muted-foreground">
            No file selected yet. Download the template, fill it in, then choose the file above.
          </p>
        )}

        {preview && (
          <>
            {/* Summary */}
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary">{preview.fileName}</Badge>
              <Badge variant="success">{preview.valid.length} ready</Badge>
              {preview.clientErrors.length > 0 && (
                <Badge variant="destructive">{preview.clientErrors.length} issue(s)</Badge>
              )}
            </div>

            {preview.unknownHeaders.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Ignored unknown column(s): {preview.unknownHeaders.join(', ')}
              </p>
            )}

            {/* Result banner (shown after an import attempt) */}
            {importedCount !== null && (
              <div
                className={
                  importedCount === 0
                    ? 'rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400'
                    : 'rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400'
                }
              >
                Imported <strong>{importedCount}</strong> employee(s)
                {serverErrors && serverErrors.length > 0 && (
                  <> · {serverErrors.length} row(s) skipped by the server</>
                )}
              </div>
            )}

            {/* Server-side rejections */}
            {serverErrors && serverErrors.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                <p className="mb-1 flex items-center gap-1 text-sm font-semibold text-red-600 dark:text-red-400">
                  <AlertTriangle className="h-4 w-4" /> Server rejected {serverErrors.length} row(s)
                </p>
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-red-600 dark:text-red-400">
                  {serverErrors.map((e, i) => (
                    <li key={i}>Line {e.rowNumber}: {e.message}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Client-side validation errors */}
            {preview.clientErrors.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="mb-1 flex items-center gap-1 text-sm font-semibold text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4" /> Fix these rows in the CSV and re-import
                </p>
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-700 dark:text-amber-400">
                  {preview.clientErrors.map((e, i) => (
                    <li key={i}>Line {e.rowNumber}: {e.message}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Preview table (first 20 ready rows) */}
            {preview.valid.length > 0 && (
              <div className="max-h-60 overflow-y-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-secondary/30">
                      <TableHead className="h-8">Line</TableHead>
                      <TableHead className="h-8">Name</TableHead>
                      <TableHead className="h-8">Email</TableHead>
                      <TableHead className="h-8">Role</TableHead>
                      <TableHead className="h-8">Branch</TableHead>
                      <TableHead className="h-8">Department</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.valid.slice(0, 20).map((r) => (
                      <TableRow key={r.rowNumber} className="hover:bg-transparent">
                        <TableCell className="p-2 text-xs text-muted-foreground">{r.rowNumber}</TableCell>
                        <TableCell className="p-2 text-xs">
                          {String(r.payload.firstName ?? '')} {String(r.payload.surname ?? '')}
                        </TableCell>
                        <TableCell className="p-2 text-xs">{String(r.payload.email ?? '')}</TableCell>
                        <TableCell className="p-2 text-xs capitalize">{String(r.payload.role ?? 'employee')}</TableCell>
                        <TableCell className="p-2 text-xs">{String(r.payload.branch ?? 'Unassigned')}</TableCell>
                        <TableCell className="p-2 text-xs">{String(r.payload.department ?? 'General')}</TableCell>
                      </TableRow>
                    ))}
                    {preview.valid.length > 20 && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={6} className="p-2 text-center text-xs text-muted-foreground">
                          …and {preview.valid.length - 20} more row(s)
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Footer */}
            <div className="flex justify-end gap-3 border-t pt-4">
              <Button variant="outline" onClick={onClose} disabled={importing}>
                Close
              </Button>
              {preview.valid.length > 0 && importedCount === null && (
                <Button
                  onClick={handleImport}
                  disabled={importing}
                  className="bg-brand text-white hover:bg-brand-dark"
                >
                  {importing ? <Spinner className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                  Import {preview.valid.length} Employee(s)
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}