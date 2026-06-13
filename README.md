# Owner Scorecard

An independent research publication for value investors: an Owner's Scorecard for
each company — its vital signs, from its own SEC filings, with no rating and no
estimate — alongside essays on how to read them.

The founding doctrine — mission, voice, standing rules, beats, and the essay
slate — lives in [`EDITORIAL.md`](EDITORIAL.md).

## Pages

| Route | What it is |
| :--- | :--- |
| `/` | Company directory — search a ticker → its Owner's Scorecard |
| `/c/[ticker]` | Owner's Scorecard for one company + any writing on it |
| `/articles` | Articles (MDX content collection, sections: markets / companies / principles / letters) |
| `/tools` | Tools — standalone instruments (first one in development) |
| `/rss.xml` | Feed of published articles |

## Stack

[Astro 6](https://astro.build) static site. Articles are MDX files in
`src/content/articles/` (typed frontmatter, validated at build). Interactive
graphics are React islands in `src/components/` — plain articles ship zero
JavaScript. Tool and content data are plain JSON in `src/data/`, portable to any
future stack.

## Workflows

**Write an article** — add `src/content/articles/my-piece.mdx` with frontmatter
(`title`, `description`, `date`, `section`, `tickers`, `draft`). Drafts render in
dev only. See the live reference: `src/content/articles/how-articles-work.mdx`.

**Analyze your own results (local only)** — the personal record is deliberately
not part of the site (see `EDITORIAL.md`, Track record policy). The import
scripts remain for private analysis; their outputs are gitignored and never
committed:

```sh
npm run import:fidelity -- ~/Downloads/Portfolio_Positions_MonDDYYYY.xlsx
```

**Refresh the tool data (from SEC EDGAR)** — the fundamentals tools read
`src/data/fundamentals.json`, built from `src/data/universe.json` by pulling
latest-annual figures straight from EDGAR XBRL (free, no key; needs network
access to `data.sec.gov`):

```sh
npm run fetch:fundamentals
```

A committed sample dataset (clearly flagged `"sample": true`) lets the tools
render before the pipeline has run. CI can refresh it automatically — see
`.github/workflows/fundamentals.yml` (manual-trigger until you enable the
schedule). Expand coverage by adding tickers to `src/data/universe.json`.

See `PUBLISHING.md` for details.

## Commands

| Command | Action |
| :--- | :--- |
| `npm install` | Install dependencies |
| `npm run dev` | Dev server at `localhost:4321` (drafts visible) |
| `npm run build` | Build production site to `./dist/` |
| `npm run preview` | Preview the production build |

## Data hygiene

Personal account data never enters this repo: the import scripts write to
gitignored paths, and the site carries no personal record by policy. The track
record is published calls — timestamped and graded in the open.
