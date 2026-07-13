// The publication's identity for machines: one Organization object used as author and
// publisher everywhere structured data appears. Notes carry the publication's name, not a
// personal byline, by choice. Keep this the single source; pages import rather than restate.
export const SITE_URL = "https://ownerscorecard.com";
export const SITE_NAME = "Owner Scorecard";

export const DEFAULT_DESCRIPTION =
  "Owner Scorecard is an independent research publication: the ten-year owner's record for thousands of listed companies, every figure traced to the company's own SEC filings. No ratings, no price targets, no estimates.";

// The Organization node, enriched with the transparency properties (from the Trust Project set
// that Google and Bing read as credibility signals) — each pointing at a page that ALREADY
// exists and states the policy in prose, so the markup only surfaces what the site already
// stands behind. No founder Person node by design: the masthead is the byline (see the
// authorship doctrine), so a personal identity is deliberately absent, not merely omitted.
export const ORG = {
  "@type": "Organization",
  "@id": `${SITE_URL}/#organization`,
  name: SITE_NAME,
  url: `${SITE_URL}/`,
  description: DEFAULT_DESCRIPTION,
  logo: {
    "@type": "ImageObject",
    url: `${SITE_URL}/apple-touch-icon.png`,
    width: 180,
    height: 180,
  },
  // The founding letter is the statement of editorial standards; /corrections is the live,
  // dated public error log; /about states ownership and how the work is funded (reader-only).
  publishingPrinciples: `${SITE_URL}/notes/the-founding-letter`,
  correctionsPolicy: `${SITE_URL}/corrections`,
  ownershipFundingInfo: `${SITE_URL}/about`,
};

// The primary source an equity record resolves to: the SEC's EDGAR filing history for the CIK.
// Anchoring every Corporation entity to this URL is provenance-grade E-E-A-T — the site's whole
// pitch — and gives an answer engine a verifiable way to know which "Coca-Cola" a page is about.
export function edgarCikUrl(cik) {
  const digits = String(cik || "").replace(/\D/g, "");
  if (!digits) return null;
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${digits}&type=10-K`;
}

// The Corporation node for a company page's `about`: name, ticker, and — when the CIK is known —
// a machine-readable SEC identifier plus the EDGAR sameAs. Presenting the entity, never rating it.
export function corporationNode({ name, ticker, cik, url }) {
  const node = { "@type": "Corporation", name, tickerSymbol: ticker };
  if (url) node.url = url;
  const edgar = edgarCikUrl(cik);
  if (cik) {
    node.identifier = {
      "@type": "PropertyValue",
      propertyID: "SEC CIK",
      value: String(cik).replace(/\D/g, ""),
    };
  }
  if (edgar) node.sameAs = edgar;
  return node;
}

// The Dataset node for a company's ten-year record — the shape Google Dataset Search indexes and
// the shape an AI crawler prefers to cite: a named dataset, free, licensed to the site's own
// (attribution-requested-never-required) terms, with a machine-readable distribution pointing at
// the JSON twin, temporal coverage, and the same honest asOf the rest of the page uses. It
// describes exactly what the /c/{T}.json endpoint already serves — legibility, not a new claim.
export function companyDataset({ ticker, name, cik, pageUrl, jsonUrl, spanFrom, spanTo, asOf, sourceUrl, filingSource = "SEC filings" }) {
  const temporal =
    spanFrom && spanTo ? (spanFrom === spanTo ? `${spanFrom}` : `${spanFrom}/${spanTo}`) : undefined;
  const ds = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `${name} (${ticker}): the ten-year owner's record`,
    description: `Roughly a decade of ${name}'s filed line items — revenue, margins, returns on capital, owner earnings, buybacks, share count, and debt — every figure traced to the company's own ${filingSource}. No ratings, estimates, or price data.`,
    url: pageUrl,
    isAccessibleForFree: true,
    // The site's own terms, not CC-BY: attribution is REQUESTED, never required, so a license
    // that mandates attribution would misstate the terms. Point at the terms prose instead.
    license: `${SITE_URL}/docs/data#terms`,
    creator: { "@id": `${SITE_URL}/#organization` },
    publisher: { "@id": `${SITE_URL}/#organization` },
    isPartOf: { "@id": `${SITE_URL}/docs/data#catalog` },
    distribution: {
      "@type": "DataDownload",
      encodingFormat: "application/json",
      contentUrl: jsonUrl,
    },
    about: corporationNode({ name, ticker, cik, url: pageUrl }),
  };
  if (temporal) ds.temporalCoverage = temporal;
  if (asOf) ds.dateModified = asOf;
  if (sourceUrl) ds.isBasedOn = sourceUrl;
  return ds;
}

// A BreadcrumbList from an ordered [name, url] trail. Emitting the site's already-built
// hub-and-spoke lattice (Manual volume, industry chapter) as structure engines can parse.
export function breadcrumbList(trail) {
  const items = (trail || []).filter((t) => t && t.name);
  if (items.length < 2) return null;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: t.name,
      ...(t.url ? { item: t.url.startsWith("http") ? t.url : `${SITE_URL}${t.url}` } : {}),
    })),
  };
}
