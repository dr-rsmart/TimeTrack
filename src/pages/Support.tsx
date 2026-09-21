/**
 * Support (public, unauthenticated)
 * ---------------------------------
 * The support URL declared in App Store submission metadata
 * (https://time-track.tech/support). Routes users to the correct support
 * channel: company administrators first (the app's real support model — the
 * in-app FAQ says the same), then the app-level contact for technical issues.
 * Rendered outside the auth guard in App.tsx.
 *
 * Content SSOT: src/content/supportPage.json. The same JSON is rendered to
 * static HTML by scripts/generate-static-legal-pages.mjs (dist/support.html),
 * which the server serves at GET/HEAD /support. Edit ONLY the JSON to keep
 * the static page and this page in sync.
 */

import { Link } from 'react-router-dom';
import { LifeBuoy, Building2, Mail, BookOpen, ShieldCheck, type LucideIcon } from 'lucide-react';
import support from '../content/supportPage.json';

const SUPPORT_EMAIL = support.contactEmail as string;

const ICONS: Record<string, LucideIcon> = {
  'Workplace & attendance help': Building2,
  'In-app FAQ': BookOpen,
  'App-level technical support': Mail,
  'Privacy & data requests': ShieldCheck,
};

interface SupportContent {
  title: string;
  productLine: string;
  sections: Array<{ heading: string; paragraphs?: string[] }>;
  footerLinks: Array<{ label: string; url: string }>;
}

const content = support as SupportContent;

export default function Support() {
  return (
    <div className="min-h-screen bg-background py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-2">
          <LifeBuoy className="w-7 h-7 text-brand" />
          <h1 className="text-2xl font-bold text-foreground">{content.title}</h1>
        </div>
        <p className="text-xs text-muted-foreground mb-8">{content.productLine}</p>

        <div className="space-y-4">
          {content.sections.map(({ heading, paragraphs }) => {
            const Icon = ICONS[heading] ?? LifeBuoy;
            return (
              <div
                key={heading}
                className="rounded-xl border border-border/50 bg-card/60 p-4 flex gap-3"
              >
                <Icon className="w-5 h-5 text-brand shrink-0 mt-0.5" />
                <div>
                  <h2 className="text-sm font-semibold text-foreground mb-1">{heading}</h2>
                  {(paragraphs ?? []).map((body, index) => (
                    <p key={index} className="text-sm text-muted-foreground leading-relaxed">
                      {body}
                    </p>
                  ))}
                </div>
              </div>
            );
          })}
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
          {content.footerLinks.map((link, index) => (
            <span key={link.url} className="flex items-center gap-4">
              {index > 0 && <span className="text-muted-foreground">·</span>}
              <Link to={link.url} className="text-brand hover:underline">
                {link.label}
              </Link>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
