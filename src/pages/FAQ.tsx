/**
 * Frequently Asked Questions
 * ---------------------------
 * Self-service guidance for the TimeTrack web interface and native mobile
 * shell. This page is intentionally static so the same explanation is
 * available to every authenticated role and does not depend on tenant data.
 */

import { useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Clock3,
  HelpCircle,
  MapPin,
  Menu,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui';
import { cn } from '../lib/utils';

interface FAQItem {
  question: string;
  answer: string;
  bullets?: string[];
}

interface FAQSection {
  id: string;
  title: string;
  description: string;
  icon: typeof BookOpen;
  items: FAQItem[];
}

const sections: FAQSection[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    description: 'The basics of signing in and finding your way around TimeTrack.',
    icon: BookOpen,
    items: [
      {
        question: 'What is TimeTrack used for?',
        answer:
          'TimeTrack helps your organisation manage shifts, record attendance, review worked hours, and keep payroll-related time information in one place. The screens and actions available to you depend on your role.',
      },
      {
        question: 'How do I sign in?',
        answer:
          'Open the TimeTrack web address or the TimeTrack mobile app, enter the email address and password provided by your organisation, and select Sign in. If you have been asked to change a default password, complete that step before using the rest of the app.',
      },
      {
        question: 'What do the main navigation options do?',
        answer:
          'Dashboard gives you a quick view of your work or team activity. Shifts shows scheduled work. Time is where clocking and recent time entries are managed. Workforce, Reports, Audit, Settings, and Register appear only for roles that have access to those areas. Profile contains your personal account details.',
      },
    ],
  },
  {
    id: 'clocking',
    title: 'Clocking in and out',
    description: 'How to record a work session and what happens to your hours.',
    icon: Clock3,
    items: [
      {
        question: 'How do I clock in and clock out manually?',
        answer:
          "Open Dashboard or Time and select Clock In when you start working. When you finish, select Clock Out, enter any break minutes when prompted, and confirm. The active timer and today's activity show whether your session is currently open.",
        bullets: [
          'Clock In starts one active work session for your account.',
          'Clock Out closes the active session and records optional break time.',
          'A second clock-in is not allowed while an active session already exists.',
        ],
      },
      {
        question: 'What is automatic clock-in/out?',
        answer:
          'When automatic clock-in/out is enabled and you have an assigned work location, TimeTrack monitors your location for a confirmed geofence crossing. Entering an assigned location can start a session automatically; leaving all assigned locations can close it automatically. The system ignores unreliable GPS readings and confirms a crossing to reduce accidental punches caused by GPS drift.',
      },
      {
        question: 'Why did automatic clocking take a moment to happen?',
        answer:
          'TimeTrack waits for reliable location readings and more than one confirming reading before acting. This prevents a single inaccurate GPS fix from clocking you in or out while you are near a boundary. Network connectivity, device battery settings, and the operating system can also delay background location updates.',
      },
      {
        question: 'What should I do if I forgot to clock in or out?',
        answer:
          'Tell your manager or administrator. Users with the appropriate permissions can use Clock On Behalf of Staff for a missed live punch or Add Manual Time Entry for a completed shift on a previous date. Manual changes are labelled as overrides and recorded in the audit trail.',
      },
    ],
  },
  {
    id: 'location',
    title: 'Location and automatic clocking',
    description: 'Understand geofences, permission choices, and which option is right for you.',
    icon: MapPin,
    items: [
      {
        question: 'Why does TimeTrack ask for my location?',
        answer:
          'Location is used to validate a clocking action against your assigned work location and, when enabled, to detect arrival and departure for automatic clocking. TimeTrack uses location to make the attendance decision; the app does not need to show your route or continuously record a travel history.',
      },
      {
        question:
          'What is the difference between “Allow all the time” / “Always” and “Allow while using the app”?',
        answer:
          'These options control whether the mobile operating system may deliver location updates when TimeTrack is not on screen. Allow all the time on Android, or Always on iOS, permits the native TimeTrack app to monitor an assigned work location while the app is minimised, the phone is locked, or the app is closed. That is the permission needed for the most reliable automatic clock-in/out.',
        bullets: [
          'Allow all the time / Always: supports background geofence monitoring, including automatic clock-out after you leave work while the app is not open.',
          'Allow while using the app: location is available while TimeTrack is open and active. Manual clocking can work in the foreground, but automatic clock-out is not reliable after the app is backgrounded or closed.',
          'On a desktop browser, the browser location permission applies while the TimeTrack page is available. A browser tab that is closed, suspended, or denied location cannot provide dependable background monitoring.',
        ],
      },
      {
        question: 'How is manual clocking different from automatic clocking?',
        answer:
          'Manual clocking is user-initiated: you choose Clock In or Clock Out in the interface. Automatic clocking is location-initiated: TimeTrack responds to a confirmed arrival or departure from an assigned work location. Manual clocking is the best option when you do not want background location access or when your device cannot provide it.',
      },
      {
        question: 'Can I turn automatic clock-in/out off?',
        answer:
          'Yes. Turn off the automatic clock-in/out option when it is available in your TimeTrack controls. You will then need to use Clock In and Clock Out manually. Turning the feature off does not delete previous time entries or change completed attendance records.',
      },
      {
        question: 'What is a work location or geofence?',
        answer:
          'A work location is a configured area around a site, such as an office or branch. Your organisation assigns one or more locations to you. TimeTrack uses the configured boundary, your current GPS position, and a small tolerance for GPS accuracy when deciding whether a clocking action is valid.',
      },
    ],
  },
  {
    id: 'shifts-time',
    title: 'Shifts and time history',
    description: 'Find your schedule and review the attendance records created for you.',
    icon: Smartphone,
    items: [
      {
        question: 'Where can I see my shifts?',
        answer:
          'Open Shifts from the navigation. Employees can review their scheduled shifts, while managers and administrators may also have tools to schedule or update shifts depending on their permissions.',
      },
      {
        question: 'Where can I see my recorded hours?',
        answer:
          "Open Dashboard for today's activity or Time for the recent time-entry list. Entries show clock-in and clock-out times, break minutes, total hours, work location when available, and whether an entry was manually adjusted.",
      },
      {
        question: 'What does “Manual” mean beside a time entry?',
        answer:
          'Manual means the entry was created or adjusted by an authorised user instead of being produced by the normal self-service punch. It may have been entered for a missed shift or recorded by a manager or administrator on behalf of staff. The reason and acting user are retained in the audit trail.',
      },
      {
        question: 'What happens if I lose internet access?',
        answer:
          'A clocking request needs to reach the TimeTrack service to be recorded. Reconnect to the internet and retry if a request fails. The mobile shell shows an offline message and retries loading when connectivity returns; it does not guarantee that a manual punch made while fully offline has been saved.',
      },
    ],
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    description: 'A few quick checks when location or clocking does not work as expected.',
    icon: AlertTriangle,
    items: [
      {
        question: 'Location access was denied. How do I fix it?',
        answer:
          'On a phone, open the device Settings, find TimeTrack (or the browser you use for the web interface), open Permissions, and allow Location. For automatic clocking while the app is closed, choose Allow all the time on Android or Always on iOS. On desktop, select the lock or site-settings icon beside the address bar and change TimeTrack Location to Allow, then refresh the page.',
        bullets: [
          'Make sure the device-wide Location/GPS switch is on.',
          'Move outdoors or near a window if the GPS signal is poor.',
          'Disable battery restrictions for the native TimeTrack app if background events are delayed.',
          'If you do not want to grant background location, use manual Clock In and Clock Out instead.',
        ],
      },
      {
        question: 'I am at work, but automatic clock-in did not happen. What should I check?',
        answer:
          'Confirm that automatic clock-in/out is enabled, you are assigned to the correct work location, and the device has a reliable internet connection. Check that location permission was not changed to “while using” or denied, and open TimeTrack once so it can refresh your assignment. If you need to start immediately, use manual Clock In and contact your manager if the issue continues.',
      },
      {
        question: 'I left work, but I was not automatically clocked out. What should I do?',
        answer:
          'The native app needs background location permission to detect departure when it is not open. Check that permission is set to Allow all the time / Always, that battery optimisation is not stopping TimeTrack, and that the phone has connectivity. If automatic clock-out still does not occur, open Time and clock out manually, then notify your manager if the recorded time needs correction.',
      },
    ],
  },
];

function FAQAccordionItem({ item, itemId }: { item: FAQItem; itemId: string }) {
  const [open, setOpen] = useState(false);
  const answerId = `${itemId}-answer`;

  return (
    <div className="border-b border-border/50 last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={answerId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-4 py-4 text-left text-sm font-semibold transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span>{item.question}</span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180 text-brand',
          )}
        />
      </button>
      {open && (
        <div id={answerId} className="pb-5 pr-8 text-sm leading-6 text-muted-foreground">
          <p>{item.answer}</p>
          {item.bullets && (
            <ul className="mt-3 space-y-2">
              {item.bullets.map((bullet) => (
                <li key={bullet} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-1 h-3.5 w-3.5 shrink-0 text-brand" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function FAQ() {
  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-brand/20 bg-gradient-to-br from-brand/10 via-card to-card p-6 shadow-card sm:p-8">
        <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-brand/10 blur-3xl" />
        <div className="relative z-10 max-w-3xl">
          <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand">
            <HelpCircle className="h-4 w-4" />
            Help centre
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            Frequently Asked Questions
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
            Learn how to use TimeTrack, record your hours, and choose the right location permission
            for automatic or manual clocking.
          </p>
        </div>
      </section>

      <Card className="border-brand/20 bg-brand/5">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
            <div>
              <p className="text-sm font-semibold">The short version</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Use <strong className="text-foreground">Allow all the time / Always</strong> for
                background automatic clocking on mobile. Use{' '}
                <strong className="text-foreground">Allow while using the app</strong> for
                foreground location and manual clocking. Manual Clock In and Clock Out remain the
                fallback when background access is unavailable or not preferred.
              </p>
            </div>
          </div>
          <a
            href="#location"
            className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-brand hover:text-brand-dark"
          >
            Compare options <span aria-hidden="true">→</span>
          </a>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[15rem_1fr] lg:items-start">
        <nav aria-label="FAQ sections" className="hidden lg:block lg:sticky lg:top-24">
          <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <Menu className="h-3.5 w-3.5" /> Browse topics
          </p>
          <div className="space-y-1">
            {sections.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="block rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
              >
                {section.title}
              </a>
            ))}
          </div>
        </nav>

        <div className="space-y-6">
          {sections.map((section) => {
            const SectionIcon = section.icon;
            return (
              <Card
                key={section.id}
                id={section.id}
                className="scroll-mt-24 border-border/50 shadow-card"
              >
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/10 text-brand">
                      <SectionIcon className="h-4.5 w-4.5" />
                    </span>
                    {section.title}
                  </CardTitle>
                  <p className="pl-11 text-sm text-muted-foreground">{section.description}</p>
                </CardHeader>
                <CardContent className="pt-0">
                  {section.items.map((item, index) => (
                    <FAQAccordionItem
                      key={item.question}
                      item={item}
                      itemId={`${section.id}-${index}`}
                    />
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          GPS and background activity depend on your device, operating system, browser, battery
          settings, and network. If an automatic event is missed, use the manual clocking controls
          and ask an authorised manager or administrator to correct the entry if necessary.
        </p>
      </div>
    </div>
  );
}
