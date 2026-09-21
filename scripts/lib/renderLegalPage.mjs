/**
 * renderLegalPage.mjs
 * -------------------
 * Pure static-HTML renderer for the public legal pages (/privacy, /support).
 * Shared by scripts/generate-static-legal-pages.mjs (build step) and
 * tests/unit/legalPages.test.ts (store-crawler marker + parity guard).
 *
 * Why this exists: Apple App Store and Google Play reviewers' crawlers must
 * be able to read the FULL policy text from the raw HTML payload without
 * executing JavaScript. The React SPA shell alone (`<div id="root"></div>`)
 * reads as a blank page to such crawlers, which caused the 2026-09-21
 * Google Play "Invalid privacy policy" rejection.
 *
 * Inline markup conventions (mirrored by the React pages):
 *   **bold text**          → <strong>
 *   [label](url)           → <a href="url">  (relative URLs resolve against
 *                            siteUrl, e.g. /support → https://time-track.tech/support)
 *
 * The rendered document is fully self-contained: inline <style> only (the
 * production CSP allows style-src 'unsafe-inline'), no <script> tags, no
 * external assets.
 */

export const escapeHtml = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function inlineToHtml(text, siteUrl) {
  // Tokenize on the markup so every fragment is escaped exactly once and
  // relative URLs are resolved to absolute ones (crawlers prefer absolute).
  return String(text)
    .split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g)
    .map((token) => {
      if (!token) return '';
      const bold = token.match(/^\*\*([^*]+)\*\*$/);
      if (bold) return `<strong>${escapeHtml(bold[1])}</strong>`;
      const link = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (link) {
        return `<a href="${escapeHtml(resolveUrl(link[2], siteUrl))}">${escapeHtml(link[1])}</a>`;
      }
      return escapeHtml(token);
    })
    .join('');
}

export function resolveUrl(url, siteUrl) {
  if (/^https?:\/\//i.test(url) || url.startsWith('mailto:')) return url;
  const base = String(siteUrl).replace(/\/+$/, '');
  return `${base}${url.startsWith('/') ? url : `/${url}`}`;
}

export function renderLegalPage(page) {
  const { htmlTitle, metaDescription, title, productLine, updated, siteUrl, sections } = page;
  const contactEmail = page.contactEmail;
  const contactSubject = page.contactSubject;

  const sectionHtml = sections
    .map((section) => {
      const heading = `<h2>${escapeHtml(section.heading)}</h2>`;
      const paragraphs = (section.paragraphs || [])
        .map((p) => `<p>${inlineToHtml(p, siteUrl)}</p>`)
        .join('\n        ');
      const bullets = (section.bullets || [])
        .map((b) => `<li>${inlineToHtml(b, siteUrl)}</li>`)
        .join('\n          ');
      const list = bullets ? `\n        <ul>\n          ${bullets}\n        </ul>` : '';
      return `      <section>\n        ${heading}\n        ${paragraphs}${list}\n      </section>`;
    })
    .join('\n');

  const updatedLine = updated ? ` · Last updated: ${escapeHtml(updated)}` : '';

  const contactSection = contactEmail
    ? `      <section>
        <h2>Contact us</h2>
        <p><a href="mailto:${escapeHtml(contactEmail)}${contactSubject ? `?subject=${encodeURIComponent(contactSubject)}` : ''}">${escapeHtml(contactEmail)}</a></p>
      </section>
`
    : '';

  const footerLinks = (page.footerLinks || [])
    .map(
      (link) =>
        `<a href="${escapeHtml(resolveUrl(link.url, siteUrl))}">${escapeHtml(link.label)}</a>`,
    )
    .join(' <span aria-hidden="true">·</span>\n        ');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(htmlTitle)}</title>
    <meta name="description" content="${escapeHtml(metaDescription)}" />
    <meta name="robots" content="index,follow" />
    <link rel="canonical" href="${escapeHtml(resolveUrl(page.route, siteUrl))}" />
    <style>
      /* Self-contained legal page: no external assets, no scripts (CSP-safe). */
      :root { color-scheme: light dark; }
      body {
        margin: 0;
        padding: 2.5rem 1rem;
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        line-height: 1.6;
        background: #ffffff;
        color: #0f172a;
      }
      @media (prefers-color-scheme: dark) {
        body { background: #0b1220; color: #e2e8f0; }
      }
      main { max-width: 48rem; margin: 0 auto; }
      h1 { font-size: 1.75rem; margin: 0 0 0.25rem; }
      h2 { font-size: 1.05rem; margin: 1.5rem 0 0.5rem; }
      p, li { font-size: 0.95rem; }
      .subtitle { font-size: 0.8rem; opacity: 0.7; margin-bottom: 2rem; }
      a { color: #2563eb; }
      ul { padding-left: 1.25rem; }
      .footer {
        margin-top: 2.5rem;
        padding-top: 1rem;
        border-top: 1px solid rgba(148, 163, 184, 0.4);
        font-size: 0.9rem;
        text-align: center;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p class="subtitle">${escapeHtml(productLine)}${updatedLine}</p>
${sectionHtml}
${contactSection}      <p class="footer">${footerLinks}</p>
    </main>
  </body>
</html>
`;
}
