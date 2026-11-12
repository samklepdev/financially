# Design: Dashboard Income Trend & Net Cash Flow Charts

## Context

The dashboard (`frontend/src/App.tsx`) currently renders three chart cards in a
2-column `chart-grid`, all driven by one global range selector (`30d` / `90d` /
`1y` / `all`):

- `RunningBalanceChart` — cumulative balance, line chart
- `SpendingTrendChart` — daily sum of debits, area chart
- `OutflowsDonut` — spending by category, donut + table (pinned full-width as
  the grid's last child via `.chart-grid > :last-child { grid-column: 1 / -1 }`)

All three are computed client-side in `frontend/src/helpers/dashboardMetrics.ts`
from the already-fetched `transactions` array, re-derived with `useMemo` in
`App.tsx` whenever `transactions` or `range` changes.

This spec adds two more charts to that same grid: an income trend (requested)
and a net cash flow chart (proposed as the complementary addition, since
nothing on the dashboard currently shows month-over-month bottom line).

## Data layer

Two new functions in `frontend/src/helpers/dashboardMetrics.ts`, following the
existing module's conventions (range-filtered via the existing internal
`inRange` helper, exported point types):

```ts
export type IncomePoint = {date: string; incomeCents: number};

/** Sum of credits (shown positive) grouped by day within the range. */
export function incomeTrendSeries(
    transactions: Transaction[],
    range: DashboardRange,
    now: Date = new Date()
): IncomePoint[]
```

Mirrors `spendingTrendSeries` exactly, filtering `amount_cents > 0` instead of
`< 0`.

```ts
export type NetCashFlowPoint = {month: string; label: string; netCents: number};

/** Net of all transactions (credits + debits), grouped by calendar month within the range. */
export function netCashFlowByMonth(
    transactions: Transaction[],
    range: DashboardRange,
    now: Date = new Date()
): NetCashFlowPoint[]
```

Buckets range-filtered transactions by `monthKey(t.date)` (imported from
`frontend/src/helpers/ledger.ts`, already used in `App.tsx` for the ledger's
month switcher), sums `amount_cents` per bucket, and sorts ascending by month.
`label` is `monthLabel(month)` (also from `ledger.ts`) for display on the
chart's X-axis.

**Range behavior:** both functions respect the global `range` selector,
consistent with every other chart. For `netCashFlowByMonth`, a short range
(e.g. `30d`) may produce only one (possibly partial) month bar — this is
accepted behavior, not a bug, per the "respect the range selector" decision.

## Components

Two new files in `frontend/src/dashboard/charts/`, matching the existing
components' structure (`chart-card` wrapper, `ResponsiveContainer`, shared
`Tooltip` styling using `formatMoney` and the `--ink-raised`/`--rule-on-ink`
CSS vars):

### `IncomeTrendChart.tsx`

Same shape as `SpendingTrendChart.tsx`: `AreaChart` with a single `Area` on
`incomeCents`, `stroke`/`fill` using `var(--credit)` (where `SpendingTrendChart`
uses `var(--debit)`). X and Y axes hidden, same as the existing trend charts.

```tsx
type Props = {data: IncomePoint[]};
// <Area type="monotone" dataKey="incomeCents" name="Income" stroke="var(--credit)" fill="var(--credit)" fillOpacity={0.25}/>
```

### `NetCashFlowChart.tsx`

`BarChart` with a single `Bar` on `netCents`. Unlike the daily trend charts,
the X-axis is **visible** here and shows `label` (e.g. "Jan", "Feb") — months
are few enough and meaningful enough to label directly, unlike individual
days. Each bar is colored per-datum via `Cell` (same technique `OutflowsDonut`
uses for category colors): `var(--credit)` when `netCents >= 0`, `var(--debit)`
otherwise.

```tsx
type Props = {data: NetCashFlowPoint[]};
// <XAxis dataKey="label"/>
// <YAxis hide/>
// <Bar dataKey="netCents" name="Net">
//   {data.map((d) => <Cell key={d.month} fill={d.netCents >= 0 ? 'var(--credit)' : 'var(--debit)'}/>)}
// </Bar>
```

## Wiring (`App.tsx`)

Two new `useMemo`s alongside the existing `balanceSeries`/`spendSeries`/
`outflows`:

```ts
const incomeSeries = useMemo(
    () => incomeTrendSeries(transactions ?? [], range),
    [transactions, range]
);
const netCashFlow = useMemo(
    () => netCashFlowByMonth(transactions ?? [], range),
    [transactions, range]
);
```

Rendered in the `chart-grid` section in this order:

```tsx
<section className="chart-grid" aria-label="Financial charts">
    <RunningBalanceChart data={balanceSeries}/>
    <SpendingTrendChart data={spendSeries}/>
    <IncomeTrendChart data={incomeSeries}/>
    <NetCashFlowChart data={netCashFlow}/>
    <OutflowsDonut data={outflows}/>
</section>
```

`OutflowsDonut` stays last, so the existing `.chart-grid > :last-child`
full-width CSS rule continues to apply unmodified — no CSS changes needed.
The four trend/bar charts form a 2×2 block above the full-width donut.

## Out of scope

- No new backend endpoints — both new series are computed client-side from
  data already fetched by `App.tsx`.
- No changes to `DashboardChat`, `RangeSelect`, `RunningBalanceChart`,
  `SpendingTrendChart`, or `OutflowsDonut`.
- No changes to the per-month ledger section below the chart grid.
- No new CSS — both new charts reuse the existing `chart-card` styling and
  `--credit`/`--debit` color variables.

## Testing

`dashboardMetrics.ts` currently has no dedicated test file. Given this spec
adds two new exported functions with clear input/output contracts (date
filtering, sign filtering, month bucketing), the implementation plan should
add unit tests covering:

- `incomeTrendSeries`: filters out debits, sums same-day credits, respects range boundary
- `netCashFlowByMonth`: buckets by month correctly across month/year boundaries, sums credits and debits together, respects range boundary, sorts ascending
