import { useState } from "react";
import { client } from "@/api/Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRealtimeEntity } from "@/hooks/useRealtimeEntity";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, MapPin, Clock, X } from "lucide-react";
import ShiftForm from "@/components/workforce/ShiftForm";
import { toast } from "sonner";
import moment from "moment";
import { cn } from "@/lib/utils";

const statusColors = {
  scheduled: "bg-primary/10 text-primary",
  active: "bg-chart-2/10 text-chart-2",
  completed: "bg-muted text-muted-foreground",
  cancelled: "bg-destructive/10 text-destructive",
  no_show: "bg-chart-4/10 text-chart-4",
};

const typeLabels = {
  morning: "Morning",
  afternoon: "Afternoon",
  night: "Night",
  full_day: "Full Day",
};

export default function ShiftManagement() {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState("today");

  const { data: shifts = [] } = useRealtimeEntity("Shift", { sort: "-date", limit: 500 });
  const { data: employees = [] } = useRealtimeEntity("Employee", { sort: "-created_date", limit: 500 });

  const today = moment().format("YYYY-MM-DD");
  const tomorrow = moment().add(1, "day").format("YYYY-MM-DD");
  const weekEnd = moment().endOf("isoWeek").format("YYYY-MM-DD");

  const filtered = shifts.filter((s) => {
    if (s.status === "cancelled") return false;
    if (filter === "today") return s.date === today;
    if (filter === "tomorrow") return s.date === tomorrow;
    if (filter === "week") return s.date >= today && s.date <= weekEnd;
    return true;
  });

  const grouped = {};
  filtered.forEach((s) => {
    if (!grouped[s.date]) grouped[s.date] = [];
    grouped[s.date].push(s);
  });
  const sortedDates = Object.keys(grouped).sort();

  const saveMutation = useMutation({
    mutationFn: (formData) =>
      editing
        ? client.entities.Shift.update(editing.id, formData)
        : client.entities.Shift.create(formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
      toast.success(editing ? "Shift updated!" : "Shift created!");
      setEditing(null);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id) => client.entities.Shift.update(id, { status: "cancelled" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
      toast.success("Shift cancelled.");
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList className="bg-secondary">
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="tomorrow">Tomorrow</TabsTrigger>
            <TabsTrigger value="week">This Week</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button onClick={() => { setEditing(null); setFormOpen(true); }} className="rounded-xl">
          <Plus className="w-4 h-4 mr-1" />
          Create Shift
        </Button>
      </div>

      {sortedDates.length === 0 ? (
        <div className="bg-muted/30 rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground text-sm">
          No shifts scheduled. Click "Create Shift" to assign one.
        </div>
      ) : (
        <div className="space-y-5">
          {sortedDates.map((date) => (
            <div key={date}>
              <p className="text-xs font-semibold text-muted-foreground mb-2">
                {moment(date).format("dddd, DD MMM YYYY")}
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                {grouped[date].map((shift) => (
                  <div key={shift.id} className="bg-card rounded-xl border border-border p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{shift.employee_name}</p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {shift.start_time} – {shift.end_time}
                          </span>
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                            {typeLabels[shift.shift_type] || shift.shift_type}
                          </span>
                        </div>
                        {shift.location && (
                          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {shift.location}
                          </p>
                        )}
                      </div>
                      <Badge variant="secondary" className={cn("text-[10px] shrink-0", statusColors[shift.status])}>
                        {shift.status?.replace("_", " ")}
                      </Badge>
                    </div>
                    {shift.status === "scheduled" && (
                      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs h-7 rounded-lg"
                          onClick={() => { setEditing(shift); setFormOpen(true); }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs h-7 rounded-lg text-destructive hover:text-destructive"
                          onClick={() => cancelMutation.mutate(shift.id)}
                        >
                          <X className="w-3 h-3 mr-1" />
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <ShiftForm
        open={formOpen}
        onOpenChange={(o) => { setFormOpen(o); if (!o) setEditing(null); }}
        onSave={(data) => saveMutation.mutate(data)}
        existing={editing}
        employees={employees.filter((e) => e.status === "active")}
      />
    </div>
  );
}