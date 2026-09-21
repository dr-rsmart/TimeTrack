/**
 * Legal-page generation guard (store compliance)
 * ----------------------------------------------
 * The privacy/support URLs declared to the Apple App Store and Google Play
 * must serve the FULL policy text as static HTML (no JavaScript required)
 * over GET and HEAD. This test renders the pages from the same JSON content
 * the React pages render, then asserts:
 *   1. store-crawler markers are present in the raw HTML,
 *   2. no <script> tags exist,
 *   3. parity: every heading and every plain-text segment of the JSON
 *      content appears in the rendered HTML — the static page can never
 *      drift from the React page.
 * The live GET/HEAD HTTP checks run post-deploy via
 * scripts/verify-deploy-live.mjs.
 */
import { describe, it, expect } from 'vitest';
import { renderLegalPage, type LegalPage } from '../../scripts/lib/renderLegalPage.mjs';
import privacyPolicy from '../../src/content/privacyPolicy.json';
import supportPage from '../../src/content/supportPage.json';

const PRIVACY_MARKERS = [
  'Privacy Policy',
  'TimeTrack',
  'POPIA',
  'GDPR',
  'location',
  'geofence',
  'Last updated: 21 September 2026',
  'ricardovsmart@gmail.com',
  'Smart Patel Tech Solutions',
];

const SUPPORT_MARKERS = [
  'Support',
  'TimeTrack',
  'ricardovsmart@gmail.com',
  'Privacy Policy',
  'company administrator',
];

// Same escaping as scripts/lib/renderLegalPage.mjs so parity comparisons
// hold for segments containing &, <, > or ".
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Splits a JSON prose block into the plain-text segments that must appear
 * verbatim in the rendered HTML, resolving the inline markup:
 *   **bold**            → bold
 *   [label](url)        → label
 */
function plainSegments(text: string): string[] {
  return text
    .split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g)
    .map((segment) => {
      if (segment.startsWith('**') && segment.endsWith('**')) return segment.slice(2, -2);
      const link = segment.match(/^\[([^\]]+)\]\([^)]+\)$/);
      return link ? link[1] : segment;
    })
    .filter((segment) => segment.length > 0);
}

function expectParity(page: LegalPage, html: string): void {
  for (const section of page.sections) {
    expect(html).toContain(escapeHtml(section.heading));
    for (const block of [...(section.paragraphs ?? []), ...(section.bullets ?? [])]) {
      for (const segment of plainSegments(block)) {
        expect(html, `missing segment from "${block}"`).toContain(escapeHtml(segment));
      }
    }
  }
}

describe('static legal page generation', () => {
  it('renders /privacy with full policy text, canonical URL and no scripts', () => {
    const html = renderLegalPage(privacyPolicy as unknown as LegalPage);
    for (const marker of PRIVACY_MARKERS) {
      expect(html).toContain(marker);
    }
    expect(html).not.toContain('<script');
    expect(html).toContain('<title>Privacy Policy — TimeTrack</title>');
    expect(html).toContain('<link rel="canonical" href="https://time-track.tech/privacy"');
    // Relative link resolution: /support becomes the canonical absolute URL.
    expect(html).toContain('https://time-track.tech/support');
  });

  it('renders /support with contact details, canonical URL and no scripts', () => {
    const html = renderLegalPage(supportPage as unknown as LegalPage);
    for (const marker of SUPPORT_MARKERS) {
      expect(html).toContain(marker);
    }
    expect(html).not.toContain('<script');
    expect(html).toContain('<title>Support — TimeTrack</title>');
    expect(html).toContain('<link rel="canonical" href="https://time-track.tech/support"');
    expect(html).toContain('mailto:ricardovsmart@gmail.com');
  });

  it('keeps static /privacy in parity with the React content source', () => {
    expectParity(
      privacyPolicy as unknown as LegalPage,
      renderLegalPage(privacyPolicy as unknown as LegalPage),
    );
  });

  it('keeps static /support in parity with the React content source', () => {
    expectParity(
      supportPage as unknown as LegalPage,
      renderLegalPage(supportPage as unknown as LegalPage),
    );
  });
});
