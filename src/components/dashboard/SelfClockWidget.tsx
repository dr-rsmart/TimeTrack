import { useState, useEffect } from "react";
import { client } from "@/api/Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Clock, Play, Square, AlertCircle, History } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import moment from "moment";
import { toast } from "sonner";
import { buildClockInPayload, buildClockOutPayload } from "@/utils/clockInHelper";
import { useRealtimeEntity } from "@/hooks/useRealtimeEntity";

/**
 * Self-service clock widget — visible to ALL users.
 * Uses the authenticated user's email to find their Employee record,
 * then lets them clock themselves in/out without manager intervention.
 */
export default function SelfClockWidget({ user }) {
  const [currentTime, setCurrentTime] = useState(moment());
  const [elapsed, setElapsed] = useState("00:00:00");
  const [clocking, setClocking] = useState(false);

  const today = moment().format("YYYY-MM-DD");
  const { data: todayEntries = [] } = useRealtimeEntity("TimeEntry", {
    filter: { date: today },
    sort: "-clock_in",
    limit: 200,
  });

  const userEmail = user?.email;
  const myEntries = todayEntries.filter((e) => e.employee_email === userEmail);
  const activeEntry = myEntries.find((e) => e.status === "clocked_in");

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(moment());
      if (activeEntry) {
        const diff = moment().diff(moment(activeEntry.clock_in));
        const d = moment.duration(diff);
        const h = String(Math.floor(d.asHours())).padStart(2, "0");
        const m = String(d.minutes()).padStart(2, "0");
        const s = String(d.seconds()).padStart(2, "0");
        setElapsed(`${h}:${m}:${s}`);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [activeEntry]);

  const handleClockIn = async () => {
    setClocking(true);
    try {
      const payload = await buildClockInPayload(userEmail, null, false);
      await client.entities.TimeEntry.create(payload);
      toast.success("Clocked in successfully!");
    } catch (err) {
      toast.error(err.message || "Failed to clock in");
    } finally {
      setClocking(false);
    }
  };

  const handleClockOut = async () => {
    setClocking(true);
    try {
      const payload = buildClockOutPayload(activeEntry, null);
      payload.is_manual_override = false;
      payload.clocked_by_id = null;
      payload.clocked_by_name = null;
      await client.entities.TimeEntry.update(activeEntry.id, payload);
      toast.success("Clocked out successfully!");
    } catch (err) {
      toast.error(err.message || "Failed to clock out");
    } finally {
      setClocking(false);
    }
  };

  const isClockedIn = !!activeEntry;

  // Recent personal entries (last 5 completed)
  const recentCompleted = todayEntries
    .filter((e) => e.employee_email === userEmail && e.status !== "clocked_in")
    .slice(0, 5);

  return (
    <div className="space-y-4">
      <Card className="relative overflow-hidden border-0">
        <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary to-primary/80" />
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-40 h-40 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
        <CardContent className="relative z-10 p-6 sm:p-8 text-primary-foreground">
          <div className="flex items-center gap-2 mb-4 text-primary-foreground/70">
            <Clock className="w-4 h-4" />
            <span className="text-sm font-medium">{currentTime.format("dddd, MMMM D, YYYY")}</span>
          </div>

          <div className="text-4xl sm:text-5xl font-light tracking-tight mb-1">
            {currentTime.format("h:mm")}
            <span className="text-2xl sm:text-3xl ml-1">{currentTime.format("A")}</span>
          </div>

          <AnimatePresence mode="wait">
            {isClockedIn ? (
              <motion.div
                key="in"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mt-6"
              >
                <p className="text-sm text-primary-foreground/70 mb-1">Time elapsed</p>
                <p className="text-3xl font-mono font-semibold tracking-wider">{elapsed}</p>
                <p className="text-xs text-primary-foreground/50 mt-1">
                  Since {moment(activeEntry.clock_in).format("h:mm A")}
                </p>
                <Button
                  onClick={handleClockOut}
                  disabled={clocking}
                  className="mt-5 bg-white/20 hover:bg-white/30 text-white border-0 backdrop-blur-sm h-12 px-8 text-base font-semibold rounded-xl"
                >
                  <Square className="w-4 h-4 mr-2 fill-current" />
                  Clock Out
                </Button>
              </motion.div>
            ) : (
              <motion.div
                key="out"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mt-6"
              >
                <p className="text-sm text-primary-foreground/70 mb-3">You're not clocked in</p>
                <Button
                  onClick={handleClockIn}
                  disabled={clocking}
                  className="bg-white text-primary hover:bg-white/90 border-0 h-12 px-8 text-base font-semibold rounded-xl shadow-lg shadow-black/10"
                >
                  <Play className="w-4 h-4 mr-2 fill-current" />
                  Clock In
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* Today's history */}
      {recentCompleted.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <History className="w-4 h-4 text-muted-foreground" />
              <p className="text-sm font-medium">Today's History</p>
            </div>
            <div className="space-y-2">
              {recentCompleted.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between text-sm py-1">
                  <span className="text-muted-foreground">
                    {moment(entry.clock_in).format("HH:mm")} – {entry.clock_out ? moment(entry.clock_out).format("HH:mm") : "—"}
                  </span>
                  <span className="font-medium">{entry.total_hours?.toFixed(1) || "0"}h</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {!userEmail && (
        <div className="flex items-center gap-3 bg-destructive/5 border border-destructive/20 rounded-xl p-4">
          <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
          <p className="text-sm text-destructive">Unable to identify your account. Please contact an administrator.</p>
        </div>
      )}
    </div>
  );
}