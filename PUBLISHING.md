# Publishing workflows

## Research report

1. Export PDF + preview image + excel
2. Upload to R2 under the naming convention (`TICKER_YYYY-MM-DD.pdf` etc.)
3. Register and push:

```sh
npm run add:report -- PEP "PepsiCo" 2025-12-09 --xlsx
git add src/data/reports.json
git commit -m "Add PEP"
git push
```

## Article

1. Create `src/content/articles/my-piece.mdx` (frontmatter reference:
   `src/content/articles/how-articles-work.mdx`)
2. Keep `draft: true` while writing — drafts render in `npm run dev` only
3. Flip `draft: false`, then:

```sh
git add src/content/articles/my-piece.mdx
git commit -m "Publish: my piece"
git push
```

## Personal results (local analysis only — never published)

The personal record is not part of the site (`EDITORIAL.md`, Track record
policy). To study your own results privately, export the closed-positions
workbook from Fidelity (the one with a `Historical_returns` sheet) and run:

```sh
npm run import:fidelity -- ~/Downloads/Portfolio_Positions_MonDDYYYY.xlsx
```

Outputs land in gitignored paths under `src/data/` and must stay uncommitted.
