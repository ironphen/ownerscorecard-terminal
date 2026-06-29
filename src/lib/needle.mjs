// "What moves the needle": the data-grounded answer, computed from the company's OWN financial
// fingerprint rather than an archetype template keyed to its SEC sector code. Two businesses that share
// a code can be economic opposites — a 14%-gross-margin server assembler and a 39%-gross-margin device
// franchise both sit in SIC 3571 — so a lever keyed to the code alone hands one of them the wrong lens
// (a thin-margin price-taker reading "pricing power, the surest mark of a moat"). This instead reads the
// margins, their swing through the cycle, and where the dollar actually goes, and names the variable
// that moves THIS company's owner economics, in its own figures. The same shape, two different companies,
// two different needles — without re-litigating the SIC→sector map every other read depends on.
//
// It teaches the lens; it never pronounces a verdict. Durability is handed to the reader as an open
// question, never asserted as a moat — that holds for a fat margin ("whether that advantage is durable
// pricing power or a margin that can erode is the question"), for a price-taker's spread ("a spread the
// cycle sets more than the company does", never "the price it commands"), and for a negative cash cycle
// (the mechanical fact, not "a structural edge"). Present, never pronounce. Returns null when the record
// is too thin to read a shape, where the caller falls back to the archetype lever — precision over recall.
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
  // A materially negative cycle, not a marginal one: −1 day is essentially balanced and claims no float.
  // The upper bound (−365) is a sanity clamp: a cycle more negative than a full year is a data artifact
  // (a mis-scaled payables or COGS line — Oracle's stored −1,838 days), not a real funding position, so
  // it is suppressed rather than surfaced as a garbage figure.
  const cccDays = ccc ? parseInt(ccc.value, 10) : null;
  const negWC = cccDays != null && cccDays <= -5 && cccDays >= -365;
  const invToRev = median(H.map((h) => (h.lines.inventory != null && h.lines.revenue ? h.lines.inventory / h.lines.revenue : null)));
  const capexToRev = median(H.map((h) => (h.lines.capex != null && h.lines.revenue ? Math.abs(h.lines.capex) / h.lines.revenue : null)));
  const sbcToRev = median(H.map((h) => (h.lines.stockBasedComp != null && h.lines.revenue ? h.lines.stockBasedComp / h.lines.revenue : null)));
  const capexVsDep = L.capex != null && L.depreciation ? Math.abs(L.capex) / L.depreciation : null;

  const cands = [];
  // The negative cash cycle is described mechanically — what it IS — and weighed for its distinctiveness,
  // but its durability is left to the reader: no "structural edge", no "advantage", no verdict.
  if (negWC) cands.push({ weight: 0.5, text: `The cash cycle runs negative (${ccc.value}): the operation is paid before it pays, so working capital releases cash as the business grows rather than tying it up.` });
  if (invToRev != null && invToRev >= 0.12) cands.push({ weight: invToRev, text: `Inventory runs near ${pm(invToRev)} of sales, so how fast it turns back into cash — and the risk of writing it down when demand softens — sits alongside the margin.` });
  if (capexToRev != null && capexToRev >= 0.08) {
    const dep = capexVsDep == null ? "" : capexVsDep < 0.85 ? ", below what it charges for depreciation" : capexVsDep > 1.3 ? ", well above depreciation" : "";
    cands.push({ weight: capexToRev + 0.05, text: `Capital spending runs about ${pm(capexToRev)} of sales${dep}, so the return earned on what it sinks into that plant weighs as much as the margin.` });
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
  const cls = classify(company);
  const cyclical = (cls.overlays || []).some((o) => o.key === "cyclical");
  // Whether the GROSS margin itself swings widely (≥ 15 points) — the signature of a commodity/demand
  // cycle, where the price moves through the cost of goods. A steady gross margin under a wide operating
  // swing is charges or operating spend below the line, not a cycle.
  const grossSwings = gmTC && gmTC.lo != null && gmTC.hi != null && gmTC.hi - gmTC.lo >= 0.15;
  // A genuine commodity / demand cycle, distinct from a one-off charge the margin-shape overlay mislabels
  // "cyclical". Two ways to know it is real: the gross margin itself swings (memory, copper — the price
  // moves through COGS), OR the business is capital-intensive (an oil major, a metals miner, a chemicals
  // maker), whose earnings swing on a commodity price it takes — even when its integrated gross margin is
  // comparatively steady (Chevron, gross 38–48%, but the −8% trough is the oil collapse, not opex). A
  // staples or pharma name (Kraft Heinz, Merck) is neither: its "cyclical" flag is a writedown or an R&D
  // charge below a steady gross line, so it stays out of the commodity frame and reads below the line.
  const commodityCycle = cyclical && (grossSwings || cls.sector?.key === "capital");

  const sentences = [];

  // 1 — the margin structure: where each sales dollar stands, and what that makes the lever.
  if (omMed <= 0) {
    // A negative through-cycle median is three different stories, and the wrong one misreads the business:
    //  • A company that HAS posted a clearly positive margin (operating-margin high ≥ 10%) but runs negative
    //    on the median — a mature industrial absorbing one-off charges (GE), or a grower just turning the
    //    corner (Palantir) — is NOT a never-earned-a-profit name; the lever is which is the truer picture.
    //  • One that has never cleared a profit but carries a high gross margin (Snowflake) keeps the loss
    //    below the gross line; the lever is whether that spending can fall back to a profit.
    //  • One with no gross profit yet (an EV maker selling below cost) faces the path to a margin at all.
    const everProfitable = omHi != null && omHi >= 0.1;
    const onGM = gmMed != null ? ` on a ${pm(gmMed)} gross margin` : "";
    if (everProfitable) {
      sentences.push(`Operating margin has reached ${pm(omHi)} at its best but run negative through the cycle (median ${pm(omMed)})${onGM} — so the question is which reading is truer: whether the median was pulled below zero by one-off charges, by the cycle, or by spending it is still growing into, and whether it settles back at a profit.`);
    } else if (gmMed != null && gmMed >= 0.4) {
      sentences.push(`Operating margin has run around ${pm(omMed)} through the cycle on a ${pm(gmMed)} gross margin, the operating line in the red even at its best — so the lever is whether the spending below the gross line can come down enough to clear a profit: revenue growth against the cost curve, and the cash runway until it does.`);
    } else {
      sentences.push(`Operating margin has run around ${pm(omMed)} through the cycle${onGM}, the operating line deeply negative — so the lever is the path to a margin at all: revenue growth against the cost curve and the cash runway, not the level of a margin that isn't there yet.`);
    }
  } else if (gmMed != null) {
    const band = gmMed < 0.25 ? "thin" : gmMed < 0.5 ? "mid" : "fat";
    // Cost-plus / fixed-price program signature: almost nothing sits between the gross and operating lines
    // (a defense prime), so the thin-spread "volume against a price" read misfits — the contract structure
    // sets the margin, not unit volume. Named descriptively, with no claim on the quality of those returns.
    const costPlus = band === "thin" && omMed > 0.05 && gmMed > 0 && omMed / gmMed > 0.8;
    const tail =
      costPlus ? ", a thin spread, but one where almost nothing separates the gross and operating lines — the mark of cost-plus or fixed-price program work, so the contract structure and the order book set the result more than unit volume against a price" :
      band === "thin" ? ", a thin spread that turns the result on volume and the cost of what it sells far more than on the price it sets" :
      band === "mid" ? (commodityCycle
        ? ", a spread the cycle sets more than the company does"
        : ", a solid spread between what it charges and what the product costs to make") :
      ", a wide spread between price and the cost of what it sells — whether that advantage is durable pricing power or a margin that can erode is the question the record is for";
    sentences.push(`Gross margin has run about ${pm(gmMed)} and operating margin about ${pm(omMed)} through the cycle${tail}.`);
  } else {
    // No clean cost-of-revenue line (a fee, service or holding business): read on the operating margin alone.
    const tail =
      omMed >= 0.25 ? ", a wide margin for the work it does — whether that reflects a durable edge or one that can fade is what the record weighs" :
      omMed >= 0.1 ? ", a solid margin the cost base and competition set as much as the price does" :
      ", a thin margin, where volume, cost discipline and the price it gets all bear on the result";
    sentences.push(`Operating margin has run about ${pm(omMed)} through the cycle${tail}.`);
  }

  // 2 — the swing: operating leverage and the cycle, read off the through-cycle range, not two endpoints.
  // The mechanism of the swing must match the business, not a template: a genuine demand/commodity cycle
  // reads cyclical; a wide swing on a STEADY gross margin (a software firm, or an industrial taking a
  // one-off charge) sits below the gross line, in operating spend or charges, NOT in the cost of the
  // product; only a swing on a truly thin GROSS spread is the price-taker's cost-line story. "Wide" is a
  // swing relative to where the margin runs, or the cyclical flag — never a large absolute move on a fat,
  // secularly-rising margin, which would mislabel a steady compounder (Visa, 52→66%) as cyclical.
  if (omMed > 0 && omLo != null && omHi != null) {
    const swing = omHi - omLo;
    const relSwing = Math.abs(omMed) > 0.005 ? swing / Math.abs(omMed) : null;
    const wide = cyclical || (relSwing != null && relSwing >= 1.0);
    const steady = !wide && (swing <= 0.04 || (relSwing != null && relSwing <= 0.4));
    const narrow = swing <= 0.04; // a true narrow band, not merely steady relative to a fat level
    // A commodity or demand cycle moves the price through the gross line, so the GROSS margin itself
    // swings widely (memory, copper, oil, chips). A one-off charge — an impairment, a litigation reserve,
    // an outbreak — leaves the gross margin steady and hits BELOW it, even when the margin-shape overlay
    // flagged the name "cyclical" off two charge years (Kraft Heinz's writedown, Merck's R&D charge,
    // Chipotle's outbreak). So the commodity-cycle reading, with its "balance sheet at the trough", is
    // reserved for a gross line that actually swings; a steady gross with a wide operating swing reads as
    // charges and operating spend below the line. The omHi < gmMed guard catches the case where the gross
    // margin itself expanded (Nvidia, operating high ≈ gross median), where "below a steady gross line"
    // would be false — that routes to the neutral wide read instead.
    if (commodityCycle) {
      sentences.push(`The margin is cyclical, swinging between ${pm(omLo)} and ${pm(omHi)} over the years, so the through-cycle figure carries more than any single year — and the balance sheet at the trough more than the peak.`);
    } else if (wide && gmMed != null && gmMed >= 0.25 && omHi < gmMed && !grossSwings) {
      // a steady fat-ish gross line under a wide operating swing → the swing is below the line (Salesforce's
      // S&M, 3M's litigation charge). The !grossSwings guard keeps this off a name whose gross ALSO swung
      // (Pfizer, 51→80% on COVID mix), where "a steadier gross margin" would overstate the case.
      sentences.push(`The operating margin has swung widely — from ${pm(omLo)} to ${pm(omHi)} — on a steadier ${pm(gmMed)} gross margin, so what moves it sits below the gross line, in operating spend and one-off charges more than in the cost of the product itself.`);
    } else if (wide && gmMed != null && gmMed < 0.25) {
      sentences.push(`On a spread this thin the operating result swings hard on small moves in cost or volume — it has ranged from ${pm(omLo)} to ${pm(omHi)} over the years, so the cost line is where the needle moves.`);
    } else if (wide) {
      sentences.push(`The operating margin has swung widely — from ${pm(omLo)} to ${pm(omHi)} over the years — so the through-cycle figure carries more than any single year, and the worst year more than the best.`);
    } else if (steady && narrow) {
      sentences.push(`That margin has held in a narrow ${pm(omLo)}–${pm(omHi)} band over the years, so steadiness itself is the evidence — the lever is unit growth and cost discipline, not a moving line.`);
    } else if (steady) {
      sentences.push(`That margin has stayed fairly steady relative to where it runs (${pm(omLo)}–${pm(omHi)} over the years), so unit growth and cost discipline, not a moving line, are the lever.`);
    }
  }

  // 3 — the dominant working-capital or reinvestment sink, when one is material.
  const sink = dominantSink(company, L, H);
  if (sink && sentences.length < 3) sentences.push(sink.text);

  return { text: sentences.join(" ") };
}
