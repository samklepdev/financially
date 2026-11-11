# Dashboard charts and AI chat — design

**Status:** approved, ready for implementation plan
**Context:** The user shared a screenshot of a richer finance dashboard
(Sankey cashflow, Net Worth line chart, spending trend, an outflows donut
with a category breakdown, and an AI chat sidebar) and asked for the current
`/dashboard` (today: a month switcher, three stat tiles, and a transaction
ledger — see `frontend/src/App.tsx`) to look more like it. Scoped down after
discussion: keep the existing paper/ink visual language as-is (no theme
change), skip the Sankey diagram (no data model for it), and add three real
charts plus a working AI chat sidebar, reusing the local Ollama model
(`gemma4:e4b`) already used for import categorization in
[[2026-11-11-ollama-import-categorization-design]].

## Scope

In scope:

- A time-range selector (30D / 90D / 1Y / All) independent of the existing
  month switcher.
- Three charts computed from data already available client-side: Running
  Balance (cumulative transaction sum), Spending Trend, and an Outflows
  donut with a category breakdown table.
- A collapsible AI chat sidebar, backed by a new `POST
  /api/v1/dashboard/chat` endpoint that asks the local Ollama model
  finance questions grounded in the user's actual transaction data for the
  selected range.

Out of scope:

- The Sankey cashflow diagram — no flow/edge data model exists for income →
  category → subcategory breakdowns, and building one is a separate project.
- True net worth (assets − liabilities) — this app has no account/asset
  model, only transactions. The closest honest proxy is a running cumulative
  balance, and it's labeled as such, not "Net Worth".
- Any visual restyle of the existing stat tiles / ledger / overall theme.
- Chat conversation persistence across page reloads.

## Data and charts (frontend-only, no new aggregation endpoints)

All three charts reuse the transactions and categories the dashboard already
fetches (`App.tsx` already calls `transactionApiService.getAllTransactions()`
and `categoryApiService.getAllCategories()`). No new backend endpoint is
needed for them — this mirrors how `totals` is already derived client-side
via `useMemo`.

New pure helpers in `frontend/src/helpers/dashboardMetrics.ts`:

- `rangeStartDate(range: '30d' | '90d' | '1y' | 'all', now: Date): string | null`
  — returns an ISO date to filter from, or `null` for `'all'`.
- `runningBalanceSeries(transactions, range)` — transactions sorted
  ascending by date within range, cumulative sum of `amount_cents`, one
  point per transaction date (same-day transactions collapse to the day's
  closing cumulative value).
- `spendingTrendSeries(transactions, range)` — sum of negative
  `amount_cents` (debits only, shown positive) grouped by day within range.
- `outflowsByCategory(transactions, categories, range)` — sum of debits
  grouped by `category_id` within range, joined to category name/color,
  sorted descending by total, including a `weight` (percentage of total
  outflows). Uncategorized debits group under a synthetic "Uncategorized"
  entry.

All four are pure functions over arrays already in memory — no new test
framework needed to hand-verify them, but since the project has no frontend
test runner this matches existing precedent (manual check + `tsc`).

Components, under a new `frontend/src/dashboard/` folder:

- `RangeSelect.tsx` — the 30D/90D/1Y/All toggle, lifts selected range to the
  parent.
- `charts/RunningBalanceChart.tsx` — Recharts `LineChart`.
- `charts/SpendingTrendChart.tsx` — Recharts `AreaChart`.
- `charts/OutflowsDonut.tsx` — Recharts `PieChart` (donut, `innerRadius` set)
  on the left, a category breakdown table (name, value, weight %) on the
  right/below, reusing each `Category.color` as its slice/swatch color.

New dependency: `recharts` (added to `frontend/package.json`).

`App.tsx` (the `/dashboard` page) renders, top to bottom: range selector →
chart grid (Running Balance + Spending Trend side by side, Outflows donut
below or alongside) → existing month switcher → existing stat row → existing
ledger. The chat sidebar (below) docks to the right of all of this.
Everything new is styled via a new `frontend/src/styles/dashboard.css`,
reusing existing CSS custom properties (`--ink-raised`, `--paper`,
`--credit`, `--debit`, `--rule-on-ink`, `--mono`, `--display`, `--sans`) — no
new palette.

## AI chat — backend

New vertical slice, mirroring the `categories` slice convention
(`types/`, `services/`, `controllers/`, `routes/`):

- `backend/src/types/dashboardChat.ts` — `ChatMessage = {role: 'user' |
  'assistant', content: string}`, `ChatRequestBody = {messages:
  ChatMessage[], range: '30d' | '90d' | '1y' | 'all'}`.
- `backend/src/services/dashboardChat.service.ts`:
  - `computeFinancialSummary(transactions: Transaction[], categories:
    Category[], range): FinancialSummary` — pure. `FinancialSummary =
    {totalIn: number, totalOut: number, net: number, topCategories: {name:
    string, totalCents: number}[]}` (top 5 by spend, same "Uncategorized"
    bucket as `outflowsByCategory`). All amounts in cents, matching the rest
    of the schema.
  - `buildChatPrompt(messages: ChatMessage[], summary:
    FinancialSummary): ChatMessage[]` — pure. Prepends a system message
    describing the assistant's role ("a budgeting assistant for a personal
    finance app; answer only from the figures given, in dollars, concisely")
    plus the computed summary formatted as plain text, then appends the
    caller's conversation history unchanged.
  - `askDashboardAssistant(messages: ChatMessage[], range): Promise<string>`
    — not unit tested, same precedent as `suggestCategories`. Loads
    transactions/categories via the existing `TransactionService` /
    `CategoryService`, computes the summary, builds the prompt, and
    `fetch`es `http://localhost:11434/api/chat` with `{model: 'gemma4:e4b',
    stream: false, think: false, messages: builtPrompt}`. 60-second timeout
    via `AbortController`, matching the documented cold-load behavior of
    this model. **Unlike** `suggestCategories`, failure does not resolve to
    a silent empty value — it throws, because this is a direct user action
    (clicking send) rather than a background enhancement, and the user
    needs to know the assistant didn't answer. The controller catches this
    and returns a 502 with a plain-language error.
- `backend/src/controllers/dashboardChat.controller.ts` — `postChatMessage`:
  validates `messages` is a non-empty array of `{role, content}` and `range`
  is one of the four allowed values (400 otherwise), calls
  `askDashboardAssistant`, returns `{data: {reply: string}}` on success, `{error:
  "Can't reach the local AI model. Make sure Ollama is running."}` with 502
  on failure.
- `backend/src/routes/dashboardChat.router.ts` — `POST /` →
  `postChatMessage`.
- `app.ts` — `app.use('/api/v1/dashboard', requireAuth, dashboardChatRouter)`.

## Frontend chat UI

- `frontend/src/services/DashboardChatApiService.ts` — axios wrapper,
  `sendMessage(messages, range): Promise<string>` posting to
  `/api/v1/dashboard/chat` and returning `data.reply`.
- `frontend/src/dashboard/DashboardChat.tsx` — collapsible sidebar docked
  right of the dashboard content. Holds its own `messages: ChatMessage[]`
  state (lost on reload — no persistence, per scope). A collapse toggle
  button remains visible when closed (so it can be reopened); open by
  default above a width breakpoint, collapsed by default below it (mirrors
  the existing `640px` breakpoint already used elsewhere in this app's
  CSS). Sending a message appends the user's message, calls
  `sendMessage(allMessages, currentRange)`, appends the assistant's reply
  or an inline error bubble ("Can't reach the local AI model. Make sure
  Ollama is running.") on failure, from the controller's error response —
  not a generic Axios error — so a non-Ollama failure (e.g. a validation
  400) still surfaces its own message rather than always printing the
  Ollama-specific one.
- The chat always sends the dashboard's currently-selected time range, so
  "how much did we save" answers match whatever range the charts are
  showing.

## Testing

- Backend: `node --test` unit tests for `computeFinancialSummary` (totals
  across a mixed in-range/out-of-range transaction set, top-5 category
  ordering, uncategorized bucketing) and `buildChatPrompt` (system message
  present and includes the summary figures, existing conversation messages
  passed through unchanged and in order). No test for
  `askDashboardAssistant`'s network call, same precedent as
  `suggestCategories`.
- Frontend: `npx tsc -b --noEmit` plus a manual check in the running app —
  verify each chart against a known transaction set, verify the range
  selector changes all three charts and the chat's grounding data, verify
  the chat sidebar collapses/expands and shows a readable error when Ollama
  is stopped.
