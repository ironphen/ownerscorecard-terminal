// Authoritative US-vs-ADR routing from a filer's actual SEC annual-report FORM, not the Nasdaq
// screener's unreliable "country" field.
//
// The screener's country is a weak proxy that mislabels foreign issuers as US-domiciled (Thomson
// Reuters read "United States"), which traps them in the 10-K pipeline that can't read their IFRS
// filings, and it mislabels foreign-incorporated domestic filers by their charter (Accenture reads
// "Ireland") though they file a plain us-GAAP 10-K and belong in the US pipeline. The FORM a company
// actually files is the real signal, and it is what the hand-maintained FORCE_ADR list in
// buildUniverse.mjs encodes case by case:
//   - a 20-F or 40-F filer is a foreign private issuer → the ADR/IFRS pipeline;
//   - a 10-K filer is domestic (us-GAAP) → the US pipeline;
// regardless of where it is incorporated. Deriving this from EDGAR makes the routing self-maintaining:
// a newly-listed foreign filer routes itself, so it never silently vanishes waiting to be hand-pinned.
//
// The submissions API (data.sec.gov/submissions/CIK##########.json) lists a filer's recent forms; the
// MOST RECENT 10-K / 20-F / 40-F decides the route (so a company that transitioned from one to the
// other follows its current form). Fail-soft throughout: any miss returns route null and the caller
// falls back to the screener country — never worse than the behaviour before this layer existed.

const SEC_UA = process.env.SEC_USER_AGENT || "OwnerScorecard research hello@ownerscorecard.com";

// EDGAR encodes incorporation locations as 2-char state/country codes. The submissions payload also
// carries readable "…Description" fields (stateOfIncorporationDescription, business address
// stateOrCountryDescription), which countryFromSubmissions prefers; this table is only a last-resort
// fallback, and is deliberately limited to the Canadian province codes (A0–B0, which all fold to
// Canada) — the one code family verified correct and the commonest trapped-filer case. Other foreign
// codes are NOT guessed here: an unrecognised code yields null and the ADR label falls back to the
// screener country (which is the proven-good source), rather than risk a wrong country from a wrong code.
export const EDGAR_COUNTRY = {
  A0: "Canada", A1: "Canada", A2: "Canada", A3: "Canada", A4: "Canada", A5: "Canada",
  A6: "Canada", A7: "Canada", A8: "Canada", A9: "Canada", B0: "Canada",
};

// A readable country for the ADR label, from EDGAR's spelled-out description fields (never a bare code).
// "Ontario, Canada" collapses to the country; a US-state description ("CA") or a bare 2-char code is not
// a foreign country and yields null (the caller then uses the screener country, or shows no chip). Best-
// effort only: the screener country is the primary label source (see classifyRows), so this fills just
// the rare filer the screener mislabels "United States".
const NOT_A_COUNTRY = /^(british|republic of|federal level|state|province)$/i;
export function countryFromSubmissions(sub) {
  for (const raw of [sub?.stateOfIncorporationDescription, sub?.addresses?.business?.stateOrCountryDescription]) {
    const d = String(raw || "").trim();
    if (!(d && /[a-z]/.test(d) && d.length > 2)) continue; // skip bare codes and US-state abbreviations
    const seg = d.split(",").map((s) => s.trim()).filter(Boolean).pop() || d; // "Ontario, Canada" -> "Canada"
    const clean = NOT_A_COUNTRY.test(seg) ? d : seg; // an oddly-reversed label ("Virgin Islands, British") keeps the whole string
    return clean;
  }
  for (const c of [sub?.stateOfIncorporation, sub?.addresses?.business?.stateOrCountry]) if (c && EDGAR_COUNTRY[c]) return EDGAR_COUNTRY[c];
  return null;
}

// The route from a parsed submissions payload: find the annual report covering the LATEST fiscal period
// and map its form. Pure (takes the JSON), so it is unit-tested offline. Ranking by report PERIOD, not
// filing date, is deliberate: a late amendment of a superseded old annual (a 20-F/A filed this year for
// a period three years back) must NOT outrank a newer 10-K — filing-date ranking would mis-route the
// filer. On the same period the original outranks its amendment, then the later filing breaks the tie.
// A base-form prefix keeps amendments in-family (a "10-K/A" is still a 10-K filer); "NT 10-K" starts
// with "NT", never "10-K", so a late-notification stub is not mistaken for an annual.
export function routeFromSubmissions(sub) {
  const recent = sub?.filings?.recent || {};
  const forms = recent.form || [], filed = recent.filingDate || [], reported = recent.reportDate || [];
  let best = null;
  for (let i = 0; i < forms.length; i++) {
    const f = String(forms[i] || "");
    if (!(f.startsWith("10-K") || f.startsWith("20-F") || f.startsWith("40-F"))) continue;
    const cand = { form: f, period: reported[i] || filed[i] || "", amend: f.includes("/A"), filed: filed[i] || "" };
    const better =
      !best ||
      cand.period > best.period ||
      (cand.period === best.period && !cand.amend && best.amend) ||
      (cand.period === best.period && cand.amend === best.amend && cand.filed > best.filed);
    if (better) best = cand;
  }
  if (!best) return { route: null, form: null, date: null, country: null };
  const route = best.form.startsWith("10-K") ? "US" : "ADR";
  return { route, form: best.form, date: best.period, country: countryFromSubmissions(sub) };
}

// Fetch a CIK's submissions and resolve its route. Fail-soft: any network/parse error → route null, so
// the caller reverts to the country signal. fetchImpl is injectable for tests.
export async function probeRoute(cik, fetchImpl = fetch) {
  if (!cik) return { route: null, form: null, date: null, country: null };
  try {
    const res = await fetchImpl(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`, {
      headers: { "User-Agent": SEC_UA },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return { route: null, form: null, date: null, country: null };
    return routeFromSubmissions(await res.json());
  } catch {
    return { route: null, form: null, date: null, country: null };
  }
}
