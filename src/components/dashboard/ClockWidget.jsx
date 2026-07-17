import { useState, useEffect } from "react";
import { Clock, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import moment from "moment";

export default function ClockWidget({ activeEntry, onClockIn, onClockOut, isLoading }) {
  const [currentTime, setCurrentTime] = useState(moment());
  const [elapsed, setElapsed] = useState("00:00:00");

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(moment());
      if (activeEntry) {
        const start = moment(activeEntry.clock_in);
        const diff = moment().diff(start);
        const duration = moment.duration(diff);
        const hours = String(Math.floor(duration.asHours())).padStart(2, "0");
        const mins = String(duration.minutes()).padStart(2, "0");
        const secs = String(duration.seconds()).padStart(2, "0");
        setElapsed(`${hours}:${mins}:${secs}`);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [activeEntry]);

  const isClockedIn = !!activeEntry;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary to-primary/80 p-6 sm:p-8 text-primary-foreground">
      <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
      <div className="absolute bottom-0 left-0 w-40 h-40 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
      
      <div className="relative z-10">
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
              key="clocked-in"
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
                onClick={onClockOut}
                disabled={isLoading}
                className="mt-5 bg-white/20 hover:bg-white/30 text-white border-0 backdrop-blur-sm h-12 px-8 text-base font-semibold rounded-xl"
              >
                <Square className="w-4 h-4 mr-2 fill-current" />
                Clock Out
              </Button>
            </motion.div>
          ) : (
            <motion.div
              key="clocked-out"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-6"
            >
              <p className="text-sm text-primary-foreground/70 mb-3">You're not clocked in</p>
              <Button
                onClick={onClockIn}
                disabled={isLoading}
                className="bg-white text-primary hover:bg-white/90 border-0 h-12 px-8 text-base font-semibold rounded-xl shadow-lg shadow-black/10"
              >
                <Play className="w-4 h-4 mr-2 fill-current" />
                Clock In
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}