import { Users, Clock } from "lucide-react";
import moment from "moment";

function getElapsedTime(clockIn) {
  const dur = moment.duration(moment().diff(moment(clockIn)));
  const h = Math.floor(dur.asHours());
  const m = dur.minutes();
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function ActiveStaffCard({ activeEntries = [] }) {
  return (
    <div className="bg-card rounded-2xl border border-border p-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-chart-2/10 flex items-center justify-center">
          <Users className="w-4 h-4 text-chart-2" />
        </div>
        <h3 className="text-base font-semibold">Active Staff</h3>
        <span className="ml-auto text-xs font-medium text-chart-2 bg-chart-2/10 px-2 py-0.5 rounded-full">
          {activeEntries.length} clocked in
        </span>
      </div>

      {activeEntries.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">No one is clocked in right now.</p>
      ) : (
        <div className="space-y-2">
          {activeEntries.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
              <div className="relative">
                <div className="w-9 h-9 rounded-full bg-accent text-accent-foreground text-xs font-bold flex items-center justify-center overflow-hidden">
                  {entry.avatar_url ? (
                    <img src={entry.avatar_url} alt={entry.employee_name} className="w-full h-full object-cover" />
                  ) : (
                    (entry.employee_name || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
                  )}
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-chart-2 border-2 border-card" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{entry.employee_name}</p>
                <p className="text-xs text-muted-foreground">
                  Since {moment(entry.clock_in).format("HH:mm")}
                </p>
              </div>
              <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {getElapsedTime(entry.clock_in)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}