import rss from "@astrojs/rss";
import { getCollection } from "astro:content";

export async function GET(context) {
  const articles = (
    await getCollection("articles", ({ data }) => !data.draft)
  ).sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());

  return rss({
    title: "Owner Scorecard",
    description:
      "Research notes on common stocks and the businesses behind them.",
    site: context.site,
    // @astrojs/rss omits the atom:self link that validators expect and some consumers use to
    // canonicalize a feed; declare the Atom namespace and add it by hand.
    xmlns: { atom: "http://www.w3.org/2005/Atom" },
    customData: `<atom:link href="${new URL("/rss.xml", context.site).href}" rel="self" type="application/rss+xml" />`,
    items: articles.map((a) => ({
      title: a.data.title,
      description: a.data.description,
      pubDate: a.data.date,
      link: `/notes/${a.id}/`,
    })),
  });
}
