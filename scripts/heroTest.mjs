// Offline regression test for businessDescription, the routine that lifts a company's
// one-line "what we do" from the top of Item 1. It runs no network: each case is a small
// array of opening sentences (faithful to real 10-K openings) and the hero we expect the
// scorer to choose. Guards the tricky cases — a canonical line glued behind a heading or
// mission tagline, a run-on opener, a name that collides with a common phrase — against
// regressions. Run with `npm test`.
import { businessDescription, businessBrief } from "./fetchFilings.mjs";

const cases = [
  // A canonical opener glued behind a section heading and a period-less mission tagline,
  // so the whole thing reads as one sentence: jump to "<Company> is a <type>".
  ["CAVA", "CAVA Group, Inc.",
    ["Business Our Mission To Bring Heart, Health, and Humanity to Food CAVA is a Mediterranean restaurant brand.",
     "As of December 28, 2025, we operate 439 fast-casual CAVA restaurants in 27 states and the District of Columbia.",
     "We centrally produce our dips, spreads, and certain dressing bases for use in our restaurants while also selling them in grocery stores."],
    /^CAVA is a Mediterranean restaurant brand/i],
  // A long run-on opener whose subject was split onto the prior sentence by the period in
  // "Inc.": restore the subject and keep it instead of dropping it for length.
  ["HII", "Huntington Ingalls Industries, Inc.",
    ["BUSINESS History and Organization Huntington Ingalls Industries, Inc.",
     "(\"HII\", the \"Company\", \"we\", \"us\", or \"our\") is a global all-domain defense and technologies partner, recognized worldwide as America's largest shipbuilder and a provider of professional services to partners in government and industry, that designs and manufactures nuclear and non-nuclear ships for the United States Navy and Coast Guard.",
     "Ingalls includes our non-nuclear ship design, construction, repair, and maintenance businesses."],
    /^Huntington Ingalls Industries.{0,8} is a global all-domain defense and technologies partner/i],
  // The real opener sits behind a section heading ("Our Businesses and Industry Trends").
  ["CNP", "CenterPoint Energy, Inc.",
    ["Our Businesses and Industry Trends We are an energy delivery company with electric transmission, distribution, and natural gas operations.",
     "We serve millions of metered customers across several states."],
    /^We are an energy delivery company/i],
  // A tagline that begins with the company's own name-word ("Fitness for everyone") is kept
  // as part of the subject rather than risk dropping a real subject word; the franchisor
  // description still carries.
  ["PLNT", "Planet Fitness, Inc.",
    ["Fitness for everyone We are one of the largest and fastest-growing franchisors and operators of fitness centers in the United States by number of members and locations.",
     "Our members enjoy a welcoming environment."],
    /We are one of the largest and fastest-growing franchisors and operators of fitness centers/i],
  // A public benefit corporation that opens on its chartered purpose: skip it for the
  // line that says what the company actually does.
  ["UTHR", "United Therapeutics Corporation",
    ["Our public benefit purpose, as outlined in our charter and approved by our shareholders, is to provide a brighter future for patients.",
     "We market and sell a portfolio of commercial therapies in the United States to treat pulmonary arterial hypertension."],
    /^We market and sell a portfolio of commercial therapies/i],
  // Good cases that must not regress.
  ["AAPL", "Apple Inc.",
    ["Apple Inc. designs, manufactures and markets smartphones, personal computers, tablets, wearables and accessories, and sells a variety of related services.",
     "The Company's fiscal year is the 52- or 53-week period."],
    /^Apple Inc\. designs, manufactures and markets smartphones/i],
  ["PG", "The Procter & Gamble Company",
    ["Founded in 1837, Procter & Gamble is a consumer goods company that provides branded consumer packaged goods to customers worldwide.",
     "We operate in five segments."],
    /^Procter & Gamble is a consumer goods company/i],
  ["GEN", "Generic Cloud Inc.",
    ["We are a leading provider of cloud software and data analytics services to enterprises worldwide.",
     "Our platform is used by thousands of customers."],
    /^We are a leading provider of cloud software/i],
  // A long alias / "together with subsidiaries" preamble must be stripped so the "is a
  // <type>" payload is the hero, not corporate boilerplate truncated at the cap.
  ["REXR", "Rexford Industrial Realty, Inc.",
    ["Rexford Industrial Realty, Inc., a Maryland corporation, together with our consolidated subsidiaries, including Rexford Industrial Realty, L.P., a Maryland limited partnership, and its subsidiaries is a self-administered and self-managed full-service REIT focused on owning, operating and acquiring industrial properties in Southern California."],
    /^Rexford Industrial Realty, Inc\. is a self-administered and self-managed full-service REIT/i],
  ["WTRG", "Essential Utilities, Inc.",
    ["Essential Utilities, Inc., referred to as \"Essential Utilities\", \"Essential\", the \"Company\", \"we\", \"us\", or \"our\", is a holding company that provides regulated water and wastewater services to customers."],
    /^Essential Utilities, Inc\. is a holding company that provides regulated water/i],
  // A leading temporal clause ("As of <date>, we operate …") is dropped so the operating
  // line stands as the hero.
  ["CAVA2", "CAVA Group, Inc.",
    ["As of December 28, 2025, we operate 439 fast-casual CAVA restaurants in 27 states and the District of Columbia."],
    /^We operate 439 fast-casual CAVA restaurants in 27 states/i],
  // A mid-sentence brand mention must NOT be mistaken for the subject and left a fragment.
  ["ALGN", "Align Technology, Inc.",
    ["We design, manufacture and market the Invisalign system and Align clear aligners for the treatment of malocclusions, or the misalignment of teeth, by orthodontists and general dentists."],
    /^We design, manufacture and market/i],
  ["COIN", "Coinbase Global, Inc.",
    ["We provide a trusted platform that makes it easy for our customers to engage with crypto assets on Coinbase, including stocks, commodity futures, perpetual futures, and prediction markets."],
    /^We provide a trusted platform/i],
  // The actual HII opener (a "global … partner" that the engaged-matcher must recognize,
  // while "are the sole general partner" must not be mistaken for a description).
  ["HII2", "Huntington Ingalls Industries, Inc.",
    ["Huntington Ingalls is a global, all-domain defense partner, building and delivering the world's most powerful, survivable naval ships and technologies that defend freedom.",
     "Ingalls includes our non-nuclear ship design, construction, repair, and maintenance businesses."],
    /^Huntington Ingalls is a global, all-domain defense partner/i],
  // A stock-listing / history line must lose to a real description.
  ["ROL", "Rollins, Inc.",
    ["In 1968, Rollins began trading on the New York Stock Exchange under the symbol \"ROL.\" Since then, we have grown to provide essential services.",
     "We are a premier global consumer and commercial services company that provides pest and wildlife control services."],
    /^We are a premier global consumer and commercial services company/i],
  // A forward-looking risk fragment must lose to the holding-company description that
  // sits deeper in the section behind the forward-looking preamble.
  ["USB", "U.S. Bancorp",
    ["Bancorp's loan portfolios or in the value of the collateral securing those loans; Changes in commercial real estate occupancy.",
     "U.S. Bancorp is a financial services holding company headquartered in Minneapolis, Minnesota, serving millions of customers."],
    /^(U\.S\. )?Bancorp is a financial services holding company/i],
  // A long opener whose "is one of the largest" payload follows a subsidiary/parenthetical
  // preamble must be kept (length) and cleaned (alias strip), not dropped.
  ["EOG", "EOG Resources, Inc.",
    ["EOG Resources, Inc., a Delaware corporation organized in 1985, together with its subsidiaries, is one of the largest independent crude oil and natural gas companies in the United States with proved reserves in the United States and Trinidad."],
    /^EOG Resources, Inc\. is one of the largest independent crude oil and natural gas companies/i],
  // Broken sentence fragments from bad splitting must be rejected (want === null), so the page falls
  // back to the computed phrase rather than printing a mangled hero. (KMI and WAL shipped these.)
  ["KMI", "Kinder Morgan, Inc.", ["We provide, found in Items 1 and 2."], null],
  ["WAL", "Western Alliance Bancorporation", ["We operate and in the U.S. as a whole."], null],
  // The real Apple Item-1 form: a sub-heading glued before "The Company <verb>" — the subject is a
  // generic self-reference, not the name or "we", which the heading-jump must still strip. This blind
  // spot (recognizing only name+"we") was the dominant cause of the 427 null-lede SCORER failures
  // (AAPL/NVDA among them). Must resolve to a real description, not the computed fallback.
  ["AAPL-glued", "Apple Inc.",
    ["Company Background The Company designs, manufactures and markets smartphones, personal computers, tablets, wearables and accessories, and sells a variety of related services."],
    /designs, manufactures and markets smartphones/i],
  ["GEN-registrant", "Generic Co",
    ["Overview The Registrant is a leading provider of cloud software and data analytics services to enterprises worldwide."],
    /is a leading provider of cloud software/i],
];

let pass = 0, fail = 0;
for (const [tk, name, sents, want] of cases) {
  const got = businessDescription(sents, name, tk);
  const ok = want === null ? !got : (got && want.test(got));
  console.log((ok ? "ok   " : "FAIL ") + tk + " -> " + JSON.stringify(got));
  ok ? pass++ : fail++;
}
// businessBrief must not repeat the lede. The lede is often the cleaned form of one of the brief's
// own sentences (a subsidiary clause inserted, a heading prefixed), so it has to be caught by token
// overlap, not just a substring match — the CVS case the founder flagged.
{
  const lede = "CVS Health Corporation is a leading health solutions company building a world of health around every consumer it serves and connecting care so that it works for people wherever they are.";
  const sents = [
    "Overview of Business CVS Health Corporation, together with its subsidiaries (collectively, \"CVS Health\"), is a leading health solutions company building a world of health around every consumer it serves and connecting care so that it works for people wherever they are.",
    "As of December 31, 2025, the Company had approximately 9,000 retail locations, more than 1,000 walk-in clinics and a leading pharmacy benefits manager with approximately 87 million plan members and specialty pharmacy solutions.",
  ];
  const brief = businessBrief(sents, lede, "CVS Health Corporation");
  const ok = !brief.some((b) => /leading health solutions company building/.test(b)) && brief.some((b) => /9,000 retail locations/.test(b));
  console.log((ok ? "ok   " : "FAIL ") + "brief-no-lede-repeat -> " + JSON.stringify(brief.map((b) => b.slice(0, 40))));
  ok ? pass++ : fail++;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
