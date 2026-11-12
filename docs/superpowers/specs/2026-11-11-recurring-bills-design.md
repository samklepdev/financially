# Recurring bills / subscriptions tracking — design

**Status:** approved, ready for implementation plan
**Context:** the original README roadmap listed "Upcoming bills (next 14
days)" and the schema already has a `bills(id, name, amount_cents, due_day)`
stub table and a `transactions.bill_id` FK, but no service, controller,
routes, or UI were ever built on top of it. This project finishes that slice
and adds two things the stub never had: auto-linking transactions to bills
by description match (mirroring [[2026-11-11-keyword-category-rules-design]]),
and auto-suggesting candidate bills from transaction history for merchants
the user hasn't set up a bill for yet.

## Data model

Extend the existing `bills` table with one additive column, guarded the same
way `categories.color` was added in `db.ts` (SQLite has no
`ADD COLUMN IF NOT EXISTS`, so check `pragma_table_info` first and only
`ALTER TABLE` once per database file):

```sql
CREATE TABLE IF NOT EXISTS bills(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31)
) STRICT;
```

```ts
// guarded ALTER, same pattern as categories.color:
const billColumns = db.prepare("SELECT name FROM pragma_table_info('bills')").all() as {name: string}[];
if (!billColumns.some((c) => c.name === 'match_pattern')) {
    db.exec(`ALTER TABLE bills ADD COLUMN match_pattern TEXT NOT NULL DEFAULT ''`);
}
```

- `match_pattern`: case-insensitive substring matched against transaction
  descriptions, same semantics as `category_rules.pattern`. An empty string
  means the bill has no auto-linking behavior — the user must link matching
  transactions to it manually.
- Monthly-only recurrence: `due_day` (1–31) is kept as-is, no new interval
  types (weekly/yearly) in this iteration. For months shorter than the
  stored `due_day` (e.g. `due_day = 31` in February), the due date clamps to
  the last day of that month.
- `transactions.bill_id` already exists with `ON DELETE SET NULL` — no
  change. (Unlike `category_rules`, which cascades on delete, a bill is more
  like a category here: deleting it shouldn't delete the transactions that
  were paying it.)
- No new table for detected-but-not-yet-added recurring bills. Suggestions
  are computed live from `transactions` on each page load and never
  persisted — accepting a suggestion just pre-fills the "add bill" form.

## Backend

New vertical slice, mirroring `categories`/`category_rules`:

- `types/bill.ts` — `Bill = {id, name, amount_cents, match_pattern, due_day}`,
  `NewBill = Omit<Bill, 'id'>`.
- `helpers/billValidation.ts` — `validateBill(body)`: `name` required
  non-empty string, `amount_cents` required positive integer,
  `due_day` required integer in `[1, 31]`, `match_pattern` required string
  (may be empty).
- `services/bill.service.ts` — `BillService`:
  - `getAllBills()`, `getBillById(id)`, `createBill`, `updateBill`,
    `deleteBill` — same `db.prepare(...).get/run` style as `CategoryService`.
  - `findBillForDescription(description: string): number | null` — same
    substring-match, longest-pattern-wins logic as
    `CategoryRuleService.findCategoryForDescription`, skipping bills whose
    `match_pattern` is empty.
  - `getUpcomingBills(today: Date)` — for each bill, compute the current
    billing cycle's due date from `due_day` (clamped to month length) and the
    window `[previous due date, next due date)`. Query `transactions` for a
    row with that `bill_id` whose `date` falls in the current window.
    Returns `{bill, dueDate, status}[]` where `status` is:
    - `'paid'` — a linked transaction exists in the current window.
    - `'overdue'` — due date is in the past (this cycle) and unpaid.
    - `'upcoming'` — due date is within the next 14 days (inclusive) and
      unpaid.
    - bills whose due date is neither past-due nor within 14 days are
      omitted from the result entirely (nothing to show on the dashboard).
    All date math uses `Date.UTC`/`getUTCDate`/`setUTCDate`, per the
    timezone lesson from
    [[2026-11-11-dashboard-income-and-cashflow-charts-design]].
  - `getSuggestedBills()` — groups transactions with `bill_id IS NULL` by
    exact `(description, amount_cents)`, keeps groups with **3 or more**
    occurrences whose consecutive dates are each 28–33 days apart (tolerates
    weekends/month-length drift without catching unrelated repeat
    purchases), and excludes any group whose `description` already matches
    an existing bill's `match_pattern` (via `findBillForDescription`).
    Returns `{description, amount_cents, suggested_due_day, occurrences}[]`,
    where `suggested_due_day` is the day-of-month of the most recent
    occurrence.
- `controllers/bill.controller.ts` + `routes/bill.router.ts` — standard CRUD
  (400 on bad id/body, 404 on not found, 204 on delete, matching
  `categories.controller.ts`), plus:
  - `GET /bills/upcoming` → `getUpcomingBills(new Date())`
  - `GET /bills/suggestions` → `getSuggestedBills()`
  - Mounted at `/bills` in `app.ts`, behind `requireAuth`, next to
    `categoriesRouter`/`categoryRulesRouter`.

**Auto-linking on transaction entry:** both `previewImport` (import) and
`POST /transactions/suggest-category` (manual add, from
[[2026-11-11-manual-transaction-ollama-category-design]]) gain one more
step after category resolution: call
`BillService.findBillForDescription(description)` and, if it returns a
bill id, include it in the response as `bill_id` so the frontend can
pre-fill the bill selector the same way it pre-fills category. This is a
**suggestion at creation time only** — it is not retroactively applied to
transactions that already exist. Existing transactions can still be linked
to a bill manually via the transaction edit UI (see Frontend below).

## Frontend

- `types/bill.ts`, `services/BillApiService.ts` — same `BaseApiService`
  pattern as `CategoryApiService`/`CategoryRuleApiService`.
- New `bills/Bills.tsx` page at route `/bills`, added to `Layout.tsx`'s nav,
  same ledger-row list style as `Rules.tsx`:
  - An "add bill" row at the top: text input for name, amount, due day
    (1–31), and match pattern.
  - Each existing bill shown as a row: name, amount, due day, match
    pattern — all editable inline, same no-confirm-step convention as the
    rest of the app — plus a delete button.
  - A **"Suggested bills"** section below the list, populated from
    `GET /bills/suggestions` on page load. Each suggestion row shows the
    description, amount, and occurrence count, with an "Add as bill" button
    that pre-fills the add-bill form (`name` = description, `amount_cents`
    = amount, `due_day` = suggested day, `match_pattern` = description) for
    the user to edit and confirm before saving — it does not save directly.
    A "Dismiss" link removes a suggestion from view for the current page
    load only; since nothing is persisted, a dismissed suggestion may
    reappear on a future visit if the user still hasn't added a matching
    bill or linked those transactions — acceptable since the suggestion
    list is small and the user can always add the bill to make it stop.
- `transactions/Transactions.tsx` (and the add-transaction form from
  [[2026-11-11-manual-transaction-ollama-category-design]]): the existing
  category `<select>` gains a sibling bill `<select>` (optional, default
  "No bill"), using the same immediate-update-on-change convention as the
  category selector, for manual linking/correction of any transaction.
- `dashboard/Dashboard.tsx`: new "Upcoming Bills" card, populated from
  `GET /bills/upcoming`, sorted by due date ascending. This card is
  **independent of the existing 30D/90D/1Y/All range selector** — that
  selector filters historical chart data; this widget is forward-looking
  and always shows the same 14-day/overdue window regardless of the
  selected range. Overdue bills render with a warning style (e.g. red
  text/icon); upcoming ones show "due in N days" (or "due today" for
  `N = 0`).

## Testing

- Backend: `node --test` coverage on `BillService` for:
  - CRUD (mirrors `categories.service.test.ts`).
  - `findBillForDescription`: substring match, longest-pattern-wins,
    empty-pattern bills never match.
  - `getUpcomingBills`: paid/overdue/upcoming status computation, the
    month-boundary clamp (`due_day = 31` in a 30-day or February month),
    and the "omitted when neither overdue nor within 14 days" case.
  - `getSuggestedBills`: the 3-occurrence threshold (2 occurrences does not
    suggest), the 28–33 day spacing tolerance (occurrences spaced too close
    or too far apart don't group), and exclusion of descriptions already
    matched by an existing bill's pattern.
  - HTTP-level route tests for the new CRUD endpoints plus
    `/bills/upcoming` and `/bills/suggestions`, at the same level as
    `categories.test.ts`.
  - The auto-link addition to `previewImport` and
    `POST /transactions/suggest-category` is verified manually, consistent
    with how the existing category-rule fallback in those same call sites
    has no dedicated HTTP-level test (see
    [[2026-11-11-keyword-category-rules-design]]).
- Frontend: `npx tsc -b --noEmit` plus manual verification in the running
  app — add a bill, confirm it appears on `/bills` and (once due-date logic
  applies) in the dashboard widget; import/add a transaction matching a
  bill's pattern and confirm auto-link; confirm a suggestion appears after
  3+ unlinked matching transactions and that accepting it creates a working
  bill.

## Out of scope

- Non-monthly recurrence (weekly, biweekly, yearly) — `due_day` stays a
  single monthly anchor.
- Persisted/dismissible suggestion state — suggestions are always
  recomputed fresh; dismissal is session-local (component state only).
- Retroactive auto-linking of bills to transactions that existed before the
  bill was created — only new transactions at creation time get the
  suggestion.
- Notifications/reminders (email, push, etc.) for upcoming or overdue
  bills — the dashboard widget is the only surface for this in this
  iteration.
- Partial payments or amount tolerance in matching "paid" status — a linked
  transaction in the current cycle marks the bill paid regardless of
  whether its amount matches `bills.amount_cents` exactly.
