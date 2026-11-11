# Import auto-categorization — design

**Status:** approved, ready for implementation plan
**Context:** Follow-on to [[2026-11-10-category-management-design]] (the category
system that project adds is a prerequisite here — this branch is built on top
of it, not on top of `main`). Every transaction imported from a Cash App
statement currently lands as `category_id: null` (`mapRowToTransaction` in
`backend/src/helpers/cashAppMapping.ts` always sets it to `null`), so after an
import the user has to manually categorize every row one at a time on the
Transactions page. This project makes the import preview suggest a category
for each candidate by matching its description against transactions the user
has already categorized, so repeat merchants (which Cash App statements are
full of — the same grocery store, the same subscription, month after month)
don't need to be re-categorized by hand every time.

## Matching rule

- **Match key:** exact string equality on `description` (the already-combined
  `"<merchant> (<details>)"` string `buildDescription` produces — not a looser
  match that strips the parenthesized details). Two transactions only match
  if they'd display identically.
- **Match scope:** against already-confirmed transactions only (the
  `transactions` table), never against other candidates in the same import
  batch.
- **Tiebreak:** when multiple past transactions share the same description
  with different categories, use the most recently *dated* one's category
  (`ORDER BY date DESC, id DESC`, matching the tiebreak `TransactionService`
  already uses elsewhere) — reflects how the user categorizes that merchant
  now, not historically.
- **No match:** `category_id` stays `null` (today's behavior, unchanged).

This intentionally does not touch already-confirmed transactions, does not
suggest anything during manual entry (`createTransaction`/`updateTransaction`
outside of import), and does not attempt fuzzy/partial matching.

## Backend

Add one method to `TransactionService` (`backend/src/services/transactions.service.ts`),
styled the same as the existing `existsSimilar`:

```ts
/**
 * Finds the category most recently assigned to a transaction with this exact
 * description. Used to suggest a category for a newly imported transaction
 * that looks like one the user has already categorized.
 *
 * @return The matching category_id, or null if no categorized transaction
 * shares this description.
 */
findRecentCategoryForDescription(description: string): number | null {
    const row = db.prepare(
        `SELECT category_id FROM transactions
         WHERE description = ? AND category_id IS NOT NULL
         ORDER BY date DESC, id DESC LIMIT 1`
    ).get(description) as {category_id: number} | undefined;
    return row?.category_id ?? null;
}
```

Wire it into `previewImport` (`backend/src/controllers/transactionsImport.controller.ts`),
alongside the existing `isDuplicate` flag:

```ts
const withSuggestions = transactions.map((t) => ({
    ...t,
    category_id: transactionService.findRecentCategoryForDescription(t.description),
    isDuplicate: transactionService.existsSimilar(t.date, t.description, t.amount_cents),
}));
```

(Replaces today's `withDuplicateFlags` variable — same shape, one more field
set per candidate. No change to `ImportCandidate`, `NewTransaction`, or any
other type: `category_id` already exists on both.)

## Frontend

`frontend/src/import/Import.tsx` gains the same inline category control
`Transactions.tsx` already has:

- Fetch categories once on mount via `categoryApiService.getAllCategories()`
  (same pattern as `Transactions.tsx`/`App.tsx`).
- Add `editingCategoryFor: number | null` state, keyed by the candidate's
  array index (candidates have no stable id before import).
- Render a category pill (`categoryName(categories, c.category_id)`) in place
  of plain text; clicking it swaps in a `<select>` of all categories plus
  "Uncategorized", matching `Transactions.tsx`'s picker exactly except the
  change handler updates local `candidates` state instead of calling
  `transactionApiService.updateTransaction` — nothing is persisted until the
  user confirms the import:

  ```tsx
  function updateCandidateCategory(index: number, value: string) {
      const category_id = value === '' ? null : Number(value);
      setCandidates((prev) => prev.map((c, i) => i === index ? {...c, category_id} : c));
      setEditingCategoryFor(null);
  }
  ```

- **Layout change:** `.ledger-row__main`'s third grid column currently shows
  the "Possible duplicate" pill when `c.isDuplicate`. That column is needed
  for the category picker instead, so "Possible duplicate" moves to a small
  inline badge next to the description:

  ```tsx
  <span className="ledger-desc">
      {c.description}
      {c.isDuplicate && <span className="import-duplicate-badge">Possible duplicate</span>}
  </span>
  ```

  with new (not reused) CSS for `.import-duplicate-badge` — small, inline,
  using the existing `--due` color token, visually distinct from the
  pill-shaped category control so the two don't read as the same kind of tag.

- `toNewTransaction` (the `{selected, isDuplicate, ...t}` destructure used
  before confirming) is unchanged — `category_id` already flows through as
  part of `t`.

## Testing

No HTTP-level test exists today for `previewImport` itself (it requires a
real multipart PDF upload and there's no fixture PDF in the repo — coverage
for the import pipeline instead lives in the `cashAppMapping`/`statementRows`
parser unit tests plus the `confirmImport` route tests in
`transactionsImport.test.ts`). This project matches that existing coverage
level rather than introducing new fixture infrastructure:

- Direct unit tests on `TransactionService.findRecentCategoryForDescription`
  in `transactions.service.test.ts`, the same way `existsSimilar` is tested
  there today.
- The one-line wiring change in `previewImport` is trusted the same way the
  existing `isDuplicate` wiring in that function is (untested at the HTTP
  level, covered at the service-method level).
- Frontend: TypeScript build check (`npx tsc -b --noEmit`) plus manual
  verification in the running app — this repo has no frontend test runner
  (see [[2026-11-10-category-management-design]]).

## Out of scope

- Fuzzy/partial description matching (e.g. ignoring the parenthesized
  details, or matching on a merchant-name prefix).
- Suggesting categories outside of import preview (e.g. while manually
  creating or editing a transaction).
- Any change to the Cash App PDF parser itself, or to `mapRowToTransaction`'s
  output shape.
- Keyword/rule-based categorization (e.g. a user-maintained merchant → category
  table) — this project only reuses categorizations the user has already made.
