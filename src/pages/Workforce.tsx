import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import EmployeeManagement from "@/components/workforce/EmployeeManagement";
import ShiftManagement from "@/components/workforce/ShiftManagement";
import ManualClockIn from "@/components/workforce/ManualClockIn";
import { useUserRole } from "@/hooks/useUserRole";
import { ShieldAlert } from "lucide-react";

export default function Workforce() {
  const { canManage } = useUserRole();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Workforce & Shifts</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage employees, assign shifts, and handle clock-ins
        </p>
      </div>

      {!canManage ? (
        <div className="bg-card rounded-2xl border border-border p-8 text-center max-w-md mx-auto">
          <div className="w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center mx-auto mb-3">
            <ShieldAlert className="w-6 h-6 text-destructive" />
          </div>
          <p className="text-sm font-medium">Manager access required</p>
          <p className="text-xs text-muted-foreground mt-1">
            Workforce management is available to admins and managers only.
          </p>
        </div>
      ) : (
      <Tabs defaultValue="employees">
        <TabsList className="bg-secondary">
          <TabsTrigger value="employees">Employees</TabsTrigger>
          <TabsTrigger value="shifts">Shifts</TabsTrigger>
          <TabsTrigger value="clockin">Act on Behalf</TabsTrigger>
        </TabsList>
        <TabsContent value="employees" className="mt-6">
          <EmployeeManagement canManage={canManage} />
        </TabsContent>
        <TabsContent value="shifts" className="mt-6">
          <ShiftManagement />
        </TabsContent>
        <TabsContent value="clockin" className="mt-6">
          <ManualClockIn />
        </TabsContent>
      </Tabs>
      )}
    </div>
  );
}