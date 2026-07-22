import { useState } from "react";
import { client } from "@/api/Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Pencil, Trash2 } from "lucide-react";
import EmployeeForm from "@/components/workforce/EmployeeForm";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const statusColors = {
  active: "bg-chart-2/10 text-chart-2",
  on_leave: "bg-chart-3/10 text-chart-3",
  inactive: "bg-muted text-muted-foreground",
};

const roleColors = {
  admin: "bg-primary/10 text-primary",
  manager: "bg-chart-3/10 text-chart-3",
  employee: "bg-muted text-muted-foreground",
};

function getInitials(name) {
  return (name || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

export default function EmployeeManagement() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => client.entities.Employee.list("-created_date", 500),
  });

  const filtered = employees.filter(
    (e) =>
      e.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      e.email?.toLowerCase().includes(search.toLowerCase()) ||
      e.position?.toLowerCase().includes(search.toLowerCase())
  );

  const saveMutation = useMutation({
    mutationFn: (formData) =>
      editing
        ? client.entities.Employee.update(editing.id, formData)
        : client.entities.Employee.create(formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success(editing ? "Employee updated!" : "Employee added!");
      setEditing(null);
      setFormOpen(false);
    },
    onError: (error: any) => {
      toast.error(error?.message || error?.error || "Failed to save employee. Please try again.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => client.entities.Employee.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success("Employee removed.");
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, or position..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 rounded-xl"
          />
        </div>
        <Button
          onClick={() => { setEditing(null); setFormOpen(true); }}
          className="rounded-xl shrink-0"
        >
          <Plus className="w-4 h-4 mr-1" />
          Add Employee
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-muted/30 rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground text-sm">
          {search ? "No employees match your search." : "No employees yet. Click \"Add Employee\" to get started."}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {filtered.map((emp) => (
            <div key={emp.id} className="bg-card rounded-xl border border-border p-4 flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center shrink-0 overflow-hidden">
                {emp.avatar_url ? (
                  <img src={emp.avatar_url} alt={emp.full_name} className="w-full h-full object-cover" />
                ) : (
                  getInitials(emp.full_name)
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium truncate">{emp.full_name}</p>
                  {emp.role && emp.role !== "employee" && (
                    <Badge variant="secondary" className={cn("text-[10px] capitalize", roleColors[emp.role])}>
                      {emp.role}
                    </Badge>
                  )}
                  <Badge variant="secondary" className={cn("text-[10px]", statusColors[emp.status])}>
                    {emp.status?.replace("_", " ")}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground truncate">{emp.position || "—"}</p>
                <p className="text-xs text-muted-foreground truncate">{emp.email}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => { setEditing(emp); setFormOpen(true); }}
                  className="text-muted-foreground hover:text-foreground p-1.5 transition-colors"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button className="text-muted-foreground hover:text-destructive p-1.5 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="rounded-2xl">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove {emp.full_name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This employee will be removed from the system. Their time entries will remain.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteMutation.mutate(emp.id)}
                        className="rounded-xl bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                      >
                        Remove
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        </div>
      )}

      <EmployeeForm
        open={formOpen}
        onOpenChange={(o) => { setFormOpen(o); if (!o) setEditing(null); }}
        onSave={(data) => saveMutation.mutate(data)}
        existing={editing}
      />
    </div>
  );
}