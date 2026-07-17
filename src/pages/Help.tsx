import { useState } from "react";
import { useUserRole } from "@/hooks/useUserRole";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Clock, Users, Settings, ShieldCheck, HelpCircle, LogIn, LogOut, MapPin } from "lucide-react";

const ROLE_FAQS = {
  admin: [
    { q: "How do I add a new employee?", a: "Go to Workforce → Employees tab, click 'Add Employee', fill in their details including first name, surname, phone, branch, and department, then assign them a role (Admin, Manager, or Employee). Click 'Send Invite' to give them login access." },
    { q: "How do I configure overtime rules?", a: "Navigate to Settings → Overtime tab. Here you can set daily overtime thresholds, enable monthly caps, configure Sunday and public holiday multipliers, and load South African public holidays." },
    { q: "How do I set up geofences for clock-in validation?", a: "Go to Settings → Locations tab. Click 'Add Location', search for a place using Google search, adjust the radius, and save. Only employees within the geofence radius can clock in via WhatsApp." },
    { q: "Can I clock in on behalf of an employee?", a: "Yes. Go to Workforce → Manual Clock-in tab. Select the employee and use the Clock In / Clock Out buttons. The action is recorded with your name as the acting manager." },
    { q: "How do I export payroll data?", a: "Go to Reports → click 'Export Payroll'. Select the date range and payroll format (Sage, Deal, or generic), then download the Excel file." },
    { q: "What's the difference between Admin and Manager roles?", a: "Admins have full access including Settings (overtime rules, geofences, company policies). Managers can manage employees and clock in on their behalf, but cannot change system parameters." },
  ],
  manager: [
    { q: "How do I add a new employee?", a: "Go to Workforce → Employees tab, click 'Add Employee', fill in their details, assign a role, and send them an invitation to log in." },
    { q: "Can I clock in on behalf of an employee?", a: "Yes. Go to Workforce → Manual Clock-in tab. Select the employee and use Clock In / Clock Out. Your name is recorded as the acting manager on the time entry." },
    { q: "Can I edit employee details?", a: "Yes, you can edit employee information including name, position, phone, department, and branch. Click the pencil icon next to any employee to edit their record." },
    { q: "Can I change overtime rules or geofences?", a: "No. Only Admins can modify system parameters like overtime thresholds, work policies, and geofence locations. If you need a change, contact an administrator." },
    { q: "How do I assign shifts?", a: "Go to Workforce → Shifts tab. Click 'Add Shift', select the employee, date, start/end times, and location." },
    { q: "How do I view who's currently clocked in?", a: "The Dashboard shows all active staff in the 'Active Staff' card, and lists employees who haven't clocked in under 'Missing Staff'." },
  ],
  employee: [
    { q: "How do I clock in?", a: "On the Dashboard, click the green 'Clock In' button on the clock widget. The timer starts immediately and shows your elapsed time." },
    { q: "How do I clock out?", a: "Click the 'Clock Out' button on the clock widget. Your total hours are calculated automatically and saved to your history." },
    { q: "Can I see my past time entries?", a: "Yes. Your completed entries for today are shown below the clock widget. For historical reports, contact your manager." },
    { q: "Can I clock in for someone else?", a: "No. Only Admins and Managers can clock in on behalf of other employees. If you forgot to clock in, ask your manager to add a manual entry." },
    { q: "What if I forgot to clock out?", a: "Contact your manager. They can manually clock you out from the Workforce → Manual Clock-in tab and adjust your hours." },
    { q: "Can I edit my own time entries?", a: "No. Only Admins and Managers can edit time entries. If you need a correction, contact your manager." },
  ],
};

const ROLE_GUIDES = {
  admin: {
    icon: ShieldCheck,
    color: "text-primary",
    title: "Admin Guide",
    steps: [
      { icon: Users, text: "Add employees and assign roles (Admin, Manager, Employee)" },
      { icon: MapPin, text: "Set up geofence locations for WhatsApp clock-in validation" },
      { icon: Clock, text: "Configure overtime rules, work days, and public holidays" },
      { icon: LogIn, text: "Clock in on behalf of employees when needed" },
      { icon: Settings, text: "Export payroll reports in Sage, Deal, or generic format" },
    ],
  },
  manager: {
    icon: Users,
    color: "text-chart-3",
    title: "Manager Guide",
    steps: [
      { icon: Users, text: "Add new employees and assign them roles" },
      { icon: LogIn, text: "Clock employees in/out on their behalf" },
      { icon: Clock, text: "Assign shifts and manage the workforce schedule" },
      { icon: Users, text: "Edit employee details (name, phone, department, branch)" },
      { icon: MapPin, text: "Monitor who's clocked in via the Dashboard" },
    ],
  },
  employee: {
    icon: Clock,
    color: "text-chart-2",
    title: "Employee Guide",
    steps: [
      { icon: LogIn, text: "Clock in using the Clock In button on the Dashboard" },
      { icon: LogOut, text: "Clock out when your shift ends" },
      { icon: Clock, text: "View your completed hours for the day" },
      { icon: Users, text: "Contact your manager for manual corrections" },
    ],
  },
};

export default function Help() {
  const { role, loading } = useUserRole();
  const [showRole, setShowRole] = useState(null);

  const activeRole = showRole || role;
  const guide = ROLE_GUIDES[activeRole];
  const faqs = ROLE_FAQS[activeRole];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Help Center</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Guides and FAQs to help you get the most out of TimeTrack
        </p>
      </div>

      {/* Role selector */}
      <div className="flex flex-wrap gap-2">
        {["admin", "manager", "employee"].map((r) => {
          const g = ROLE_GUIDES[r];
          const isActive = activeRole === r;
          return (
            <button
              key={r}
              onClick={() => setShowRole(r)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors capitalize ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-md shadow-primary/25"
                  : "bg-secondary text-secondary-foreground hover:bg-accent"
              }`}
            >
              <g.icon className="w-4 h-4" />
              {r}
            </button>
          );
        })}
      </div>

      {/* Quick start guide */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <guide.icon className={`w-5 h-5 ${guide.color}`} />
            {guide.title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {guide.steps.map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center shrink-0">
                  <step.icon className="w-3.5 h-3.5 text-accent-foreground" />
                </div>
                <p className="text-sm pt-1">{step.text}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* FAQs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <HelpCircle className="w-5 h-5 text-muted-foreground" />
            Frequently Asked Questions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((faq, i) => (
              <AccordionItem key={i} value={`item-${i}`}>
                <AccordionTrigger className="text-sm text-left">{faq.q}</AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground">{faq.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}