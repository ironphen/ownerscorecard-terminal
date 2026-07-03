// The publication's identity for machines: one Organization object used as author and
// publisher everywhere structured data appears. Notes carry the publication's name, not a
// personal byline, by choice. Keep this the single source; pages import rather than restate.
export const SITE_URL = "https://ownerscorecard.com";
export const SITE_NAME = "Owner Scorecard";

export const DEFAULT_DESCRIPTION =
  "Owner Scorecard is an independent research publication: the ten-year owner's record for thousands of listed companies, every figure traced to the company's own SEC filings. No ratings, no price targets, no estimates.";

export const ORG = {
  "@type": "Organization",
  "@id": `${SITE_URL}/#organization`,
  name: SITE_NAME,
  url: `${SITE_URL}/`,
  description: DEFAULT_DESCRIPTION,
  logo: `${SITE_URL}/apple-touch-icon.png`,
};
