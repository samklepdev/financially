# Dashboard Income Trend & Net Cash Flow Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new chart cards to the Financially dashboard — a daily income trend (area chart) and a monthly net cash flow (bar chart) — matching the existing chart cards' data patterns, styling, and global range selector.

**Architecture:** Two new pure functions in the existing `frontend/src/helpers/dashboardMetrics.ts` module compute chart data from the already-fetched `transactions` array; two new Recharts-based components render that data using the existing `chart-card` CSS class and `--credit`/`--debit` color variables; `App.tsx` wires both into the existing `chart-grid` section via `useMemo`, keeping the `OutflowsDonut` as the grid's last (full-width) child.

**Tech Stack:** React 19, TypeScript ~6.0.3, Vite ^8.3.6, Recharts ^3.10.1, Vitest (newly added, this plan).

## Global Constraints

- Both new data functions must accept `(transactions, range, now = new Date())` and respect the global `DashboardRange` selector (`30d` / `90d` / `1y` / `all`), same as every existing function in `dashboardMetrics.ts`.
- No new backend endpoints — everything is computed client-side from data `App.tsx` already fetches.
- No changes to `DashboardChat`, `RangeSelect`, `RunningBalanceChart`, `SpendingTrendChart`, `OutflowsDonut`, or the per-month ledger section.
- No new CSS — reuse the existing `chart-card` class and `var(--credit)` / `var(--debit)` colors.
- `OutflowsDonut` must remain the last child of `.chart-grid` so the existing `.chart-grid > :last-child { grid-column: 1 / -1 }` rule keeps applying without CSS changes.
- Chart order in the grid: Running Balance, Spending Trend, Income Trend, Net Cash Flow, Outflows Donut.

---

### Task 1: Set up Vitest and add `incomeTrendSeries`

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.ts`
- Modify: `frontend/src/helpers/dashboardMetrics.ts`
- Create: `frontend/src/helpers/dashboardMetrics.test.ts`

**Interfaces:**
- Consumes: `Transaction` type from `frontend/src/types/transaction.ts` (`{id, date, description, amount_cents, category_id, bill_id}`); `DashboardRange` type and the module-private `inRange(transactions, range, now)` helper already in `dashboardMetrics.ts`.
- Produces: `export type IncomePoint = {date: string; incomeCents: number}` and `export function incomeTrendSeries(transactions: Transaction[], range: DashboardRange, now?: Date): IncomePoint[]` — consumed by Task 3 (`IncomeTrendChart`).

The frontend currently has **no test runner** — no `test` script, no Vitest/Jest config, no `.test.ts` files anywhere in `frontend/src`. This task installs Vitest (the zero-config pairing for Vite) and proves it works by writing the first real test against it.

- [ ] **Step 1: Install Vitest as a dev dependency**

Run (from `frontend/`):
```bash
npm install -D vitest
```
Expected: `vitest` added under `devDependencies` in `frontend/package.json`.

- [ ] **Step 2: Add a `test` script to `frontend/package.json`**

In the `"scripts"` block, add:
```json
"test": "vitest run"
```
Full scripts block should now read:
```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "lint": "eslint .",
  "preview": "vite preview",
  "test": "vitest run"
}
```

- [ ] **Step 3: Wire Vitest into the existing Vite config**

Read `frontend/vite.config.ts` first — it currently is:
```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
})
```

Change the `defineConfig` import source from `'vite'` to `'vitest/config'` (this re-exports Vite's `defineConfig` with added typing for a `test` field — no other behavior changes) and add an empty `test` block:
```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: {
    environment: 'node',
  },
})
```
`environment: 'node'` is correct (not `'jsdom'`) because this task and Task 2 only test pure data functions, not React components.

- [ ] **Step 4: Write the failing test for `incomeTrendSeries`**

Create `frontend/src/helpers/dashboardMetrics.test.ts`:
```ts
import {describe, expect, test} from 'vitest';
import {incomeTrendSeries} from './dashboardMetrics.ts';
import type {Transaction} from '../types/transaction.ts';

function tx(overrides: Partial<Transaction>): Transaction {
    return {
        id: 1,
        date: '2026-11-01',
        description: 'test',
        amount_cents: 0,
        category_id: null,
        bill_id: null,
        ...overrides,
    };
}

describe('incomeTrendSeries', () => {
    test('filters out debits, keeping only credits', () => {
        const transactions = [
            tx({id: 1, date: '2026-11-01', amount_cents: 5000}),
            tx({id: 2, date: '2026-11-02', amount_cents: -2000}),
        ];
        const result = incomeTrendSeries(transactions, 'all');
        expect(result).toEqual([{date: '2026-11-01', incomeCents: 5000}]);
    });

    test('sums multiple credits on the same day', () => {
        const transactions = [
            tx({id: 1, date: '2026-11-01', amount_cents: 1000}),
            tx({id: 2, date: '2026-11-01', amount_cents: 1500}),
        ];
        const result = incomeTrendSeries(transactions, 'all');
        expect(result).toEqual([{date: '2026-11-01', incomeCents: 2500}]);
    });

    test('respects the range boundary', () => {
        const now = new Date('2026-11-11T00:00:00Z');
        const transactions = [
            tx({id: 1, date: '2026-09-01', amount_cents: 1000}), // outside 30d
            tx({id: 2, date: '2026-11-05', amount_cents: 2000}), // inside 30d
        ];
        const result = incomeTrendSeries(transactions, '30d', now);
        expect(result).toEqual([{date: '2026-11-05', incomeCents: 2000}]);
    });

    test('sorts ascending by date', () => {
        const transactions = [
            tx({id: 1, date: '2026-11-05', amount_cents: 100}),
            tx({id: 2, date: '2026-11-01', amount_cents: 200}),
        ];
        const result = incomeTrendSeries(transactions, 'all');
        expect(result).toEqual([
            {date: '2026-11-01', incomeCents: 200},
            {date: '2026-11-05', incomeCents: 100},
        ]);
    });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run (from `frontend/`):
```bash
npm run test
```
Expected: FAIL — `incomeTrendSeries` is not exported from `./dashboardMetrics.ts` (confirms Vitest itself is wired up correctly and running).

- [ ] **Step 6: Implement `incomeTrendSeries`**

Open `frontend/src/helpers/dashboardMetrics.ts`. It already has this adjacent function (for reference, do not modify it):
```ts
export type SpendPoint = {date: string; spendCents: number};

/** Sum of debits (shown positive) grouped by day within the range. */
export function spendingTrendSeries(transactions: Transaction[], range: DashboardRange, now: Date = new Date()): SpendPoint[] {
    const byDate = new Map<string, number>();
    for (const t of inRange(transactions, range, now)) {
        if (t.amount_cents < 0) {
            byDate.set(t.date, (byDate.get(t.date) ?? 0) + -t.amount_cents);
        }
    }
    return [...byDate.entries()]
        .map(([date, spendCents]) => ({date, spendCents}))
        .sort((a, b) => a.date.localeCompare(b.date));
}
```

Add this directly below it:
```ts
export type IncomePoint = {date: string; incomeCents: number};

/** Sum of credits grouped by day within the range. */
export function incomeTrendSeries(transactions: Transaction[], range: DashboardRange, now: Date = new Date()): IncomePoint[] {
    const byDate = new Map<string, number>();
    for (const t of inRange(transactions, range, now)) {
        if (t.amount_cents > 0) {
            byDate.set(t.date, (byDate.get(t.date) ?? 0) + t.amount_cents);
        }
    }
    return [...byDate.entries()]
        .map(([date, incomeCents]) => ({date, incomeCents}))
        .sort((a, b) => a.date.localeCompare(b.date));
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run (from `frontend/`):
```bash
npm run test
```
Expected: PASS — all 4 tests in `dashboardMetrics.test.ts` green.

- [ ] **Step 8: Commit**

```bash
cd frontend
git add package.json package-lock.json vite.config.ts src/helpers/dashboardMetrics.ts src/helpers/dashboardMetrics.test.ts
git commit -m "Add Vitest and incomeTrendSeries dashboard metric"
```

---

### Task 2: Add `netCashFlowByMonth`

**Files:**
- Modify: `frontend/src/helpers/dashboardMetrics.ts`
- Modify: `frontend/src/helpers/dashboardMetrics.test.ts`

**Interfaces:**
- Consumes: `monthKey(date: string): string` from `frontend/src/helpers/ledger.ts` (returns `date.slice(0, 7)`, e.g. `"2026-11"`); same `inRange`/`DashboardRange`/`Transaction` as Task 1.
- Produces: `export type NetCashFlowPoint = {month: string; label: string; netCents: number}` and `export function netCashFlowByMonth(transactions: Transaction[], range: DashboardRange, now?: Date): NetCashFlowPoint[]` — consumed by Task 4 (`NetCashFlowChart`).

**Note on `label`:** the spec called for short labels like `"Jan"`, but the existing `monthLabel()` in `ledger.ts` produces `"January 2026"` (long form, used elsewhere for the ledger's month switcher — do not change it). Reusing it here would crowd a bar chart's X-axis with up to 12 bars. This task defines its own compact formatter (`"Jan 26"` style, via `Intl.DateTimeFormat` with `{month: 'short', year: '2-digit'}`) scoped to `dashboardMetrics.ts`, instead of importing `monthLabel`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/helpers/dashboardMetrics.test.ts`:
```ts
import {netCashFlowByMonth} from './dashboardMetrics.ts';

describe('netCashFlowByMonth', () => {
    test('sums credits and debits together within a month', () => {
        const transactions = [
            tx({id: 1, date: '2026-11-01', amount_cents: 5000}),
            tx({id: 2, date: '2026-11-15', amount_cents: -2000}),
        ];
        const result = netCashFlowByMonth(transactions, 'all');
        expect(result).toEqual([{month: '2026-11', label: 'Nov 26', netCents: 3000}]);
    });

    test('buckets correctly across a year boundary', () => {
        const transactions = [
            tx({id: 1, date: '2025-12-31', amount_cents: 1000}),
            tx({id: 2, date: '2026-01-01', amount_cents: 2000}),
        ];
        const result = netCashFlowByMonth(transactions, 'all');
        expect(result).toEqual([
            {month: '2025-12', label: 'Dec 25', netCents: 1000},
            {month: '2026-01', label: 'Jan 26', netCents: 2000},
        ]);
    });

    test('respects the range boundary', () => {
        const now = new Date('2026-11-11T00:00:00Z');
        const transactions = [
            tx({id: 1, date: '2026-01-01', amount_cents: 1000}), // outside 90d
            tx({id: 2, date: '2026-10-15', amount_cents: 2000}), // inside 90d
        ];
        const result = netCashFlowByMonth(transactions, '90d', now);
        expect(result).toEqual([{month: '2026-10', label: 'Oct 26', netCents: 2000}]);
    });

    test('sorts ascending by month', () => {
        const transactions = [
            tx({id: 1, date: '2026-11-01', amount_cents: 100}),
            tx({id: 2, date: '2026-09-01', amount_cents: 200}),
        ];
        const result = netCashFlowByMonth(transactions, 'all');
        expect(result).toEqual([
            {month: '2026-09', label: 'Sep 26', netCents: 200},
            {month: '2026-11', label: 'Nov 26', netCents: 100},
        ]);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `frontend/`):
```bash
npm run test
```
Expected: FAIL — `netCashFlowByMonth` is not exported from `./dashboardMetrics.ts`.

- [ ] **Step 3: Implement `netCashFlowByMonth`**

At the top of `frontend/src/helpers/dashboardMetrics.ts`, add the import (alongside the existing `Transaction`/`Category` type imports):
```ts
import {monthKey} from "./ledger.ts";
```

Add this at the bottom of the file:
```ts
const MONTH_LABEL_SHORT = new Intl.DateTimeFormat('en-US', {month: 'short', year: '2-digit'});

export type NetCashFlowPoint = {month: string; label: string; netCents: number};

/** Net of all transactions (credits + debits), grouped by calendar month within the range. */
export function netCashFlowByMonth(transactions: Transaction[], range: DashboardRange, now: Date = new Date()): NetCashFlowPoint[] {
    const byMonth = new Map<string, number>();
    for (const t of inRange(transactions, range, now)) {
        const month = monthKey(t.date);
        byMonth.set(month, (byMonth.get(month) ?? 0) + t.amount_cents);
    }
    return [...byMonth.entries()]
        .map(([month, netCents]) => {
            const [year, m] = month.split('-').map(Number);
            return {month, label: MONTH_LABEL_SHORT.format(new Date(year, m - 1, 1)), netCents};
        })
        .sort((a, b) => a.month.localeCompare(b.month));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `frontend/`):
```bash
npm run test
```
Expected: PASS — all 8 tests in `dashboardMetrics.test.ts` green (4 from Task 1, 4 new).

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/helpers/dashboardMetrics.ts src/helpers/dashboardMetrics.test.ts
git commit -m "Add netCashFlowByMonth dashboard metric"
```

---

### Task 3: Create `IncomeTrendChart` component

**Files:**
- Create: `frontend/src/dashboard/charts/IncomeTrendChart.tsx`

**Interfaces:**
- Consumes: `IncomePoint` type from `frontend/src/helpers/dashboardMetrics.ts` (Task 1); `formatMoney` from `frontend/src/helpers/money.ts` (`(cents: number) => string`).
- Produces: default export `IncomeTrendChart` React component with `type Props = {data: IncomePoint[]}` — consumed by Task 5 (`App.tsx` wiring).

This mirrors the existing `frontend/src/dashboard/charts/SpendingTrendChart.tsx` exactly, swapping the debit styling/field for credit:
```tsx
import {Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from "recharts";
import type {SpendPoint} from "../../helpers/dashboardMetrics.ts";
import {formatMoney} from "../../helpers/money.ts";

type Props = {data: SpendPoint[]};

function SpendingTrendChart({data}: Props) {
    return (
        <article className="chart-card">
            <h3 className="chart-card__title">Spending Trend</h3>
            <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data}>
                    <XAxis dataKey="date" hide/>
                    <YAxis hide/>
                    <Tooltip
                        formatter={(value) => formatMoney(Number(value))}
                        contentStyle={{background: 'var(--ink-raised)', border: '1px solid var(--rule-on-ink)', borderRadius: 6}}
                    />
                    <Area type="monotone" dataKey="spendCents" name="Spent" stroke="var(--debit)" fill="var(--debit)" fillOpacity={0.25}/>
                </AreaChart>
            </ResponsiveContainer>
        </article>
    );
}

export default SpendingTrendChart;
```

- [ ] **Step 1: Create the component**

Create `frontend/src/dashboard/charts/IncomeTrendChart.tsx`:
```tsx
import {Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from "recharts";
import type {IncomePoint} from "../../helpers/dashboardMetrics.ts";
import {formatMoney} from "../../helpers/money.ts";

type Props = {data: IncomePoint[]};

function IncomeTrendChart({data}: Props) {
    return (
        <article className="chart-card">
            <h3 className="chart-card__title">Income Trend</h3>
            <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data}>
                    <XAxis dataKey="date" hide/>
                    <YAxis hide/>
                    <Tooltip
                        formatter={(value) => formatMoney(Number(value))}
                        contentStyle={{background: 'var(--ink-raised)', border: '1px solid var(--rule-on-ink)', borderRadius: 6}}
                    />
                    <Area type="monotone" dataKey="incomeCents" name="Income" stroke="var(--credit)" fill="var(--credit)" fillOpacity={0.25}/>
                </AreaChart>
            </ResponsiveContainer>
        </article>
    );
}

export default IncomeTrendChart;
```

- [ ] **Step 2: Type-check the project**

Run (from `frontend/`):
```bash
npx tsc -b
```
Expected: no errors. (The component isn't rendered anywhere yet, but `tsc -b` still type-checks every file in the project, including unused-but-referenced-nowhere files, since there are no unresolved imports here.)

- [ ] **Step 3: Commit**

```bash
cd frontend
git add src/dashboard/charts/IncomeTrendChart.tsx
git commit -m "Add IncomeTrendChart component"
```

---

### Task 4: Create `NetCashFlowChart` component

**Files:**
- Create: `frontend/src/dashboard/charts/NetCashFlowChart.tsx`

**Interfaces:**
- Consumes: `NetCashFlowPoint` type from `frontend/src/helpers/dashboardMetrics.ts` (Task 2, `{month, label, netCents}`); `formatMoney` from `frontend/src/helpers/money.ts`.
- Produces: default export `NetCashFlowChart` React component with `type Props = {data: NetCashFlowPoint[]}` — consumed by Task 5 (`App.tsx` wiring).

Unlike the daily trend charts, the X-axis is visible here (showing each bar's `label`), since there are at most ~12 bars and months are meaningful to label directly. Bar color is per-datum via `Cell`, the same technique `frontend/src/dashboard/charts/OutflowsDonut.tsx` already uses for category colors (for reference, do not modify it):
```tsx
import {Cell, Pie, PieChart, ResponsiveContainer} from "recharts";
// ...
<Pie data={data} dataKey="totalCents" nameKey="name" innerRadius={50} outerRadius={75} paddingAngle={data.length > 1 ? 2 : 0} stroke="none">
    {data.map((entry) => (
        <Cell key={entry.categoryId ?? 'uncategorized'} fill={entry.color}/>
    ))}
</Pie>
```

- [ ] **Step 1: Create the component**

Create `frontend/src/dashboard/charts/NetCashFlowChart.tsx`:
```tsx
import {Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis} from "recharts";
import type {NetCashFlowPoint} from "../../helpers/dashboardMetrics.ts";
import {formatMoney} from "../../helpers/money.ts";

type Props = {data: NetCashFlowPoint[]};

function NetCashFlowChart({data}: Props) {
    return (
        <article className="chart-card">
            <h3 className="chart-card__title">Net Cash Flow</h3>
            <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data}>
                    <XAxis dataKey="label" tick={{fontSize: 11}}/>
                    <YAxis hide/>
                    <Tooltip
                        formatter={(value) => formatMoney(Number(value))}
                        contentStyle={{background: 'var(--ink-raised)', border: '1px solid var(--rule-on-ink)', borderRadius: 6}}
                    />
                    <Bar dataKey="netCents" name="Net">
                        {data.map((d) => (
                            <Cell key={d.month} fill={d.netCents >= 0 ? 'var(--credit)' : 'var(--debit)'}/>
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </article>
    );
}

export default NetCashFlowChart;
```

- [ ] **Step 2: Type-check the project**

Run (from `frontend/`):
```bash
npx tsc -b
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd frontend
git add src/dashboard/charts/NetCashFlowChart.tsx
git commit -m "Add NetCashFlowChart component"
```

---

### Task 5: Wire both charts into `App.tsx`

**Files:**
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `incomeTrendSeries`, `netCashFlowByMonth` from `frontend/src/helpers/dashboardMetrics.ts` (Tasks 1–2); `IncomeTrendChart` default export (Task 3); `NetCashFlowChart` default export (Task 4).
- Produces: nothing new consumed by later tasks — this is the final integration task.

`App.tsx` currently (relevant excerpt) imports and computes the existing three series, then renders the grid:
```tsx
import RunningBalanceChart from "./dashboard/charts/RunningBalanceChart.tsx";
import SpendingTrendChart from "./dashboard/charts/SpendingTrendChart.tsx";
import OutflowsDonut from "./dashboard/charts/OutflowsDonut.tsx";
import {runningBalanceSeries, spendingTrendSeries, outflowsByCategory, type DashboardRange} from "./helpers/dashboardMetrics.ts";
// ...
const balanceSeries = useMemo(
    () => runningBalanceSeries(transactions ?? [], range),
    [transactions, range]
);
const spendSeries = useMemo(
    () => spendingTrendSeries(transactions ?? [], range),
    [transactions, range]
);
const outflows = useMemo(
    () => outflowsByCategory(transactions ?? [], categories, range),
    [transactions, categories, range]
);
// ...
<section className="chart-grid" aria-label="Financial charts">
    <RunningBalanceChart data={balanceSeries}/>
    <SpendingTrendChart data={spendSeries}/>
    <OutflowsDonut data={outflows}/>
</section>
```

- [ ] **Step 1: Add the two new imports**

In `frontend/src/App.tsx`, change this import block:
```tsx
import RunningBalanceChart from "./dashboard/charts/RunningBalanceChart.tsx";
import SpendingTrendChart from "./dashboard/charts/SpendingTrendChart.tsx";
import OutflowsDonut from "./dashboard/charts/OutflowsDonut.tsx";
import DashboardChat from "./dashboard/DashboardChat.tsx";
import {runningBalanceSeries, spendingTrendSeries, outflowsByCategory, type DashboardRange} from "./helpers/dashboardMetrics.ts";
```
to:
```tsx
import RunningBalanceChart from "./dashboard/charts/RunningBalanceChart.tsx";
import SpendingTrendChart from "./dashboard/charts/SpendingTrendChart.tsx";
import IncomeTrendChart from "./dashboard/charts/IncomeTrendChart.tsx";
import NetCashFlowChart from "./dashboard/charts/NetCashFlowChart.tsx";
import OutflowsDonut from "./dashboard/charts/OutflowsDonut.tsx";
import DashboardChat from "./dashboard/DashboardChat.tsx";
import {
    runningBalanceSeries,
    spendingTrendSeries,
    incomeTrendSeries,
    netCashFlowByMonth,
    outflowsByCategory,
    type DashboardRange,
} from "./helpers/dashboardMetrics.ts";
```

- [ ] **Step 2: Add the two new `useMemo`s**

Change this block:
```tsx
    const spendSeries = useMemo(
        () => spendingTrendSeries(transactions ?? [], range),
        [transactions, range]
    );
    const outflows = useMemo(
        () => outflowsByCategory(transactions ?? [], categories, range),
        [transactions, categories, range]
    );
```
to:
```tsx
    const spendSeries = useMemo(
        () => spendingTrendSeries(transactions ?? [], range),
        [transactions, range]
    );
    const incomeSeries = useMemo(
        () => incomeTrendSeries(transactions ?? [], range),
        [transactions, range]
    );
    const netCashFlow = useMemo(
        () => netCashFlowByMonth(transactions ?? [], range),
        [transactions, range]
    );
    const outflows = useMemo(
        () => outflowsByCategory(transactions ?? [], categories, range),
        [transactions, categories, range]
    );
```

- [ ] **Step 3: Render the two new charts in the grid**

Change:
```tsx
                <section className="chart-grid" aria-label="Financial charts">
                    <RunningBalanceChart data={balanceSeries}/>
                    <SpendingTrendChart data={spendSeries}/>
                    <OutflowsDonut data={outflows}/>
                </section>
```
to:
```tsx
                <section className="chart-grid" aria-label="Financial charts">
                    <RunningBalanceChart data={balanceSeries}/>
                    <SpendingTrendChart data={spendSeries}/>
                    <IncomeTrendChart data={incomeSeries}/>
                    <NetCashFlowChart data={netCashFlow}/>
                    <OutflowsDonut data={outflows}/>
                </section>
```

- [ ] **Step 4: Type-check the project**

Run (from `frontend/`):
```bash
npx tsc -b
```
Expected: no errors.

- [ ] **Step 5: Manually verify in the browser**

Run (from the repo root):
```bash
npm run dev
```
Open the app (default Vite dev URL, typically `http://localhost:5173`), log in, and on the dashboard confirm:
- Five chart cards render in order: Running Balance, Spending Trend, Income Trend, Net Cash Flow, Outflows (Outflows still spans full width on its own row).
- Income Trend shows a green-ish filled area matching existing credit styling, with a tooltip on hover showing formatted dollar amounts.
- Net Cash Flow shows one bar per month with visible month labels (e.g. "Nov 26") on the X-axis, green bars for positive months and red/debit-colored bars for negative months.
- Switching the range selector (30d/90d/1y/all) updates both new charts along with the existing three.

Stop the dev server (`Ctrl+C`) once confirmed.

- [ ] **Step 6: Commit**

```bash
cd frontend
git add src/App.tsx
git commit -m "Wire income trend and net cash flow charts into dashboard"
```
