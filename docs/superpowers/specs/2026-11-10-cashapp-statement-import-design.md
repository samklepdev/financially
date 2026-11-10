# Cash App statement import — design

**Status:** approved, ready for implementation plan
**Context:** Roadmap item 4, "CSV import from bank exports (column mapping, no
duplicates)". The sample file the user actually has is a Cash App monthly PDF
account statement, not a CSV — Cash App does offer a CSV export, but the user
chose to build against the PDF statement directly rather than switch formats.
This narrows the original roadmap wording: there is no user-configurable
"column mapping" step, since the parser targets one known, fixed statement
layout (Cash App's), not arbitrary CSVs.

## Source format

A Cash App "Account Statement" PDF, one or more pages of a repeating table:

```
Date    Description                          Details              Fee     Amount
Sep 5   Walmart Houston TX                    Paper money deposit  $1.00   + $100.00
Sep 5   Dk Draftkingsda84 Boston MA            Cash App Card        $0.00   $10.00
Sep 5   From Stride Bank, National Association Standard transfer   $0.00   + $57.00
        x8703
Sep 27  Google                                Cash App Pay         $0.00   $0.00
                                                (canceled)
```

Characteristics that drive the parsing design:
- The header row repeats on every page.
- Dates have no year ("Sep 5") — the year/month come from the statement's
  own header ("September 2026"), printed once per page.
- A long Description or Details value wraps onto a second visual line, with
  no Date/Fee/Amount on that second line.
- Amount has no sign for a debit (plain `$10.00`) and a leading `+` for a
  credit (`+ $100.00`).
- Fee is a separate column, not included in Amount. The statement's own
  summary tracks Money In / Money Out / Fees as three separate totals.
- Canceled transactions ("Cash App Pay (canceled)") show $0.00/$0.00 and have
  no real financial effect.

## Parsing approach

Plain-text extraction from a PDF does not reliably preserve visual row/column
order (especially with wrapped cells), so this uses **position-based
extraction**: pull every text item's (x, y) coordinates with `pdfjs-dist`,
then reconstruct the table from positions rather than text order.

1. For each page, call `page.getTextContent()` to get text items with
   `transform` (giving x, y) and the string value.
2. Find the header row ("Date", "Description", "Details", "Fee", "Amount") by
   matching those exact strings; record each column's x-position as the
   column boundaries for every row below it on that page.
3. Find the statement's month/year from the page header text (e.g.
   "September 2026"), via a regex over the full month names.
4. Cluster the remaining items into rows by y-position (items within a small
   tolerance of each other's y are the same row).
5. For each row, bucket its items into columns by x-position against the
   boundaries from step 2.
6. A row with content *only* in the Description/Details x-range (no Date, no
   Fee, no Amount) is a continuation of the previous row: append its text to
   that column of the previous row instead of starting a new row.
7. Skip the header row itself, and skip any row whose Details contains
   "(canceled)".
8. Convert each remaining row into a candidate transaction (next section).

## Row → transaction mapping

- **Date:** combine the row's "Sep 5" with the page's month/year → `2026-09-05`.
- **Sign:** Amount starting with `+` is a credit (positive); no `+` is a debit
  (negative).
- **Fee folding:** `amount_cents = round((signedAmount - fee) * 100)`, where
  `signedAmount` is the Amount column with its sign applied and `fee` is
  always a positive cost. A `+$100.00` deposit with a `$1.00` fee becomes
  `+$99.00` (`9900` cents); a `$16.88` debit with a `$0.50` fee becomes
  `-$17.38` (`-1738` cents).
- **Description:** `"<Description> (<Details>)"`, e.g.
  `"From Stride Bank, National Association x8703 (Standard transfer)"`. One
  field, no schema change.
- **category_id / bill_id:** always `null` — there's no categories/bills CRUD
  yet (separate, later roadmap items), consistent with how the rest of the
  app already treats uncategorized transactions.

## Duplicate detection

For each candidate row, query whether a transaction already exists with the
same `(date, description, amount_cents)` triple. This is informational only
— surfaced in the preview, never used to silently drop a row. Two real
transactions can legitimately share a date, description, and amount (e.g. two
separate $10 Draftkings charges on the same day), so the user makes the final
call per row, not the importer.

## Backend

Two endpoints, deliberately split so parsing has no side effects:

| Method | Path | Body | Behavior |
|--------|------|------|----------|
| POST | `/api/v1/transactions/import/preview` | multipart file upload (the PDF) | Parses the file per the steps above. Returns `{ data: { transactions: Array<NewTransaction & {isDuplicate: boolean}> } }`. Writes nothing to the DB. |
| POST | `/api/v1/transactions/import` | `{ transactions: NewTransaction[] }` | Validates every transaction with the existing `validateTransaction` helper (same shape as `NewTransaction` already). If any fails, `400` with no rows inserted. Otherwise inserts all of them in one DB transaction (all-or-nothing) and returns `{ data: { created: number } }`. |

Both routes sit behind `requireAuth`, same as the rest of `/api/v1/transactions`.

New backend dependencies: `pdfjs-dist` (no built-in alternative — Node has no
PDF support) and `multer` (standard multipart-upload handling for Express;
hand-rolling multipart parsing isn't worth it here).

A parsing failure (e.g. a PDF that doesn't match the expected header/layout)
returns `400 { error: 'Could not find the expected statement layout in this PDF' }`
from the preview endpoint — no partial/best-effort parse.

## Frontend

New `/import` route (added to the authenticated routes, inside `Layout`):

1. A file input for the PDF.
2. On selection, POST to `/import/preview`; show a loading state while the
   (synchronous, CPU-bound) parse runs.
3. Render every candidate transaction in the existing ledger-row style used
   elsewhere in the app, each with a checkbox — checked by default, except
   rows flagged `isDuplicate`, which start unchecked and are visually marked
   (e.g. a "possible duplicate" tag, same visual language as the existing
   `ledger-category` pill).
4. An "Import N transactions" button (N = current checked count) POSTs the
   checked subset to `/import`.
5. On success, show a result message ("Imported 42 transactions") and clear
   the preview, so the user can import another statement without a page reload.

No column-mapping UI — out of scope per the narrowed format (see Source
format above). If a second statement format (a different bank, or Cash App's
actual CSV export) gets added later, the parsing step is isolated enough
(`parseCashAppStatement(buffer): NewTransaction[]`) to add a second parser
function behind the same preview/confirm endpoints without reworking them.

## Testing

- `node:test` coverage for the row-reconstruction logic (continuation-line
  merging, header/canceled-row skipping, column bucketing) against small
  synthetic position data — not full real PDFs, so tests don't depend on a
  fixture file with the user's real transaction history.
- Coverage for the mapping rules in isolation: date reconstruction, sign +
  fee folding (both the deposit-with-fee and debit-with-fee cases above),
  description concatenation.
- An integration test for `POST /api/v1/transactions/import` using a small
  hand-built `transactions` array (valid rows, one invalid row to confirm the
  whole batch is rejected, and a duplicate-vs-not case) against the `:memory:`
  DB pattern already used by the auth integration tests.
- No automated test parses the user's actual statement PDF — that's verified
  manually, once, against the real file during end-to-end checking.

## Not building now

- Column mapping for arbitrary/unknown CSV or PDF formats.
- A second bank's statement parser.
- Auto-categorization during import (separate, later roadmap item — "rules").
- Editing a transaction's fields inline in the preview before import (only
  include/exclude per row).
