/**
 * Privacy Policy (public, unauthenticated)
 * ----------------------------------------
 * Required by Apple App Store (privacy URL declared in submission metadata:
 * https://time-track.tech/privacy) and Google Play (Data Safety policy URL).
 * Content reflects TimeTrack's ACTUAL documented processing practices:
 * geofence-based attendance, POPIA/GDPR posture (IP redaction for managers,
 * append-only audit, retention policies, RLS tenant isolation).
 * Rendered outside the auth guard in App.tsx so store reviewers and data
 * subjects can read it without an account.
 *
 * Content SSOT: src/content/privacyPolicy.json. The same JSON is rendered
 * to static HTML by scripts/generate-static-legal-pages.mjs (dist/privacy.html),
 * which the server serves at GET/HEAD /privacy so store-review crawlers can
 * read the full policy without executing JavaScript. Edit ONLY the JSON to
 * keep the static page and this page in sync.
 */

import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import policy from '../content/privacyPolicy.json';

interface PolicySection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

interface PrivacyPolicyContent {
  title: string;
  productLine: string;
  updated: string;
  sections: PolicySection[];
  footerLinks: Array<{ label: string; url: string }>;
}

const content = policy as PrivacyPolicyContent;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="text-base font-semibold text-foreground mb-2">{title}</h2>
      <div className="text-sm text-muted-foreground leading-relaxed space-y-2">{children}</div>
    </section>
  );
}

/**
 * Renders the inline markup conventions shared with
 * scripts/lib/renderLegalPage.mjs: **bold** and [label](url). Relative URLs
 * render as client-side <Link> so the SPA doesn't hard-reload; absolute and
 * mailto URLs render as anchors.
 */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g).filter(Boolean);
  return (
    <>
      {parts.map((part, index) => {
        const bold = part.match(/^\*\*([^*]+)\*\*$/);
        if (bold) return <strong key={index}>{bold[1]}</strong>;
        const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) {
          const [, label, url] = link;
          if (url.startsWith('/')) {
            return (
              <Link key={index} className="text-brand underline" to={url}>
                {label}
              </Link>
            );
          }
          return (
            <a key={index} className="text-brand underline" href={url}>
              {label}
            </a>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background py-10 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-2">
          <ShieldCheck className="w-7 h-7 text-brand" />
          <h1 className="text-2xl font-bold text-foreground">{content.title}</h1>
        </div>
        <p className="text-xs text-muted-foreground mb-8">
          {content.productLine} · Last updated: {content.updated}
        </p>

        {content.sections.map((section) => (
          <Section key={section.heading} title={section.heading}>
            {(section.paragraphs ?? []).map((paragraph, index) => (
              <p key={index}>
                <Inline text={paragraph} />
              </p>
            ))}
            {(section.bullets?.length ?? 0) > 0 && (
              <ul className="list-disc pl-5 space-y-1">
                {section.bullets!.map((bullet, index) => (
                  <li key={index}>
                    <Inline text={bullet} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        ))}

        <div className="mt-10 pt-6 border-t border-border/40 text-center">
          {content.footerLinks.map((link, index) => (
            <span key={link.url}>
              {index > 0 && <span className="text-muted-foreground"> · </span>}
              <Link to={link.url} className="text-sm text-brand hover:underline">
                {link.label}
              </Link>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
