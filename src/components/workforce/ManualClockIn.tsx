import { useState } from "react";
import { client } from "@/api/Client";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LogIn, LogOut, Clock, ShieldCheck, UserCog } from "lucide-react";
import moment from "moment";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useRealtimeEntity } from "@/hooks/useRealtimeEntity";
import { useUserRole } from "@/hooks/useUserRole";
import { buildClockInPayload, buildClockOutPayload } from "@/utils/clockInHelper";

export default function ManualClockIn() {
  const queryClient = useQueryClient();
  const [selectedEmail, setSelectedEmail] = useState("");
  const { user, canManage } = useUserRole();

  const { data: employees = [] } = useRealtimeEntity("Employee", { sort: "-created_date", limit: 500 });

  const today = moment().format("YYYY-MM-DD");
  const { data: todayEntries = [] } = useRealtimeEntity("TimeEntry", {
    filter: { date: today },
    sort: "-clock_in",
    limit: 200,
  });

  const isAdmin = canManage;

  const selectedEmployee = employees.find((e) => e.email === selectedEmail);
  const employeeEntries = todayEntries.filter((e) => e.employee_email === selectedEmail);
  const activeEntry = employeeEntries.find((e) => e.status === "clocked_in");

  const clockInMutation = useMutation({
    mutationFn: async () => {
      const payload = await buildClockInPayload(selectedEmail, user);
      return client.entities.TimeEntry.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timeEntries"] });
      toast.success(`${selectedEmployee?.full_name} clocked in!`);
    },
    onError: (err) => {
      toast.error(err.message || "Failed to clock in");
    },
  });

  const clockOutMutation = useMutation({
    mutationFn: async () => {
      const payload = buildClockOutPayload(activeEntry, user);
      return client.entities.TimeEntry.update(activeEntry.id, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timeEntries"] });
      toast.success(`${selectedEmployee?.full_name} clocked out!`);
    },
    onError: (err) => {
      toast.error(err.message || "Failed to clock out");
    },
  });

  if (!isAdmin) {
    return (
      <div className="bg-card rounded-2xl border border-border p-8 text-center">
        <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mx-auto mb-3">
          <UserCog className="w-6 h-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium">Manager access required</p>
        <p className="text-xs text-muted-foreground mt-1">
          Only admins and managers can manually clock employees in and out.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Manager override banner */}
      <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-xl p-4">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <ShieldCheck className="w-4 h-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-medium">Manager Override Active</p>
          <p className="text-xs text-muted-foreground">
            Clock actions are recorded with your name as the acting manager
          </p>
        </div>
      </div>

      {/* Clock-in panel */}
      <div className="bg-card rounded-2xl border border-border p-6">
        <h3 className="text-base font-semibold mb-4">Manual Clock-in / Clock-out</h3>
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium mb-2">Select Employee</p>
            <Select value={selectedEmail} onValueChange={setSelectedEmail}>
              <SelectTrigger className="rounded-xl"><SelectValue placeholder="Choose an employee..." /></SelectTrigger>
              <SelectContent>
                {employees.filter((e) => e.status === "active").map((emp) => (
                  <SelectItem key={emp.id} value={emp.email}>
                    {emp.full_name} {emp.position ? `— ${emp.position}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedEmail && (
            <div className="flex items-center gap-3">
              {activeEntry ? (
                <>
                  <div className="flex-1 bg-chart-2/5 border border-chart-2/20 rounded-xl p-4">
                    <p className="text-sm text-muted-foreground">Currently clocked in since</p>
                    <p className="text-lg font-bold text-chart-2">
                      {moment(activeEntry.clock_in).format("HH:mm")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      ({moment().diff(moment(activeEntry.clock_in), "hours", true).toFixed(1)}h so far)
                    </p>
                  </div>
                  <Button
                    onClick={() => clockOutMutation.mutate()}
                    disabled={clockOutMutation.isPending}
                    className="rounded-xl bg-chart-4 hover:bg-chart-4/90 text-white border-0"
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    Clock Out
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex-1 bg-muted/30 border border-border rounded-xl p-4">
                    <p className="text-sm text-muted-foreground">Not clocked in today</p>
                    <p className="text-lg font-bold">Ready to start</p>
                  </div>
                  <Button
                    onClick={() => clockInMutation.mutate()}
                    disabled={clockInMutation.isPending}
                    className="rounded-xl"
                  >
                    <LogIn className="w-4 h-4 mr-2" />
                    Clock In
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Today's entries */}
      <div className="bg-card rounded-2xl border border-border p-6">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-base font-semibold">Today's Clock Events</h3>
          <span className="ml-auto text-xs text-muted-foreground">{todayEntries.length} entries</span>
        </div>
        {todayEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No clock events recorded today.</p>
        ) : (
          <div className="space-y-2">
            {todayEntries.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                <div className={cn(
                  "w-2 h-2 rounded-full shrink-0",
                  entry.status === "clocked_in" ? "bg-chart-2" : "bg-muted-foreground"
                )} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{entry.employee_name}</p>
                    {entry.is_manual_override && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                        <ShieldCheck className="w-2.5 h-2.5" />
                        by {entry.clocked_by_name || "Manager"}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    In: {moment(entry.clock_in).format("HH:mm")}
                    {entry.clock_out && ` · Out: ${moment(entry.clock_out).format("HH:mm")}`}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  {entry.status === "clocked_in" ? (
                    <span className="text-xs font-medium text-chart-2">Active</span>
                  ) : (
                    <span className="text-xs font-medium">{entry.total_hours?.toFixed(1)}h</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}