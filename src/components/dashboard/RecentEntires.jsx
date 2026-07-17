import moment from "moment";
import { Badge } from "@/components/ui/badge";
import { Clock, ArrowRight } from "lucide-react";

function EntryRow({ entry }) {
  const clockIn = moment(entry.clock_in);
  const clockOut = entry.clock_out ? moment(entry.clock_out) : null;
  const hours = entry.total_hours;

  return (
    <div className="flex items-center justify-between py-3.5 border-b border-border/50 last:border-0">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center">
          <Clock className="w-4 h-4 text-accent-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium">{moment(entry.date).format("ddd, MMM D")}</p>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
            <span>{clockIn.format("h:mm A")}</span>
            <ArrowRight className="w-3 h-3" />
            <span>{clockOut ? clockOut.format("h:mm A") : "—"}</span>
          </div>
        </div>
      </div>
      <div className="text-right flex items-center gap-3">
        {hours != null && (
          <span className="text-sm font-semibold">{hours.toFixed(1)}h</span>
        )}
        <Badge
          variant="secondary"
          className={
            entry.status === "clocked_in"
              ? "bg-chart-2/10 text-chart-2 border-chart-2/20"
              : entry.status === "edited"
              ? "bg-chart-3/10 text-chart-3 border-chart-3/20"
              : "bg-accent text-accent-foreground"
          }
        >
          {entry.status === "clocked_in" ? "Active" : entry.status === "edited" ? "Edited" : "Done"}
        </Badge>
      </div>
    </div>
  );
}

export default function RecentEntries({ entries }) {
  if (!entries || entries.length === 0) {
    return (
      <div className="bg-card rounded-2xl border border-border p-6">
        <h3 className="text-base font-semibold mb-4">Recent Entries</h3>
        <p className="text-sm text-muted-foreground text-center py-8">
          No time entries yet. Clock in to get started!
        </p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-2xl border border-border p-6">
      <h3 className="text-base font-semibold mb-2">Recent Entries</h3>
      <div>
        {entries.slice(0, 7).map((entry) => (
          <EntryRow key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}