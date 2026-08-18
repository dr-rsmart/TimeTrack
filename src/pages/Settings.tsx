/**
 * Settings Page
 * -------------
 * Company payroll settings + geofence management (admin/master only).
 * Tabbed interface: Payroll Rules | Geofences
 *
 * The Geofences tab uses the enhanced GeofenceManager component with:
 * - Address search (OpenStreetMap Nominatim geocoding)
 * - Location presets (Sitari Country Estate, etc.)
 * - Distance tester tool
 * - Employee assignment
 * - GPS capture
 */

import { useCallback, useEffect, useState } from 'react';
import { Save, Settings as SettingsIcon, Clock, Radio, CalendarDays, Plus, Trash2, Globe, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { settingsApi, type CompanySettings, ApiError } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../hooks/useSSE';
import { GeofenceManager } from '../components/settings/GeofenceManager';
import {
  Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input,
  Label, Spinner, Tabs, Switch,
} from '../components/ui';

export default function Settings() {
  const { isMaster } = useAuth();
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Master does not see the Payroll & Overtime tab — default them to holidays
  const [activeTab, setActiveTab] = useState(isMaster ? 'holidays' : 'payroll');

  // Holiday state
  const [systemHolidays, setSystemHolidays] = useState<string[]>([]);
  const [companyHolidays, setCompanyHolidays] = useState<string[]>([]);
  const [newHolidayDate, setNewHolidayDate] = useState('');
  const [addingHoliday, setAddingHoliday] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await settingsApi.getSettings();
      setSettings(s.settings);
    } catch (err) {
      toast.error('Failed to load settings');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHolidays = useCallback(async () => {
    try {
      const res = await settingsApi.getHolidays();
      setSystemHolidays(res.systemHolidays.sort());
      setCompanyHolidays(res.companyHolidays.sort());
    } catch (err) {
      console.error('Failed to load holidays:', err);
    }
  }, []);

  useEffect(() => {
    load();
    loadHolidays();
  }, [load, loadHolidays]);

  // ── Live sync: CompanySettings SSE consumer ──
  // When another admin tab (or the master console) updates payroll settings,
  // the backend broadcasts CompanySettings.update. Refetch so two open admin
  // tabs never diverge silently.
  useSSE((event) => {
    if (event.entity === 'CompanySettings' && event.action === 'update') {
      load();
    }
  });

  const handleAddHoliday = async (scope: 'system' | 'company') => {
    if (!newHolidayDate) {
      toast.error('Please select a date');
      return;
    }
    setAddingHoliday(true);
    try {
      await settingsApi.addHoliday(newHolidayDate, scope);
      toast.success(`Holiday added to ${scope === 'system' ? 'system' : 'company'} calendar`);
      setNewHolidayDate('');
      await loadHolidays();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to add holiday');
    } finally {
      setAddingHoliday(false);
    }
  };

  const handleRemoveHoliday = async (date: string, scope: 'system' | 'company') => {
    try {
      await settingsApi.removeHoliday(date, scope);
      toast.success('Holiday removed');
      await loadHolidays();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to remove holiday');
    }
  };

  const updateField = (field: keyof CompanySettings, value: unknown) => {
    setSettings((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const { id, ...data } = settings;
      await settingsApi.updateSettings(data);
      toast.success('Settings saved');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Spinner /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <SettingsIcon className="w-5 h-5 text-brand" />
            <h1 className="text-2xl font-bold">Company Settings</h1>
          </div>
          <p className="text-sm text-muted-foreground">Payroll rules, overtime configuration and geofence management</p>
        </div>
        {activeTab === 'payroll' && (
          <Button
            onClick={handleSave}
            disabled={saving || !settings}
            className="bg-brand hover:bg-brand-dark text-white shadow-lg shadow-brand/20 rounded-xl"
          >
            <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save Settings'}
          </Button>
        )}
      </div>

      {/* Tab navigation — Payroll & Overtime is hidden for Master */}
      <Tabs
        tabs={[
          ...(!isMaster ? [{ id: 'payroll', label: 'Payroll & Overtime', icon: <Clock className="w-4 h-4" /> }] : []),
          { id: 'holidays', label: 'Public Holidays', icon: <CalendarDays className="w-4 h-4" /> },
          { id: 'geofences', label: 'Geofences / Locations', icon: <Radio className="w-4 h-4" /> },
        ]}
        active={activeTab}
        onChange={setActiveTab}
      />

      {/* Payroll settings */}
      {activeTab === 'payroll' && settings && (
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Payroll & Overtime Rules</CardTitle>
            <CardDescription>Configure overtime thresholds and multipliers</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="st-ordinary">Ordinary hours/day</Label>
                <Input id="st-ordinary" type="number" step="0.5" min="1" max="24" value={settings.ordinaryHoursPerDay}
                  onChange={(e) => updateField('ordinaryHoursPerDay', parseFloat(e.target.value) || 8)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="st-threshold">Daily OT threshold (hours)</Label>
                <Input id="st-threshold" type="number" step="0.5" min="1" max="24" value={settings.overtimeThresholdHours}
                  onChange={(e) => updateField('overtimeThresholdHours', parseFloat(e.target.value) || 8)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="st-monthly-threshold">Monthly OT threshold (hours)</Label>
                <Input id="st-monthly-threshold" type="number" min="1" max="500" value={settings.monthlyOvertimeThresholdHours}
                  onChange={(e) => updateField('monthlyOvertimeThresholdHours', parseFloat(e.target.value) || 195)} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-xl border border-border/50 bg-secondary/20 p-4">
                <div>
                  <p className="font-medium text-sm">Use monthly overtime threshold</p>
                  <p className="text-xs text-muted-foreground">Overtime calculated after monthly hours exceed threshold</p>
                </div>
                <Switch checked={settings.useMonthlyOvertimeThreshold}
                  onCheckedChange={(v) => updateField('useMonthlyOvertimeThreshold', v)} aria-label="Monthly overtime threshold" />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border/50 bg-secondary/20 p-4">
                <div>
                  <p className="font-medium text-sm">Sunday overtime enabled</p>
                  <p className="text-xs text-muted-foreground">Sunday work counts as overtime</p>
                </div>
                <Switch checked={settings.sundayOvertimeEnabled}
                  onCheckedChange={(v) => updateField('sundayOvertimeEnabled', v)} aria-label="Sunday overtime" />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border/50 bg-secondary/20 p-4">
                <div>
                  <p className="font-medium text-sm">Public holiday overtime enabled</p>
                  <p className="text-xs text-muted-foreground">Holiday work counts as overtime (takes precedence over Sunday)</p>
                </div>
                <Switch checked={settings.publicHolidayOvertimeEnabled}
                  onCheckedChange={(v) => updateField('publicHolidayOvertimeEnabled', v)} aria-label="Public holiday overtime" />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="st-sunday-mult">Sunday multiplier</Label>
                <Input id="st-sunday-mult" type="number" step="0.1" min="1" max="5" value={settings.sundayOvertimeMultiplier}
                  onChange={(e) => updateField('sundayOvertimeMultiplier', parseFloat(e.target.value) || 1.5)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="st-holiday-mult">Public holiday multiplier</Label>
                <Input id="st-holiday-mult" type="number" step="0.1" min="1" max="5" value={settings.publicHolidayOvertimeMultiplier}
                  onChange={(e) => updateField('publicHolidayOvertimeMultiplier', parseFloat(e.target.value) || 2.0)} />
              </div>
            </div>

            <p className="text-sm text-muted-foreground italic">
              Public holidays are now managed in the dedicated "Public Holidays" tab above.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Public Holidays tab */}
      {activeTab === 'holidays' && (
        <div className="space-y-6">
          {/* Add Holiday */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base">Add Public Holiday</CardTitle>
              <CardDescription>
                {isMaster
                  ? 'As Master, you can add system-wide holidays (applies to all companies) or company-specific holidays.'
                  : 'Add company-specific holidays. System-wide holidays are managed by the platform Master.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-2">
                  <Label htmlFor="holiday-date">Date</Label>
                  <Input
                    id="holiday-date"
                    type="date"
                    value={newHolidayDate}
                    onChange={(e) => setNewHolidayDate(e.target.value)}
                    className="w-48"
                  />
                </div>
                {isMaster && (
                  <Button
                    onClick={() => handleAddHoliday('system')}
                    disabled={addingHoliday || !newHolidayDate}
                    variant="outline"
                    className="gap-2"
                  >
                    <Globe className="w-4 h-4" /> Add to System Calendar
                  </Button>
                )}
                <Button
                  onClick={() => handleAddHoliday('company')}
                  disabled={addingHoliday || !newHolidayDate}
                  className="gap-2 bg-brand hover:bg-brand-dark text-white"
                >
                  <Building2 className="w-4 h-4" /> Add to Company Calendar
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* System-wide holidays */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Globe className="w-4 h-4 text-brand" />
                System-Wide Holidays
              </CardTitle>
              <CardDescription>
                Generic public holidays set by the platform Master. These apply to all companies.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {systemHolidays.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No system-wide holidays configured.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {systemHolidays.map((date) => (
                    <Badge key={date} variant="secondary" className="gap-1.5 py-1.5 px-3 text-sm">
                      {new Date(date + 'T12:00:00').toLocaleDateString('en-ZA', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
                      {isMaster && (
                        <button
                          onClick={() => handleRemoveHoliday(date, 'system')}
                          className="ml-1 text-muted-foreground hover:text-destructive transition-colors"
                          aria-label={`Remove ${date}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Company-specific holidays */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="w-4 h-4 text-amber-500" />
                Company Holidays
              </CardTitle>
              <CardDescription>
                Company-specific dates set by the Admin. These only apply to your company.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {companyHolidays.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No company-specific holidays configured.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {companyHolidays.map((date) => (
                    <Badge key={date} variant="outline" className="gap-1.5 py-1.5 px-3 text-sm">
                      {new Date(date + 'T12:00:00').toLocaleDateString('en-ZA', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
                      <button
                        onClick={() => handleRemoveHoliday(date, 'company')}
                        className="ml-1 text-muted-foreground hover:text-destructive transition-colors"
                        aria-label={`Remove ${date}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Geofences — Enhanced GeofenceManager with address search, presets, distance tester.
          Employee assignment is hidden for Master (managed by tenant admins). */}
      {activeTab === 'geofences' && (
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Geofence Zones / Work Locations</CardTitle>
            <CardDescription>
              Clock-in location validation zones for GPS-based attendance. Employees with an assigned location can only clock in at their assigned geofence; unassigned employees may clock in at any active geofence.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isMaster && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-50 border border-blue-200 dark:bg-blue-950/20 dark:border-blue-900 text-sm text-blue-800 dark:text-blue-300">
                <Globe className="w-4 h-4 mt-0.5 shrink-0" />
                <p>
                  <strong>Master isolation:</strong> You are viewing <strong>global (system-wide) locations only</strong>.
                  Changes made here do not affect any company's geofences. To manage a specific company's
                  work locations, use the <strong>Impersonate</strong> feature from the Master Console.
                </p>
              </div>
            )}
            <GeofenceManager hideAssignEmployees={isMaster} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}