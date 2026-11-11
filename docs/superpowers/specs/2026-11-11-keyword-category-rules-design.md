# Keyword-based category rules — design

**Status:** approved, ready for implementation plan
**Context:** [[2026-11-11-import-auto-categorization-design]] shipped category
suggestions on import, but that feature only *reuses* a category you've
already manually assigned to the exact same description once before — it
can't invent a category for a merchant it's never seen categorized, because
the Cash App statement itself carries no category information at all (just
date, merchant text, and amount). The actual ask behind that project —
confirmed after testing it with an empty database — was zero manual
categorization, ever. The only way to get there without new infrastructure
(no LLM call, no third-party categorization service) is a keyword/merchant
rule table the user maintains once per merchant pattern, instead of once per
transaction. This project adds that.

## Data model

New table, following the same `STRICT`/`IF NOT EXISTS` convention as the rest
of `backend/src/config/db.ts`:

```sql
CREATE TABLE IF NOT EXISTS category_rules(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern TEXT NOT NULL,
    category_id INTEGER NOT NULL,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
) STRICT;
```

`ON DELETE CASCADE`, not `SET NULL` like `transactions.category_id` —
unlike an uncategorized transaction (still a meaningful row), a rule
pointing at no category is meaningless, so deleting a category deletes its
rules too.

## Matching rule

- **Pattern match:** case-insensitive substring. A rule with pattern
  `"walmart"` matches any description containing that text anywhere,
  regardless of case (e.g. `"Walmart Houston TX (Cash App Card)"`).
- **Multiple matches:** when more than one rule's pattern matches the same
  description, the **longest matching pattern** wins (more specific rules
  beat generic ones, e.g. a `"walmart"` rule beats a `"cash app"` rule on the
  same description, without the user having to manage explicit priority
  ordering).
- **Signal priority on import:** the already-merged exact-description history
  match (`TransactionService.findRecentCategoryForDescription`) is tried
  first; keyword rules are only consulted as a **fallback** when that returns
  `null`. A merchant you've manually categorized once still wins over a
  generic rule for that same exact description.
- **No match:** `category_id` stays `null` (today's behavior, unchanged).

## Backend

New vertical slice, mirroring `categories` exactly:

- `types/categoryRule.ts` — `CategoryRule = {id, pattern, category_id}`,
  `NewCategoryRule = Omit<CategoryRule, 'id'>`.
- `helpers/categoryRuleValidation.ts` — `validateCategoryRule(body)`:
  `pattern` required, non-empty string; `category_id` required integer.
  Existence of the referenced category is enforced by the FK at insert time
  (same pattern as `transactions.category_id`/`bill_id` today), not
  re-validated here.
- `services/categoryRules.service.ts` — `CategoryRuleService`:
  - `getAllCategoryRules()`, `getCategoryRuleById(id)`, `createCategoryRule`,
    `updateCategoryRule`, `deleteCategoryRule` — same `db.prepare(...).get/run`
    style as `CategoryService`.
  - `findCategoryForDescription(description: string): number | null` — loads
    all rules, filters to those whose `pattern` is a case-insensitive
    substring of `description`, returns the `category_id` of the rule with
    the longest `pattern` among matches (ties broken arbitrarily — the SQL
    `ORDER BY LENGTH(pattern) DESC LIMIT 1` approach is fine since a true tie
    means two equally-specific patterns, an edge case not worth a second
    tiebreak rule).
- `controllers/categoryRules.controller.ts` + `routes/categoryRules.router.ts`
  — full CRUD, same status-code/error-envelope conventions as
  `categories.controller.ts` (400 on bad id/body, 404 on not found, 204 on
  delete). No uniqueness constraint on `pattern` (unlike category `name`) —
  two rules with the same pattern pointing at different categories is
  nonsensical but not harmful; the longest-match rule still picks one
  deterministically enough for this use case, so no extra validation is
  added for it.
- Mounted at `/category-rules` in `app.ts`, behind `requireAuth`, next to
  `categoriesRouter`.
- `transactionsImport.controller.ts`: `previewImport` tries
  `findRecentCategoryForDescription` first; if `null`, falls back to
  `CategoryRuleService.findCategoryForDescription`.

## Frontend

- `types/categoryRule.ts`, `services/CategoryRuleApiService.ts` — same
  `BaseApiService` pattern as `CategoryApiService`.
- New `rules/Rules.tsx` page at route `/rules`, added to `Layout.tsx`'s nav.
  Same ledger-row list style as `Categories.tsx`:
  - An "add rule" row at the top: a text input for the pattern plus a
    `<select>` of existing categories.
  - Each existing rule shown as a row: pattern text, a category `<select>`
    (changing it updates the rule immediately, same no-confirm-step
    convention as the rest of this app), and a delete button.
  - If there are no categories yet, the category `<select>` has nothing to
    offer — the add-rule form's button stays disabled until at least one
    category exists (same guard style as the existing "Add category" button
    disabling on an empty name).
- No changes to `Import.tsx` — the fallback is entirely server-side; the
  category picker added in the previous project already renders whatever
  `category_id` comes back from `previewImport`, regardless of which signal
  produced it.

## Testing

- Backend: direct unit tests on `CategoryRuleService` (CRUD +
  `findCategoryForDescription`, including the substring-match and
  longest-pattern-wins cases), the same level of coverage as
  `CategoryService`/`TransactionService`. HTTP-level route tests for the new
  CRUD endpoints, the same level of coverage as `categories.test.ts`.
- The `previewImport` fallback wiring is trusted the same way the existing
  history-match wiring is — no HTTP-level test exists for `previewImport`
  itself (see [[2026-11-11-import-auto-categorization-design]]); verified
  manually instead.
- Frontend: TypeScript build check (`npx tsc -b --noEmit`) plus manual
  verification in the running app — no frontend test runner in this repo.

## Out of scope

- Regex patterns (substring match only, per the approved design).
- Bulk-applying rules retroactively to already-imported, already-uncategorized
  transactions (only new import candidates get the fallback) — a reasonable
  future enhancement, not requested here.
- LLM-based or third-party merchant categorization.
- Manual rule priority/ordering — longest-pattern-wins replaces the need for
  it.
