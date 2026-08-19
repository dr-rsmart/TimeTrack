/**
 * Self Clock Widget
 * -----------------
 * Personal clock-in/out widget with live duration timer,
 * break tracking, and today's activity history.
 * Primary interface for employee role.
 */

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Play, Square, Coffee, Clock, MapPin, History, Navigation, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { timeEntryApi, type TimeEntry } from '../../services/api';
import { Button, Card, CardContent, Badge, Spinner } from '../ui';
import { cn } from '../../lib/utils';
import { useAutoGeofence } from '../../hooks/useAutoGeofence';
import { checkGpsAvailability, queryLocationPermissions, getCurrentPosition } from '../../utils/clockInHelper';
import { LocationPermissionModal } from '../location/LocationPermissionModal';

interface SelfClockWidgetProps {
  userEmail: string;
  userRole?: string;
  showClock?: boolean;
  showHistory?: boolean;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function SelfClockWidget({ userEmail, userRole = 'employee', showClock = true, showHistory = true }: SelfClockWidgetProps) {
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);
  const [todayEntries, setTodayEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [breakMinutes, setBreakMinutes] = useState(0);
  
  // Geofence state
  const [gpsAvailable, setGpsAvailable] = useState(true);
  const [locationDenied, setLocationDenied] = useState(false);
  const [showLocationModal, setShowLocationModal] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const [activeRes, entriesRes] = await Promise.all([
        timeEntryApi.active(),
        timeEntryApi.list({ date: today, employeeEmail: userEmail, limit: 50 }),
      ]);
      setActiveEntry(activeRes.active);
      setTodayEntries(entriesRes.items);
    } catch (err) {
      console.error('[SelfClockWidget] Load error:', err);
    } finally {
      setLoading(false);
    }
  }, [userEmail]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Live elapsed timer
  useEffect(() => {
    if (!activeEntry) {
      setElapsed(0);
      return;
    }
    const clockInTime = new Date(activeEntry.clockIn).getTime();
    const updateElapsed = () => setElapsed(Date.now() - clockInTime);
    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [activeEntry]);

  // ── Pre-flight GPS check ──
  useEffect(() => {
    const status = checkGpsAvailability();
    setGpsAvailable(status.available);
    if (status.permission === 'denied') {
      setLocationDenied(true);
      setShowLocationModal(true);
    }
  }, []);

  // ── Auto Geofence Hook ──
  const autoGeo = useAutoGeofence({
    userEmail,
    isClockedIn: !!activeEntry,
    activeEntryId: activeEntry?.id ?? null,
    activeEntry: activeEntry as Record<string, unknown> | null,
    onClockIn: async () => { await loadData(); },
    onClockOut: async () => { await loadData(); },
    enabled: gpsAvailable,
  });

  const handleClockIn = async () => {
    setActionLoading(true);
    try {
      const pos = await getCurrentPosition();
      await timeEntryApi.clockIn(pos?.latitude, pos?.longitude);
      toast.success('Clocked in successfully!', { description: 'Have a productive shift.' });
      await loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Please try again.';
      // Check for geofence violation
      if (msg.includes('outside') || msg.includes('geofence')) {
        toast.error('Clock-in denied', { description: msg });
        setShowLocationModal(true);
      } else {
        toast.error('Clock-in failed', { description: msg });
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleClockOut = async () => {
    setActionLoading(true);
    try {
      const pos = await getCurrentPosition();
      await timeEntryApi.clockOut(breakMinutes > 0 ? breakMinutes : undefined, pos?.latitude, pos?.longitude);
      toast.success('Clocked out successfully!', {
        description: breakMinutes > 0 ? `Break: ${breakMinutes} minutes recorded.` : 'See you next time!',
      });
      setBreakMinutes(0);
      await loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Please try again.';
      if (msg.includes('outside') || msg.includes('geofence')) {
        toast.error('Clock-out denied', { description: msg });
        setShowLocationModal(true);
      } else {
        toast.error('Clock-out failed', { description: msg });
      }
    } finally {
      setActionLoading(false);
    }
  };

  const isClockedIn = !!activeEntry;
  const totalHoursToday = todayEntries.reduce((sum, e) => sum + (e.totalHours ?? 0), 0);

  if (loading) {
    return (
      <Card className="border-border/50">
        <CardContent className="flex items-center justify-center p-12">
          <Spinner className="h-8 w-8" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Main Clock Widget */}
      {showClock && (
        <Card className="relative overflow-hidden border-border/50 shadow-card">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-brand to-brand-light" />
          <CardContent className="p-6">
            <div className="flex flex-col items-center text-center space-y-6">
              {/* Status indicator */}
              <div className="flex flex-col items-center gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-2.5 w-2.5 relative">
                    {isClockedIn && (
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    )}
                    <span className={cn('relative inline-flex rounded-full h-2.5 w-2.5', isClockedIn ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
                  </span>
                  <span className="text-xs font-bold tracking-wider uppercase text-muted-foreground">
                    {isClockedIn ? 'Currently Working' : 'Not Clocked In'}
                  </span>
                </div>

                {/* Auto Geofence Status Badge */}
                {autoGeo.geofence && (
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground bg-secondary/40 px-2.5 py-0.5 rounded-full border border-border/30">
                    <Navigation className={cn('w-3 h-3', autoGeo.isInsideGeofence ? 'text-emerald-500' : 'text-blue-500')} />
                    <span>
                      {autoGeo.autoGeofenceEnabled ? 'Auto-Geofence ON' : 'Auto-Geofence OFF'}: {autoGeo.geofence.name} ({autoGeo.geofence.radius_meters}m radius)
                    </span>
                    {autoGeo.monitorState?.lastDistance !== undefined && (
                      <span className={cn('font-semibold', autoGeo.isInsideGeofence ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                        · ~{autoGeo.monitorState.lastDistance}m
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Timer display */}
              <div className="space-y-1">
                <p className={cn('text-5xl font-bold tabular-nums tracking-tight', isClockedIn ? 'text-foreground' : 'text-muted-foreground/50')}>
                  {isClockedIn ? formatDuration(elapsed) : '00:00:00'}
                </p>
                {isClockedIn && activeEntry && (
                  <p className="text-sm text-muted-foreground flex items-center justify-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    Started at {formatTime(activeEntry.clockIn)}
                    {activeEntry.geofenceName && (
                      <>
                        <span className="text-muted-foreground/50">·</span>
                        <MapPin className="w-3.5 h-3.5" />
                        {activeEntry.geofenceName}
                      </>
                    )}
                  </p>
                )}
              </div>

              {/* Break input (shown when clocked in) */}
              {isClockedIn && (
                <div className="flex items-center gap-3 bg-secondary/50 rounded-xl px-4 py-3">
                  <Coffee className="w-4 h-4 text-amber-500" />
                  <span className="text-sm text-muted-foreground">Break taken:</span>
                  <select
                    value={breakMinutes}
                    onChange={(e) => setBreakMinutes(Number(e.target.value))}
                    className="bg-transparent text-sm font-semibold text-foreground border-none focus:ring-0 cursor-pointer"
                  >
                    <option value={0}>None</option>
                    <option value={15}>15 min</option>
                    <option value={30}>30 min</option>
                    <option value={45}>45 min</option>
                    <option value={60}>60 min</option>
                  </select>
                </div>
              )}

              {/* Action button */}
              <motion.div whileTap={{ scale: 0.97 }} className="w-full">
                {isClockedIn ? (
                  <Button
                    onClick={handleClockOut}
                    disabled={actionLoading}
                    className="w-full h-14 text-base font-semibold bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white shadow-lg shadow-red-500/25 rounded-xl"
                  >
                    {actionLoading ? <Spinner className="h-5 w-5 border-white/30 border-t-white" /> : <Square className="w-5 h-5" />}
                    Clock Out
                  </Button>
                ) : (
                  <Button
                    onClick={handleClockIn}
                    disabled={actionLoading}
                    className="w-full h-14 text-base font-semibold bg-gradient-to-r from-brand to-brand-light hover:from-brand-dark hover:to-brand text-white shadow-lg shadow-brand/25 rounded-xl"
                  >
                    {actionLoading ? <Spinner className="h-5 w-5 border-white/30 border-t-white" /> : <Play className="w-5 h-5" />}
                    Clock In
                  </Button>
                )}
              </motion.div>

              {/* Today's total */}
              <div className="flex items-center justify-center gap-6 pt-2 border-t border-border/50 w-full">
                <div className="text-center">
                  <p className="text-lg font-bold">{totalHoursToday.toFixed(1)}h</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Today Total</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold">{todayEntries.length}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Sessions</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Today's History */}
      {showHistory && (
        <Card className="border-border/50">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <History className="w-4 h-4 text-brand" />
              <h3 className="font-semibold text-sm">Today's Activity</h3>
            </div>
            {todayEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No clock activity today yet.</p>
            ) : (
              <div className="space-y-2">
                {todayEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border/30"
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn('w-2 h-2 rounded-full', entry.status === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/30')} />
                      <div>
                        <p className="text-sm font-medium">
                          {formatTime(entry.clockIn)} — {entry.clockOut ? formatTime(entry.clockOut) : 'Active'}
                        </p>
                        {entry.breakMinutes != null && entry.breakMinutes > 0 && (
                          <p className="text-xs text-muted-foreground">Break: {entry.breakMinutes} min</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {entry.isManualOverride && <Badge variant="warning">Manual</Badge>}
                      {entry.totalHours != null && (
                        <span className="text-sm font-semibold text-brand">{entry.totalHours.toFixed(1)}h</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}