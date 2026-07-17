// notebookExport.mjs — serializes a reader's whole notebook into the file they take with
// them. The export IS the ownership proof (design doc §3.5): markdown is the human copy,
// readable in any editor decades hence; JSON is the lossless one. Pure — no Supabase, no
// DOM — so scripts/notebookTest.mjs proves the round-trip.
import { snapshotSummary } from "./notebookCapture.mjs";

const day = (iso) => {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  } catch {
    return String(iso ?? "");
  }
};

// The file is read by its author, possibly decades hence — plain names, not code keys.
const DIAL_LABELS = {
  required: "required return", years: "years of high growth", terminal: "terminal growth",
  growth: "growth", revGrowth: "revenue growth", matureMargin: "mature margin", coe: "cost of equity",
};
const TOGGLE_LABELS = {
  normalized: "normalized (through-cycle base)", sbcExpensed: "stock comp expensed",
  steadyState: "steady-state (maintenance capex)", balanceSheet: "balance sheet counted",
};
const READOUT_LABELS = {
  implied: "implied growth", oeYield: "owner-earnings yield", spread: "spread over the bond",
  gate: "Graham’s price gate", marginAsk: "margin the price asks", priceToFfo: "price / FFO",
  priceToTbv: "price / tangible book", justified: "justified", pe: "P/E", divYield: "dividend yield",
  mustReach: "owner earnings it must reach", marginDemanded: "margin the price demands",
};
const RECORD_LABELS = { sym: "currency", shares: "shares", netDebt: "net debt", deliveredG: "delivered growth" };
const lbl = (map, k) => map[k] || k;
const pctDials = new Set(["required", "terminal", "growth", "revGrowth", "matureMargin", "coe"]);

// notes: [{ticker, body, created_at, updated_at}] · snapshots: [{ticker, taken_at, because, payload}]
export function exportMarkdown({ exported, notes = [], snapshots = [] }) {
  const tickers = [...new Set([...notes.map((n) => n.ticker), ...snapshots.map((s) => s.ticker)])].sort();
  const lines = [
    "# Owner's Notebook",
    "",
    `Exported ${exported}. ${notes.length} note${notes.length === 1 ? "" : "s"} and ${snapshots.length} snapshot${snapshots.length === 1 ? "" : "s"} across ${tickers.length} compan${tickers.length === 1 ? "y" : "ies"}.`,
    "",
    "This file is the reader's own record: dated notes, and dated appraisal snapshots frozen",
    "exactly as taken (a snapshot records the price typed, the dials set, and what the page",
    "showed for them — it is never recomputed). It belongs to its author.",
    "",
  ];
  for (const t of tickers) {
    lines.push(`## ${t}`, "");
    const snaps = snapshots.filter((s) => s.ticker === t);
    for (const s of snaps) {
      const d = s.payload?.date || day(s.taken_at);
      lines.push(`### Snapshot — ${d}`, "");
      const sum = snapshotSummary(s.payload);
      if (sum) lines.push(`- ${sum}`);
      if (s.because) lines.push(`- Because: ${s.because}`);
      const p = s.payload || {};
      if (p.dials) lines.push(`- Dials: ${Object.entries(p.dials).map(([k, v]) => `${lbl(DIAL_LABELS, k)} ${v}${pctDials.has(k) ? "%" : ""}`).join(", ")}`);
      if (p.toggles) {
        const on = Object.entries(p.toggles).filter(([, v]) => v).map(([k]) => lbl(TOGGLE_LABELS, k));
        if (on.length) lines.push(`- Toggles on: ${on.join(", ")}`);
      }
      if (p.sharesEntered != null) lines.push(`- Shares entered: ${p.sharesEntered}`);
      if (p.bondField != null) lines.push(`- Bond in the field: ${p.bondField}%`);
      if (p.bond?.yield != null) lines.push(`- The day's ${p.bond.name || "bond"}: ${p.bond.yield}%${p.bond.asOf ? ` (${p.bond.asOf})` : ""}`);
      if (p.vintage) lines.push(`- Record: ${[p.vintage.form, p.vintage.fy != null ? `FY${p.vintage.fy}` : null, p.vintage.periodEnd ? `period ended ${p.vintage.periodEnd}` : null].filter(Boolean).join(", ")}`);
      if (p.record) lines.push(`- Basis: ${Object.entries(p.record).map(([k, v]) => `${lbl(RECORD_LABELS, k)} ${v}`).join(", ")}`);
      if (p.readout) lines.push(`- As shown: ${Object.entries(p.readout).map(([k, v]) => `${lbl(READOUT_LABELS, k)} ${v}`).join(" · ")}`);
      if (p.lede) lines.push("", `> ${p.lede}`);
      if (p.base) lines.push(`> ${p.base}`);
      lines.push("");
    }
    const ns = notes.filter((n) => n.ticker === t);
    for (const n of ns) {
      const edited = n.updated_at !== n.created_at ? `, edited ${day(n.updated_at)}` : "";
      lines.push(`### Note — ${day(n.created_at)}${edited}`, "", n.body, "");
    }
  }
  return lines.join("\n");
}

export function exportJson({ exported, notes = [], snapshots = [] }) {
  return JSON.stringify({ format: "owner-notebook/1", exported, notes, snapshots }, null, 2);
}
