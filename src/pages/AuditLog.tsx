/**
 * Audit Log Page
 * --------------
 * Immutable audit trail viewer with entity/action filters.
 * IPs are redacted server-side for manager role.
 * Powered by cursor-based pagination for high-scale enterprise retention.
 */

import { useCallback, useEffect, useState } from 'react';
import { ScrollText, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { auditApi, type AuditEntry } from '../services/api';
import {
  Badge, Card, CardContent, EmptyState, Label,
  Select, Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Modal, Button,
} from '../components/ui';
import { formatDate, formatTime } from '../lib/utils';

const actionVariant = (action: string): 'default' | 'secondary' | 'success' | 'warning' | 'destructive' => {
  if (action === 'create' || action === 'clock_in' || action === 'login') return 'success';
  if (action === 'update') return 'default';
  if (action === 'delete') return 'destructive';
  if (action.includes('password')) return 'warning';
  return 'secondary';
};

export default function AuditLog() {
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await auditApi.list({
        entity: entity || undefined,
        action: action || undefined,
        limit: 100,
      });
      setItems(res.items);
      setTotal(res.total);
      setNextCursor(res.nextCursor ?? null);
      setHasMore(Boolean(res.hasMore));
    } catch (err) {
      toast.error('Failed to load audit log');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [entity, action]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await auditApi.list({
        entity: entity || undefined,
        action: action || undefined,
        cursor: nextCursor,
        limit: 100,
      });
      setItems((prev) => [...prev, ...res.items]);
      setNextCursor(res.nextCursor ?? null);
      setHasMore(Boolean(res.hasMore));
    } catch (err) {
      toast.error('Failed to load more audit entries');
      console.error(err);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  const entities = [...new Set(items.map((i) => i.entity))];
  const actions = [...new Set(items.map((i) => i.action))];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <ScrollText className="w-5 h-5 text-brand" />
          <h1 className="text-2xl font-bold">Audit Trail</h1>
        </div>
        <p className="text-sm text-muted-foreground">{total} recorded events · Immutable log · IPs redacted for managers</p>
      </div>

      {/* Filters */}
      <Card className="border-border/50">
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          <div className="space-y-1">
            <Label htmlFor="a-entity">Entity</Label>
            <Select id="a-entity" className="w-48" value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">All entities</option>
              {entities.map((en) => <option key={en} value={en}>{en}</option>)}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="a-action">Action</Label>
            <Select id="a-action" className="w-48" value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">All actions</option>
              {actions.map((a) => <option key={a} value={a}>{a}</option>)}
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border-border/50 overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-48 items-center justify-center"><Spinner className="h-8 w-8" /></div>
          ) : items.length === 0 ? (
            <EmptyState message="No audit entries found" />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Staff Name</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>IP Address</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(item.createdAt)} {formatTime(item.createdAt)}
                      </TableCell>
                      <TableCell className="font-medium">
                        {item.staffName || '—'}
                      </TableCell>
                      <TableCell>{item.entity}</TableCell>
                      <TableCell>
                        <Badge variant={actionVariant(item.action)}>{item.action}</Badge>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{item.actorName || item.actorEmail}</p>
                        <p className="text-xs text-muted-foreground">{item.actorRole}</p>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{item.ipAddress || '—'}</TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" onClick={() => setSelected(item)}>View</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {hasMore && (
                <div className="p-4 flex justify-center border-t border-border/50 bg-muted/20">
                  <Button
                    variant="outline"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="flex items-center gap-2"
                  >
                    {loadingMore ? <Spinner className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    Load more entries
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Detail modal */}
      <Modal open={!!selected} onClose={() => setSelected(null)} title="Audit Entry Details" wide>
        {selected && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div><span className="font-medium">Entity:</span> {selected.entity}</div>
              <div><span className="font-medium">Entity ID:</span> {selected.entityId}</div>
              <div><span className="font-medium">Action:</span> {selected.action}</div>
              <div><span className="font-medium">Actor:</span> {selected.actorEmail} ({selected.actorRole})</div>
              <div><span className="font-medium">IP:</span> {selected.ipAddress || '—'}</div>
              <div><span className="font-medium">Branch:</span> {selected.branch || '—'}</div>
              <div><span className="font-medium">Department:</span> {selected.department || '—'}</div>
              <div><span className="font-medium">Timestamp:</span> {formatDate(selected.createdAt)} {formatTime(selected.createdAt)}</div>
            </div>
            {selected.justification && (
              <div>
                <p className="font-medium">Justification</p>
                <p className="mt-1 rounded-md bg-muted p-3">{selected.justification}</p>
              </div>
            )}
            {selected.changes && (
              <div>
                <p className="mb-2 font-medium">Changes (before → after)</p>
                <div className="space-y-2">
                  {Object.entries(selected.changes).map(([field, diff]) => (
                    <div key={field} className="rounded-md border p-3">
                      <p className="font-mono text-xs font-semibold">{field}</p>
                      <p className="text-xs text-destructive">Before: {JSON.stringify(diff.before)}</p>
                      <p className="text-xs text-emerald-600">After: {JSON.stringify(diff.after)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
