import { useMemo } from 'react';
import { FileSpreadsheet, AlertTriangle } from 'lucide-react';
import {
  Button,
  Modal,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui';
import { previewImport } from '../../utils/importPreview';
import type { CsvPayload } from '../../utils/reportCsvExports';

const MAX_PREVIEW_ROWS = 5;

interface TestImportModalProps {
  open: boolean;
  onClose: () => void;
  payload: CsvPayload | null;
  formatLabel: string;
  onDownload: () => void;
}

/**
 * Spec §4 "Test Import" preview — shows exactly what the payroll importer will
 * receive (round-tripped through the same RFC-4180 parser) before the user
 * commits the download. Deliberately a separate component so `Reports.tsx`
 * stays under the 700-line ratchet.
 */
export default function TestImportModal({
  open,
  onClose,
  payload,
  formatLabel,
  onDownload,
}: TestImportModalProps) {
  const preview = useMemo(() => (payload ? previewImport(payload) : null), [payload]);

  if (!payload || !preview) return null;

  return (
    <Modal open={open} onClose={onClose} title="Test Import Preview" wide>
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileSpreadsheet className="h-4 w-4 text-brand" />
          <span className="font-medium text-foreground">{formatLabel}</span>
          <span>·</span>
          <span className="font-mono text-xs">{payload.filename}</span>
        </div>

        <div className="flex flex-wrap gap-4 text-sm">
          <span>
            <strong className="text-foreground">{preview.columnCount}</strong> columns
          </span>
          <span>
            <strong className="text-foreground">{preview.rowCount}</strong> data rows
          </span>
        </div>

        {preview.warnings.length > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              {preview.warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-md border">
          <div className="max-h-72 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {preview.headers.map((h) => (
                    <TableHead key={h} className="whitespace-nowrap">
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.slice(0, MAX_PREVIEW_ROWS).map((row, i) => (
                  <TableRow key={i}>
                    {preview.headers.map((_, col) => (
                      <TableCell key={col} className="whitespace-nowrap">
                        {row[col] ?? ''}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {preview.rowCount > MAX_PREVIEW_ROWS && (
          <p className="text-xs text-muted-foreground">
            Showing the first {MAX_PREVIEW_ROWS} of {preview.rowCount} rows.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onDownload}>Download CSV</Button>
        </div>
      </div>
    </Modal>
  );
}
