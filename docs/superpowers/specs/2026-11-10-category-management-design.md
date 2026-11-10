# Category management — design

**Status:** approved, ready for implementation plan
**Context:** The dashboard redesign (a separate, follow-on project) wants a
"where did the money go" breakdown by category, with a name and a color per
category. Categories currently exist only as a raw `category_id` on
`transactions` and a bare `categories(id, name)` table with no endpoints, no
service, and no UI — every category shows up in the app today as `Cat #N`.
This project makes categories a first-class, manageable thing so the
dashboard (and the rest of the app) can show real names and colors. The
dashboard itself is out of scope here.

## Data model

`categories` already exists:

```sql
CREATE TABLE IF NOT EXISTS categories(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
) STRICT;
```

Add a `color` column via migration (SQLite has no `ALTER TABLE ... ADD COLUMN
IF NOT EXISTS`, so guard it with a `pragma_table_info` check, run once at
startup in `db.ts` alongside the existing `CREATE TABLE IF NOT EXISTS`
statements):

```sql
ALTER TABLE categories ADD COLUMN color TEXT NOT NULL DEFAULT '#6b9478';
```

`color` is a hex string, chosen by the user per category (not auto-assigned).
No `kind` (income/expense) field — that distinction stays implicit in the
sign of `amount_cents` on the transactions that reference a category.

The existing `transactions.category_id` FK (`ON DELETE SET NULL`) already
does the right thing when a category is deleted: referencing transactions
fall back to uncategorized, no cascade-delete needed.

## Backend

Mirrors the existing `transactions` service/controller/router pattern:

- `types/category.ts` — `Category = {id, name, color}`, `NewCategory =
  Omit<Category, 'id'>`.
- `helpers/categoryValidation.ts` — `validateCategory(body)`: `name` required,
  non-empty string; `color` required, must match `/^#[0-9a-fA-F]{6}$/`.
  Returns the same `{ok: true, value} | {ok: false, error}` shape as
  `transactionValidation.ts`.
- `services/categories.service.ts` — `CategoryService`: `getAllCategories()`
  (ordered by `name`), `getCategoryById(id)`, `createCategory(c)`,
  `updateCategory(id, c)`, `deleteCategory(id)`. Same `db.prepare(...).get/run`
  style as `TransactionService`.
- `controllers/categories.controller.ts` — `getAllCategories`,
  `getCategoryById`, `createCategory`, `updateCategory`, `deleteCategory`.
  Same validation/error-shape conventions as `transactions.controller.ts`
  (400 on bad id/body, 404 on not found, 204 on delete). A duplicate `name`
  hits the `UNIQUE` constraint — catch it and return 400 "Category name
  already exists" (same pattern as the `FOREIGN KEY` catch elsewhere).
- `routes/categories.router.ts` — `GET /`, `POST /`, `GET /:id`, `PUT /:id`,
  `DELETE /:id`, mounted at `/categories` in `app.ts` next to
  `transactionsRouter`.

## Frontend

- `types/category.ts` — `Category`, `NewCategory` (mirrors backend).
- `services/CategoryApiService.ts` — same `BaseApiService` pattern as
  `TransactionApiService`, base path `/categories`.
- New `categories/Categories.tsx` page at route `/categories`, added to
  `Layout.tsx`'s nav next to Dashboard/Transactions/Import. Ledger-style rows
  (color swatch + name), each editable inline (click to edit name/color,
  save/cancel), plus an "add category" row at the top. Delete per row with
  the existing ledger visual language (no modal confirm — matches the app's
  current no-ceremony interaction style).
- `transactions/Transactions.tsx`: replace the current read-only
  `categoryLabel(t.category_id)` pill with an inline picker:
  - Categories are fetched once (alongside transactions) and looked up by id.
  - Clicking the pill turns it into a `<select>` of all categories plus
    "Uncategorized"; choosing a value calls `updateTransaction(t.id, {...t,
    category_id})` immediately (no separate save/cancel step) and the row's
    local state updates optimistically from the response.
  - The pill's color reflects the category's stored `color` instead of the
    current flat `--text-on-paper-dim` styling.
- `helpers/ledger.ts`: remove `categoryLabel` (the `Cat #N` placeholder) now
  that real names are available; callers look up the name from the fetched
  categories list (falling back to "Uncategorized" for `null`).

## Out of scope

- Dashboard category breakdown (separate follow-on project).
- Bills management (same shape of problem, not asked for here).
- Category `kind`/type field, budgets, or icons.
- Bulk re-categorization or category merge/rename-with-history.
