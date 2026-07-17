#!/usr/bin/env node
// buildTaxonomy.mjs — assembles the sector/industry taxonomy from the mapping workflow's raw
// output (scratchpad taxonomy-raw.json) into src/data/taxonomy.json, with every assignment
// validated against the canonical menu. The menu is conventional sector/industry structure
// derived from public SIC codes and per-company assignment — never the licensed GICS mark.
//
// Hardening (the assembler trusts nothing): an assignment or correction whose industry is not
// on the menu is REJECTED loudly (a verifier once returned override instructions in the
// industry field — that class dies here); sector parentage is enforced from the menu, never
// from the agent; ticker overrides must name menu industries. Run with the raw path as argv.
import { readFileSync, writeFileSync } from "node:fs";

export const SECTORS = [
  { name: "Energy", industries: ["Oil & Gas Producers", "Oilfield Services & Equipment", "Refining & Marketing", "Pipelines & Midstream", "Coal & Consumable Fuels"] },
  { name: "Materials", industries: ["Chemicals", "Industrial Gases", "Construction Materials", "Containers & Packaging", "Metals & Mining", "Gold & Precious Metals", "Steel", "Paper & Forest Products", "Agricultural Inputs"] },
  { name: "Industrials", industries: ["Aerospace & Defense", "Building Products", "Construction & Engineering", "Electrical Equipment", "Industrial Machinery", "Trading Companies & Distributors", "Commercial Services & Supplies", "Professional Services", "Staffing & Employment Services", "Airlines", "Marine Shipping", "Railroads", "Trucking & Logistics", "Waste Management", "Farm & Heavy Equipment"] },
  { name: "Consumer Discretionary", industries: ["Automobiles", "Auto Components", "Auto Dealers & Services", "Homebuilders", "Household Durables", "Leisure Products", "Textiles & Apparel", "Footwear & Accessories", "Hotels & Resorts", "Restaurants", "Casinos & Gaming", "Cruise Lines", "Education Services", "Specialty Retail", "Department & General Merchandise Stores", "E-Commerce & Marketplaces", "Consumer Distributors"] },
  { name: "Consumer Staples", industries: ["Food & Drug Retailing", "Beverages", "Brewers, Distillers & Wineries", "Food Products", "Tobacco", "Household Products", "Personal Care Products", "Agricultural Products"] },
  { name: "Health Care", industries: ["Pharmaceuticals", "Biotechnology", "Medical Devices & Equipment", "Health Care Providers & Services", "Managed Care", "Life Sciences Tools & Services", "Health Care Technology", "Drug & Medical Distributors"] },
  { name: "Financials", industries: ["Banks", "Capital Markets & Asset Management", "Insurance — Property & Casualty", "Insurance — Life & Health", "Insurance Brokers", "Reinsurance", "Consumer Finance", "Mortgage & Specialty Finance", "Financial Exchanges & Data", "Payments & Transaction Processing", "Financial Conglomerates"] },
  { name: "Information Technology", industries: ["Software", "IT Services & Consulting", "Semiconductors", "Semiconductor Equipment", "Technology Hardware", "Communications Equipment", "Electronic Components & Instruments"] },
  { name: "Communication Services", industries: ["Telecom Operators", "Media & Broadcasting", "Entertainment & Studios", "Interactive Media & Platforms", "Video Games", "Advertising & Marketing", "Publishing"] },
  { name: "Utilities", industries: ["Electric Utilities", "Gas Utilities", "Water Utilities", "Multi-Utilities", "Renewable Power Producers"] },
  { name: "Real Estate", industries: ["REITs — Retail", "REITs — Residential", "REITs — Industrial & Logistics", "REITs — Office", "REITs — Health Care", "REITs — Hotels", "REITs — Data Centers & Towers", "REITs — Specialty & Diversified", "Real Estate Development & Services"] },
];

// The column family each industry's comparative table reads on (groupingColumns.mjs families).
const FAMILY_BY_INDUSTRY = {
  "Banks": "lender", "Consumer Finance": "lender", "Mortgage & Specialty Finance": "lender",
  "Insurance — Property & Casualty": "insurer", "Insurance — Life & Health": "insurer", "Reinsurance": "insurer", "Financial Conglomerates": "insurer",
  "Capital Markets & Asset Management": "fee", "Insurance Brokers": "fee", "Financial Exchanges & Data": "fee", "Payments & Transaction Processing": "fee",
};
const HEAVY = new Set(["Electric Utilities", "Gas Utilities", "Water Utilities", "Multi-Utilities", "Renewable Power Producers", "Pipelines & Midstream", "Telecom Operators", "Railroads"]);
export function familyOf(industry) {
  if (industry.startsWith("REITs") || industry === "Real Estate Development & Services") return "property";
  if (FAMILY_BY_INDUSTRY[industry]) return FAMILY_BY_INDUSTRY[industry];
  if (HEAVY.has(industry)) return "heavy";
  return "general";
}

export const slugOf = (label) =>
  label.toLowerCase()
    .replace(/—/g, " ").replace(/&/g, " and ").replace(/[',.]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const INDUSTRY_SET = new Set(SECTORS.flatMap((s) => s.industries));
const SECTOR_OF = new Map();
for (const s of SECTORS) for (const i of s.industries) SECTOR_OF.set(i, s.name);

function main() {
  const rawPath = process.argv[2];
  if (!rawPath) { console.error("usage: buildTaxonomy.mjs <taxonomy-raw.json>"); process.exit(1); }
  const raw = JSON.parse(readFileSync(rawPath, "utf8"));
  const problems = [];
  const sic = {};
  const jp = {};
  const overrides = {};

  const clean = (key, entry, into) => {
    const ind = String(entry.industry || "");
    if (!INDUSTRY_SET.has(ind)) { problems.push(`${key}: not a menu industry: "${ind.slice(0, 80)}"`); return; }
    into[key] = { sector: SECTOR_OF.get(ind), industry: ind };
  };
  for (const [k, v] of Object.entries(raw.sicMap || {})) clean(k, v, sic);
  for (const [k, v] of Object.entries(raw.jpMap || {})) clean(k, v, jp);
  for (const [t, v] of Object.entries(raw.tickerOverrides || {})) {
    const ind = String(v.industry || "");
    if (!INDUSTRY_SET.has(ind)) { problems.push(`override ${t}: not a menu industry: "${ind.slice(0, 80)}"`); continue; }
    overrides[t] = { sector: SECTOR_OF.get(ind), industry: ind };
  }
  for (const [t, v] of Object.entries(raw.manualOverrides || {})) {
    if (!INDUSTRY_SET.has(v.industry)) { problems.push(`manual ${t}: not on menu`); continue; }
    overrides[t] = { sector: SECTOR_OF.get(v.industry), industry: v.industry };
  }

  if (problems.length) {
    console.error(`buildTaxonomy: ${problems.length} rejected assignment(s) — resolve before shipping:`);
    for (const p of problems) console.error("  ✗ " + p);
  }
  const out = {
    asOf: raw.asOf || null,
    note: "Conventional sector/industry structure assigned from public SIC codes (US/ADR/EU) and per-company assignment (JP). Not GICS; no licensed classification data is used.",
    sectors: SECTORS.map((s) => ({ name: s.name, industries: s.industries.map((i) => ({ label: i, slug: slugOf(i), family: familyOf(i) })) })),
    sic, jp, overrides,
  };
  writeFileSync("src/data/taxonomy.json", JSON.stringify(out, null, 1));
  console.log(`taxonomy.json: ${Object.keys(sic).length} SICs, ${Object.keys(jp).length} JP, ${Object.keys(overrides).length} overrides, ${problems.length} rejected`);
  if (problems.length) process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith("buildTaxonomy.mjs")) main();
