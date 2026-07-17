import { Outlet, Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Users, BarChart3, Settings as SettingsIcon, LogOut, Clock, HelpCircle, Sparkles } from "lucide-react";
import { client } from "@/api/Client";
import { cn } from "@/lib/utils";
import { useUserRole } from "@/hooks/useUserRole";

const allNavItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "manager", "employee"] },
  { path: "/workforce", label: "Workforce", icon: Users, roles: ["admin", "manager"] },
  { path: "/reports", label: "Reports", icon: BarChart3, roles: ["admin", "manager"] },
  { path: "/settings", label: "Settings", icon: SettingsIcon, roles: ["admin"] },
  { path: "/help", label: "Help", icon: HelpCircle, roles: ["admin", "manager", "employee"] },
  { path: "/demo", label: "Demo", icon: Sparkles, roles: ["admin"] },
];

export default function AppLayout() {
  const location = useLocation();
  const { role, loading } = useUserRole();
  const navItems = loading ? [] : allNavItems.filter((item) => item.roles.includes(role));

  return (
    <div className="min-h-screen bg-background">
      {/* Top Nav */}
      <header className="sticky top-0 z-50 bg-card/80 backdrop-blur-xl border-b border-border safe-top">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
                <Clock className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="text-lg font-bold tracking-tight">TimeTrack</span>
            </div>

            <nav className="hidden sm:flex items-center gap-1">
              {navItems.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-md shadow-primary/25"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                    )}
                  >
                    <item.icon className="w-4 h-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <button
              onClick={() => data.auth.logout()}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Bottom Nav */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-xl border-t border-border safe-bottom">
        <div className="flex items-center justify-around px-2" style={{ minHeight: "4.5rem" }}>
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg transition-all",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}
                style={{ minWidth: 44, minHeight: 44, justifyContent: "center", display: "flex" }}
              >
                <item.icon className={cn("w-6 h-6", isActive && "stroke-[2.5]")} />
                <span className="text-[10px] font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 sm:pb-6">
        <Outlet />
      </main>
    </div>
  );
}