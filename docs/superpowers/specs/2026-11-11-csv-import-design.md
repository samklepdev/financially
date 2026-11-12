# CSV import with column mapping — design

**Status:** approved, ready for implementation plan
**Context:** import is currently PDF-only
([[2026-11-11-ollama-import-categorization-design]] and earlier work note this
was a deliberate choice when the only real source was a Cash App PDF
statement). The user now wants to import a CSV too — not necessarily Cash
App's own CSV export specifically, but any bank/app's CSV — so rather than
hardcoding one more fixed layout, this adds a generic importer where the user
maps which CSV column is the date, which is the description, and which is
the amount.

A real Cash App CSV export was used as the concrete test case (see "Sample
format" below), but nothing in the implementation is Cash-App-specific.

## Sample format (for context, not hardcoded)

```
"Date","Transaction ID","Transaction Type","Currency","Amount","Fee","Net Amount","Asset Type","Asset Price","Asset Amount","Status","Notes","Name of sender/receiver","Account"
"2026-11-11 16:42:35 CST","","Account Notifications","USD","$0.00","","$0.00","","","","COMPLETE","New device login","","Cash Balance"
"2026-11-11 12:55:14 CST","","Cash Card","USD","-$2.10","$0.00","-$2.10","","","","WAITING_ON_RECIPIENT","CTLP*J&S VENDING","","Cash Balance"
```

Notable things this format exercises that the generic parser must handle:
quoted fields (always quoted, even when empty), a date column with an
embedded time and timezone abbreviation, and amounts with a `$` prefix and a
leading `-` for debits. It also has plenty of rows that aren't "real"
transactions (zero-amount notifications, `FAILED`/`WAITING_ON_RECIPIENT`
status) — handled by review-time checkboxes, not special-cased parsing (see
"Row filtering" below).

## Backend

### `backend/src/helpers/csvParsing.ts` (new, pure, unit-tested)

- `parseCsv(text: string): string[][]` — a small RFC4180-ish parser (no new
  dependency): splits on commas outside of quoted fields, un-escapes doubled
  `""` inside quoted fields, and splits rows on newlines outside of quoted
  fields (a quoted field may itself contain a newline). Row 0 is the header
  row; caller is responsible for splitting it off.
- `parseGenericDate(raw: string): string` — returns `YYYY-MM-DD`.
  - If `raw` starts with `YYYY-MM-DD` (optionally followed by a time and/or
    timezone abbreviation, e.g. `"2026-11-11 16:42:35 CST"`), that leading
    date is returned directly. Deliberately does **not** parse the time or
    timezone — the project has already hit a timezone-arithmetic bug once
    (see [[Financially - Design Decisions]], the dashboard "Running Balance"
    work), and a statement date is a wall-clock calendar date, not an
    instant, so there is nothing to convert.
  - Else if `raw` matches `MM/DD/YYYY` (1-2 digit month/day), it's reformatted
    to `YYYY-MM-DD`.
  - Else throws `Error('Could not parse date: "<raw>"')`.
- `parseGenericAmount(raw: string): number` — returns `amount_cents`.
  Strips `$`/commas/whitespace; treats a value wrapped in parens (`"(12.34)"`)
  or with a leading `-` as negative; throws
  `Error('Could not parse amount: "<raw>"')` if no digits remain.

### `backend/src/services/csvImportMapper.service.ts` (new, pure, unit-tested)

```ts
type CsvColumnMapping = {date: string, description: string, amount: string};

function mapCsvToTransactions(
    headers: string[], rows: string[][], mapping: CsvColumnMapping
): {transactions: NewTransaction[], errors: {row: number, message: string}[]}
```

For each data row (1-indexed in `errors` as the user would count them,
i.e. row 1 = the first row after the header), looks up the three mapped
columns by header name, calls `parseGenericDate`/`parseGenericAmount`. A
thrown error for a row is caught and pushed to `errors` with that row's
number and the error's message; the row is skipped (not included in
`transactions`), and the rest of the file still processes normally.

### `transactionsImport.controller.ts` refactor

The suggestion/duplicate-flagging logic currently inline in `previewImport`
(history match → rule match → Ollama fallback, `isDuplicate` via
`existsSimilar`) is extracted into a shared function:

```ts
async function buildImportCandidates(transactions: NewTransaction[]): Promise<ImportCandidate[]>
```

`previewImport` (PDF) now calls this after `parseCashAppStatementPdf`; it is
otherwise unchanged (mimetype check, parse-error handling). The new CSV
handler calls the same function — this is also what makes "dedupe similar
transactions" work for CSV with zero extra code: `existsSimilar` runs
identically regardless of source.

New handler `previewCsvImport(req, res)`:

1. `req.file` required (400 if missing) — no mimetype gate (CSV mimetypes
   vary across browsers/OS and aren't worth gating on; a file that isn't
   actually CSV will just fail to parse meaningfully and most rows will
   land in `errors`).
2. `req.body.dateColumn` / `descriptionColumn` / `amountColumn` required
   (400 if any missing).
3. Parse `file.buffer` as UTF-8 text, run `parseCsv`, split off the header
   row.
4. 400 if any of the three requested column names isn't present in the
   header row (clear error naming which one).
5. `mapCsvToTransactions(headers, rows, mapping)` → `{transactions, errors}`.
6. `candidates = await buildImportCandidates(transactions)`.
7. Respond `200 {data: {transactions: candidates, errors}}`.

### Routing

`transactionsRouter.post('/import/csv/preview', upload.single('file'), previewCsvImport);`

**No new confirm endpoint.** The existing `POST /transactions/import`
(`confirmImport`) already accepts `ImportConfirmItem[]` — identical shape
regardless of whether the candidates came from a PDF or a CSV — so
confirming a CSV import reuses it unchanged.

## Data model

No new tables or columns. `ImportCandidate`/`ImportConfirmItem` (frontend
and backend) are unchanged structurally. The preview response gains one new
sibling field, `errors`, alongside `transactions` — not part of
`ImportCandidate` itself.

## Frontend

- `Import.tsx` gains a format toggle (`'pdf' | 'csv'`, local state, defaults
  to `'pdf'`) above the file picker. Nothing about the existing PDF flow
  changes — same file input, same immediate preview-on-select behavior.
- Choosing `'csv'` shows a file input; once a file is chosen, its header row
  is read client-side (`await file.text()`, first line, same quoted-field
  splitting logic as the backend parser — a small shared-shape helper, not
  literally shared code since one runs in Node and one in the browser) to
  populate three `<select>`s: Date column / Description column / Amount
  column.
  - Auto-guessed defaults: for each of the three, pick the first header
    whose name contains (case-insensitively) a keyword — `"date"` for date;
    `"description"`, `"desc"`, `"notes"`, `"memo"` for description;
    `"amount"` for amount (a header containing both "net" and "amount", e.g.
    "Net Amount", is preferred over a plain "Amount" column if both exist,
    since a net/fee-adjusted amount is the more useful one to default to).
    User can override any of the three before previewing.
- A "Preview" button (CSV path only — PDF still previews immediately on file
  selection) uploads the file plus the three chosen column names to
  `POST /transactions/import/csv/preview`.
- The response's `transactions` render through the exact same candidate list
  `Import.tsx` already has (checkboxes, category select, `NewCategoryBadge`,
  `aiSuggested` badge, `SaveAsRuleButton`) — no new review UI.
- **Default selection differs for CSV only:** `selected: !c.isDuplicate && c.amount_cents !== 0`
  (vs. the PDF path's existing `selected: !c.isDuplicate`). This is a
  generic, source-agnostic rule (not Cash-App-specific) that happens to
  default-exclude the sample's zero-amount "Account Notifications" rows.
  Rows with a non-`COMPLETE` status, or anything else format-specific, are
  left for the user to deselect by hand using the existing checkboxes — no
  new filtering UI.
- The response's `errors` (if any) render as a small list above the
  candidate table, e.g. "Skipped 2 rows: row 14: Could not parse date
  \"n/a\"; row 201: Could not parse amount \"\"".
- Confirming a CSV preview calls the existing `importApiService.confirmImport`
  unchanged.

## Testing

- Unit tests for `parseCsv` (quoted fields, embedded commas, doubled-quote
  escaping, multiple rows), `parseGenericDate` (ISO-with-time-and-tz, bare
  ISO, `MM/DD/YYYY`, unparseable throws), `parseGenericAmount` (`$`-prefixed
  negative, parens-negative, plain, comma-thousands, unparseable throws),
  and `mapCsvToTransactions` (good rows mapped correctly, a bad row is
  collected into `errors` with the right 1-indexed row number and the rest
  of the file still processes).
- HTTP-level tests for `previewCsvImport`'s plumbing (missing file → 400,
  missing mapping field → 400, unknown column name → 400, a small CSV with
  one good and one bad row → candidates + errors both populated) — the
  suggestion/duplicate logic itself isn't re-tested here since it's the same
  `buildImportCandidates` already exercised by the existing PDF import
  tests.
- Frontend: `npx tsc -b --noEmit` plus a manual check using a real sample
  CSV, both with Ollama running and stopped.

## Out of scope

- Remembering a column mapping between imports (e.g. a saved "profile" per
  bank) — always re-map or re-confirm the auto-guessed mapping each time.
- A "status filter" column/value mapping (e.g. only include rows where
  `Status == COMPLETE`) — the existing per-row checkboxes already let the
  user exclude anything, and this keeps the importer generic instead of
  growing Cash-App-specific concepts.
- Auto-detecting file type by sniffing content — the user explicitly picks
  PDF or CSV via the toggle.
- CSV export (writing data out) — import only.
