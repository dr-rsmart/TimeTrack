/**
 * Support (public, unauthenticated)
 * ---------------------------------
 * The support URL declared in App Store submission metadata
 * (https://time-track.tech/support). Routes users to the correct support
 * channel: company administrators first (the app's real support model — the
 * in-app FAQ says the same), then the app-level contact for technical issues.
 * Rendered outside the auth guard in App.tsx.
 */

import { Link } from 'react-router-dom';
import { LifeBuoy, Building2, Mail, BookOpen, ShieldCheck } from 'lucide-react';

const SUPPORT_EMAIL = 'ricardovsmart@gmail.com';

const cards = [
  {
    icon: Building2,
    title: 'Workplace & attendance help',
    body: 'For missed punches, shift corrections, leave and payroll questions, contact your company administrator or branch manager first — they can amend records directly in TimeTrack (every amendment is audited).',
  },
  {
    icon: BookOpen,
    title: 'In-app FAQ',
    body: 'Signed-in users can open the FAQ from the navigation for setup guides: location permissions, automatic clock-in/out troubleshooting, offline behaviour and notifications.',
  },
  {
    icon: Mail,
    title: 'App-level technical support',
    body: 'For installation problems, bugs, or account-access issues you cannot resolve with your administrator, email the TimeTrack support team. Include your device, app version and a short description.',
  },
  {
    icon: ShieldCheck,
    title: 'Privacy & data requests',
    body: 'Privacy policy, POPIA/GDPR rights requests and data-protection contact details are on the privacy page.',
  },
];

export default function Support() {
  return (
    <div className="min-h-screen bg-background py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-2">
          <LifeBuoy className="w-7 h-7 text-brand" />
          <h1 className="text-2xl font-bold text-foreground">Support</h1>
        </div>
        <p className="text-xs text-muted-foreground mb-8">
          TimeTrack — workforce time tracking, scheduling and payroll
        </p>

        <div className="space-y-4">
          {cards.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-xl border border-border/50 bg-card/60 p-4 flex gap-3"
            >
              <Icon className="w-5 h-5 text-brand shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-semibold text-foreground mb-1">{title}</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-xl border border-border/50 bg-card/60 p-4 text-center">
          <p className="text-sm text-foreground font-medium mb-1">Contact us</p>
          <a
            className="text-sm text-brand underline"
            href={`mailto:${SUPPORT_EMAIL}?subject=TimeTrack%20Support`}
          >
            {SUPPORT_EMAIL}
          </a>
        </div>

        <div className="mt-10 pt-6 border-t border-border/40 flex items-center justify-center gap-4 text-sm">
          <Link to="/privacy" className="text-brand hover:underline">
            Privacy Policy
          </Link>
          <span className="text-muted-foreground">·</span>
          <Link to="/login" className="text-brand hover:underline">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
