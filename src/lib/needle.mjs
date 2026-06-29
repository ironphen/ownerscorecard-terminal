// "What moves the needle": the data-grounded answer, computed from the company's OWN financial
// fingerprint rather than an archetype template keyed to its SEC sector code. Two businesses that share
// a code can be economic opposites — a 14%-gross-margin server assembler and a 39%-gross-margin device
// franchise both sit in SIC 3571 — so a lever keyed to the code alone hands one of them the wrong lens
// (a thin-margin price-taker reading "pricing power, the surest mark of a moat"). This instead reads the
// margins, their swing through the cycle, and where the dollar actually goes, and names the variable
// that moves THIS company's owner economics, in its own figures. The same shape, two different companies,
// two different needles — without re-litigating the SIC→sector map every other read depends on.
//
// It teaches the lens; it never pronounces a verdict — the durability question is handed to the reader,
// not answered ("whether that is durable pricing power or a margin that can erode is the question").
// Present, never pronounce. Returns null when the record is too thin to read a shape, where the caller
// falls back to the archetype lever — precision over recall, the product's bar everywhere.
import { grossMargin, operatingMargin, throughCycle, cashConversionCycle } from "./fundamentals.mjs";
import { classify, financialKind } from "./archetype.mjs";

// A margin as a percent: one decimal where the level is thin (precision is the whole point on a 3.8%
// margin), no decimals where it is fat (a clean "28%"). Negatives carry a real minus sign.
const pm = (v) => (v == null ? null : `${v < 0 ? "−" : ""}${(Math.abs(v) * 100).toFixed(Math.abs(v) < 0.095 ? 1 : 0)}%`);
const median = (xs) => {
  const s = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};

// The dominant working-capital or reinvestment sink: the second-order lever, after the margin itself.
// One sentence, the single most material of inventory, capital spending, a negative cash cycle, or
// stock-based pay — through the cycle so a lumpy year doesn't decide it. Returns { text, weight } or null.
function dominantSink(company, L, H) {
  const ccc = cashConversionCycle(company);
  // A materially negative cycle, not a marginal one: −1 day is essentially balanced and claims no float,
  // so require the operation to be funded by others by a real margin before naming it a structural edge.
  const cccDays = ccc ? parseInt(ccc.value, 10) : null;
  const negWC = cccDays != null && cccDays <= -5;
  const invToRev = median(H.map((h) => (h.lines.inventory != null && h.lines.revenue ? h.lines.inventory / h.lines.revenue : null)));
  const capexToRev = median(H.map((h) => (h.lines.capex != null && h.lines.revenue ? Math.abs(h.lines.capex) / h.lines.revenue : null)));
  const sbcToRev = median(H.map((h) => (h.lines.stockBasedComp != null && h.lines.revenue ? h.lines.stockBasedComp / h.lines.revenue : null)));
  const capexVsDep = L.capex != null && L.depreciation ? Math.abs(L.capex) / L.depreciation : null;

  const cands = [];
  // A negative cash cycle is distinctive enough to lead when present — it is the closest thing on the
  // statements to Buffett's float — so it carries a weight that beats a merely heavy inventory book.
  if (negWC) cands.push({ weight: 0.5, text: `Customers and suppliers fund the operation through a negative cash cycle (${ccc.value}), a structural edge that lets it grow on other people's money rather than its own.` });
  if (invToRev != null && invToRev >= 0.12) cands.push({ weight: invToRev, text: `Inventory runs near ${pm(invToRev)} of sales, so how fast it turns back into cash — and the risk of writing it down when demand softens — sits alongside the margin.` });
  if (capexToRev != null && capexToRev >= 0.08) {
    const dep = capexVsDep == null ? "" : capexVsDep < 0.85 ? ", below what it charges for depreciation" : capexVsDep > 1.3 ? ", well above depreciation" : "";
    cands.push({ weight: capexToRev + 0.05, text: `Capital spending runs about ${pm(capexToRev)} of sales${dep}, so the return earned on what it sinks into plant — and the discipline not to over-build at the top — weighs as much as the margin.` });
  }
  if (sbcToRev != null && sbcToRev >= 0.05) cands.push({ weight: sbcToRev, text: `Stock-based pay runs about ${pm(sbcToRev)} of sales, a real and recurring claim on owners that the GAAP margin understates.` });

  if (!cands.length) return null;
  return cands.sort((a, b) => b.weight - a.weight)[0];
}

// The needle: 1–3 sentences, computed from the record. Returns { text } or null.
export function needleReport(company) {
  // Banks, insurers, REITs, asset managers and the rest read on their own statements (book value, the
  // combined ratio, FFO, the fee rate), not on a gross-margin shape, so the gross-margin fingerprint
  // here would teach the wrong lens. The caller keeps the statement-specific lever for them.
  if (financialKind(company)) return null;
  const L = company?.lines || {};
  if (!(L.revenue > 0)) return null;
  const H = (company?.history || []).filter((h) => h?.lines?.revenue != null);

  const omTC = throughCycle(company, operatingMargin);
  if (!omTC) return null; // under three years of operating margin: too thin to normalize a shape
  const gmTC = throughCycle(company, grossMargin);
  const gmMed = gmTC?.median ?? null;
  const omMed = omTC.median, omLo = omTC.lo, omHi = omTC.hi;
  const cyclical = (classify(company).overlays || []).some((o) => o.key === "cyclical");

  const sentences = [];

  // 1 — the margin structure: where each sales dollar stands, and what that makes the lever.
  if (omMed <= 0) {
    // A loss-making business with a HEALTHY gross margin (a young software or platform name) has working
    // unit economics — the loss is the spending below the gross line, a choice — so the lever is whether
    // that spending falls back to a profit, not the unit margin. One with no gross profit yet (an EV maker
    // selling below cost) faces the harder question of a margin at all. The split is the gross margin.
    if (gmMed != null && gmMed >= 0.4) {
      sentences.push(`Operating margin has run around ${pm(omMed)} through the cycle on a healthy ${pm(gmMed)} gross margin — the unit economics work, so the lever is whether the spending below the gross line falls back to a profit: revenue growth against the cost curve, and the cash runway until it does.`);
    } else {
      sentences.push(`Operating margin has run around ${pm(omMed)} through the cycle — the business has not yet earned a steady operating profit, so the lever is the path to a margin at all: revenue growth set against the cost curve and the cash runway, not the level of a margin that isn't there yet.`);
    }
  } else if (gmMed != null) {
    const band = gmMed < 0.25 ? "thin" : gmMed < 0.5 ? "mid" : "fat";
    const tail =
      band === "thin" ? ", a thin spread that turns the result on volume and the cost of what it sells far more than on the price it sets" :
      band === "mid" ? ", a solid spread carried by both the price it commands and the costs it keeps in check" :
      ", a wide spread between price and the cost of what it sells — whether that advantage is durable pricing power or a margin that can erode is the question the record is for";
    sentences.push(`Gross margin has run about ${pm(gmMed)} and operating margin about ${pm(omMed)} through the cycle${tail}.`);
  } else {
    // No clean cost-of-revenue line (a fee, service or holding business): read on the operating margin alone.
    const tail =
      omMed >= 0.25 ? ", a wide margin for the work it does — whether that reflects a durable edge or one that can fade is what the record weighs" :
      omMed >= 0.1 ? ", a solid margin the cost base and competition set as much as the price does" :
      ", a thin margin, so volume and cost discipline move the result more than the price of any one sale";
    sentences.push(`Operating margin has run about ${pm(omMed)} through the cycle${tail}.`);
  }

  // 2 — the swing: operating leverage and the cycle, read off the through-cycle range, not two endpoints.
  // "Wide" means the margin genuinely swings relative to where it runs (the operating-leverage signature)
  // or the record already reads cyclical — NOT a large absolute move on a fat, secularly-rising margin,
  // which would mislabel a steady compounder (Visa, 52→66%) as cyclical.
  if (omMed > 0 && omLo != null && omHi != null) {
    const swing = omHi - omLo;
    const relSwing = Math.abs(omMed) > 0.005 ? swing / Math.abs(omMed) : null;
    const wide = cyclical || (relSwing != null && relSwing >= 1.0);
    const steady = !wide && (swing <= 0.04 || (relSwing != null && relSwing <= 0.4));
    const narrow = swing <= 0.04; // a true narrow band, not merely steady relative to a fat level
    if (wide && omMed < 0.1) {
      sentences.push(`On a margin this thin the operating result swings hard on small moves in price or cost — it has ranged from ${pm(omLo)} to ${pm(omHi)} across the record, so the cost line, not a price list, is where the needle moves.`);
    } else if (wide) {
      sentences.push(`The margin is cyclical, swinging between ${pm(omLo)} and ${pm(omHi)} across the record, so the through-cycle figure carries more than any single year — and the balance sheet at the trough more than the peak.`);
    } else if (steady && narrow) {
      sentences.push(`That margin has held in a narrow ${pm(omLo)}–${pm(omHi)} band across the record, so steadiness itself is the evidence — the lever is unit growth and cost discipline, not a shifting margin.`);
    } else if (steady) {
      sentences.push(`That margin has stayed fairly steady relative to where it runs (${pm(omLo)}–${pm(omHi)} across the record), so unit growth and cost discipline, not a shifting margin, are the lever.`);
    }
  }

  // 3 — the dominant working-capital or reinvestment sink, when one is material.
  const sink = dominantSink(company, L, H);
  if (sink && sentences.length < 3) sentences.push(sink.text);

  return { text: sentences.join(" ") };
}
