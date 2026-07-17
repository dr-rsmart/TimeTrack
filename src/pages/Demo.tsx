// @ts-nocheck
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Shield, Users, User, LayoutDashboard, BarChart3, ShieldAlert,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DemoRoleProvider, useDemoRole } from "@/context/DemoRoleContext";
import { useUserRole } from "@/hooks/useUserRole";
import Dashboard from "@/pages/Dashboard";
import Workforce from "@/pages/Workforce";
import Reports from "@/pages/Reports";
import MockDataGenerator from "@/components/demo/MockDataGenerator";

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin", icon: Shield, color: "bg-primary/10 text-primary" },
  { value: "manager", label: "Manager", icon: Users, color: "bg-chart-3/10 text-chart-3" },
  { value: "employee", label: "Employee", icon: User, color: "bg-chart-2/10 text-chart-2" },
];

function RoleSelector() {
  const { demoRole, setDemoRole } = useDemoRole();

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-sm font-medium text-muted-foreground mr-1">Viewing as:</span>
      {ROLE_OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const isActive = demoRole === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => setDemoRole(opt.value)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              isActive
                ? "bg-primary text-primary-foreground shadow-md shadow-primary/25"
                : "bg-secondary text-secondary-foreground hover:bg-accent"
            }`}
          >
            <Icon className="w-4 h-4" />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function DemoContent() {
  const { actualRole } = useUserRole();
  const { demoRole } = useDemoRole();
  const [tab, setTab] = useState("dashboard");

  if (actualRole !== "admin") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Demo Mode</h1>
        </div>
        <div className="bg-card rounded-2xl border border-border p-8 text-center max-w-md mx-auto">
          <div className="w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center mx-auto mb-3">
            <ShieldAlert className="w-6 h-6 text-destructive" />
          </div>
          <p className="text-sm font-medium">Admin access required</p>
          <p className="text-xs text-muted-foreground mt-1">
            Demo mode is only available to administrators.
          </p>
        </div>
      </div>
    );
  }

  const currentRoleLabel = ROLE_OPTIONS.find((r) => r.value === demoRole)?.label || "Admin";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Demo Mode</h1>
            <p className="text-sm text-muted-foreground">
              Fully interactive — switch roles to see how the app changes
            </p>
          </div>
        </div>
        <RoleSelector />
      </div>

      {/* Demo banner */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-xl p-4"
      >
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <ShieldAlert className="w-4 h-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-medium">
            Simulating <span className="text-primary">{currentRoleLabel}</span> role
          </p>
          <p className="text-xs text-muted-foreground">
            All actions are real — clock-ins, shift changes, and reports affect your actual data.
          </p>
        </div>
      </motion.div>

      {/* Functional tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-secondary">
          <TabsTrigger value="dashboard">
            <LayoutDashboard className="w-4 h-4 mr-1.5" />
            Dashboard
          </TabsTrigger>
          <TabsTrigger value="workforce">
            <Users className="w-4 h-4 mr-1.5" />
            Workforce
          </TabsTrigger>
          <TabsTrigger value="reports">
            <BarChart3 className="w-4 h-4 mr-1.5" />
            Reports
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={demoRole}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
            >
              <Dashboard />
            </motion.div>
          </AnimatePresence>
        </TabsContent>

        <TabsContent value="workforce" className="mt-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={demoRole}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
            >
              <Workforce />
            </motion.div>
          </AnimatePresence>
        </TabsContent>

        <TabsContent value="reports" className="mt-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={demoRole}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
            >
              <Reports />
            </motion.div>
          </AnimatePresence>
        </TabsContent>
      </Tabs>

      {/* Mock data generator */}
      <MockDataGenerator />
    </div>
  );
}

export default function Demo() {
  return (
    <DemoRoleProvider>
      <DemoContent />
    </DemoRoleProvider>
  );
}