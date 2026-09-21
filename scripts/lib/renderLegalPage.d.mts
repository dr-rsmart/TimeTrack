/**
 * Type declarations for scripts/lib/renderLegalPage.mjs so TypeScript
 * consumers (tests/unit/legalPages.test.ts) get type safety without a
 * runtime TS loader at the root.
 */

export interface LegalPageSection {
  heading: string
  paragraphs?: string[]
  bullets?: string[]
}

export interface LegalPageFooterLink {
  label: string
  url: string
}

export interface LegalPage {
  route: string
  htmlTitle: string
  metaDescription: string
  title: string
  productLine: string
  updated?: string
  siteUrl: string
  contactEmail?: string
  contactSubject?: string
  sections: LegalPageSection[]
  footerLinks?: LegalPageFooterLink[]
}

export declare function escapeHtml(text: string): string
export declare function inlineToHtml(text: string, siteUrl?: string): string
export declare function resolveUrl(url: string, siteUrl: string): string
export declare function renderLegalPage(page: LegalPage): string
