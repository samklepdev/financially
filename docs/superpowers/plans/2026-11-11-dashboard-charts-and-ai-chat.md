# Dashboard Charts and AI Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Running Balance chart, a Spending Trend chart, an Outflows donut + category breakdown, a 30D/90D/1Y/All range selector, and a collapsible AI chat sidebar (backed by the local Ollama model) to the existing `/dashboard` page, without changing its existing visual theme.

**Architecture:** Three charts are computed entirely client-side from data the dashboard already fetches (transactions + categories) via new pure helper functions — no new aggregation endpoints. The AI chat is a new backend vertical slice (`types/`, `services/`, `controllers/`, `routes/`) mirroring the existing `categories` slice, calling the already-used local Ollama model (`gemma4:e4b`) grounded in a computed financial summary, exposed as `POST /api/v1/dashboard/chat`.

**Tech Stack:** Backend: Express 5, `node:sqlite`, `node --test`. Frontend: React 19, Vite, Axios, new dependency `recharts` for charting.

## Global Constraints

- No visual theme changes — all new CSS reuses existing custom properties (`--ink`, `--ink-raised`, `--paper`, `--text-on-ink`, `--text-on-ink-strong`, `--text-on-paper`, `--rule-on-ink`, `--credit`, `--debit`, `--due`, `--display`, `--sans`, `--mono`) defined in `frontend/src/index.css`.
- "Running Balance" is the label used everywhere (not "Net Worth") — cumulative sum of `amount_cents`, no asset/liability model exists.
- Amounts are in cents throughout the backend and helpers, consistent with the rest of the schema; only formatted to dollars at render/prompt time via `formatMoney` (frontend) or inline `/100` formatting (backend prompt).
- The Ollama model is `gemma4:e4b` at `http://localhost:11434`, `think: false`, called via `/api/chat` with `stream: false` — matching `backend/src/services/ollamaCategorySuggester.service.ts`.
- Chat failures throw (not silently resolve to empty), unlike the import-suggestion precedent, because this is a direct user action — the controller converts a thrown error into a 502 with a plain-language message.
- All new routes sit behind `requireAuth`, matching every other `/api/v1/*` router in `app.ts`.
- Frontend has no test framework — verification is `npx tsc -b --noEmit` plus manual checks in the running app, per existing project convention. Backend verification is `node --test`.
- TypeScript strict mode with `verbatimModuleSyntax: true` and `noUnusedLocals`/`noUnusedParameters: true` (frontend) — type-only imports must use `import type` (or an inline `type` specifier), and no unused imports/locals/parameters.

---

### Task 1: Backend — financial summary + chat prompt (pure functions, TDD)

**Files:**
- Create: `backend/src/types/dashboardChat.ts`
- Create: `backend/src/services/dashboardChat.service.ts`
- Test: `backend/src/services/dashboardChat.service.test.ts`

**Interfaces:**
- Consumes: `Transaction` from `backend/src/types/transaction.ts`, `Category` from `backend/src/types/category.ts`.
- Produces: `ChatRole`, `ChatMessage`, `DashboardRange`, `ChatRequestBody`, `CategorySpend`, `FinancialSummary` types; `rangeStartDate(range, now?)`, `computeFinancialSummary(transactions, categories, range, now?)`, `buildChatPrompt(messages, summary)` functions — all consumed by Task 2.

- [ ] **Step 1: Create the shared types**

```ts
// backend/src/types/dashboardChat.ts
export type ChatRole = 'system' | 'user' | 'assistant';

export type ChatMessage = {
    role: ChatRole;
    content: string;
};

export type DashboardRange = '30d' | '90d' | '1y' | 'all';

export type ChatRequestBody = {
    messages: ChatMessage[];
    range: DashboardRange;
};

export type CategorySpend = {
    name: string;
    totalCents: number;
};

export type FinancialSummary = {
    totalInCents: number;
    totalOutCents: number;
    netCents: number;
    topCategories: CategorySpend[];
};
```

- [ ] **Step 2: Write the failing tests**

```ts
// backend/src/services/dashboardChat.service.test.ts
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {computeFinancialSummary, buildChatPrompt, rangeStartDate} from './dashboardChat.service.ts';
import type {Transaction} from '../types/transaction.ts';
import type {Category} from '../types/category.ts';
import type {ChatMessage, FinancialSummary} from '../types/dashboardChat.ts';

const NOW = new Date('2026-11-11T00:00:00.000Z');

function tx(overrides: Partial<Transaction> & {id: number}): Transaction {
    return {
        date: '2026-11-01',
        description: 'Test',
        amount_cents: 0,
        category_id: null,
        bill_id: null,
        ...overrides,
    };
}

test('rangeStartDate returns null for "all"', () => {
    assert.equal(rangeStartDate('all', NOW), null);
});

test('rangeStartDate returns a date 90 days before now for "90d"', () => {
    assert.equal(rangeStartDate('90d', NOW), '2026-08-13');
});

test('computeFinancialSummary excludes transactions outside the range', () => {
    const transactions: Transaction[] = [
        tx({id: 1, date: '2026-11-01', amount_cents: 10000}),
        tx({id: 2, date: '2026-01-01', amount_cents: 50000}),
    ];
    const summary = computeFinancialSummary(transactions, [], '30d', NOW);
    assert.equal(summary.totalInCents, 10000);
});

test('computeFinancialSummary sums income and spend and computes net', () => {
    const categories: Category[] = [{id: 1, name: 'Groceries', color: '#000000'}];
    const transactions: Transaction[] = [
        tx({id: 1, date: '2026-11-01', amount_cents: 500000}),
        tx({id: 2, date: '2026-11-02', amount_cents: -20000, category_id: 1}),
        tx({id: 3, date: '2026-11-03', amount_cents: -5000}),
    ];
    const summary = computeFinancialSummary(transactions, categories, '90d', NOW);
    assert.equal(summary.totalInCents, 500000);
    assert.equal(summary.totalOutCents, 25000);
    assert.equal(summary.netCents, 475000);
});

test('computeFinancialSummary buckets uncategorized spend as "Uncategorized"', () => {
    const transactions: Transaction[] = [
        tx({id: 1, date: '2026-11-01', amount_cents: -1000, category_id: null}),
    ];
    const summary = computeFinancialSummary(transactions, [], '90d', NOW);
    assert.deepEqual(summary.topCategories, [{name: 'Uncategorized', totalCents: 1000}]);
});

test('computeFinancialSummary returns only the top 5 categories by spend, descending', () => {
    const categories: Category[] = Array.from({length: 6}, (_, i) => ({id: i + 1, name: `Cat${i + 1}`, color: '#000000'}));
    const transactions: Transaction[] = categories.map((c, i) =>
        tx({id: i + 1, date: '2026-11-01', amount_cents: -(i + 1) * 1000, category_id: c.id})
    );
    const summary = computeFinancialSummary(transactions, categories, '90d', NOW);
    assert.equal(summary.topCategories.length, 5);
    assert.equal(summary.topCategories[0].name, 'Cat6');
    assert.equal(summary.topCategories[0].totalCents, 6000);
});

test('buildChatPrompt puts a system message with the summary figures first', () => {
    const summary: FinancialSummary = {
        totalInCents: 100000, totalOutCents: 40000, netCents: 60000,
        topCategories: [{name: 'Housing', totalCents: 20000}],
    };
    const history: ChatMessage[] = [{role: 'user', content: 'How much did we save?'}];
    const result = buildChatPrompt(history, summary);
    assert.equal(result[0].role, 'system');
    assert.match(result[0].content, /\$1000\.00/);
    assert.match(result[0].content, /Housing/);
});

test("buildChatPrompt passes through the caller's messages unchanged and in order", () => {
    const summary: FinancialSummary = {totalInCents: 0, totalOutCents: 0, netCents: 0, topCategories: []};
    const history: ChatMessage[] = [
        {role: 'user', content: 'First'},
        {role: 'assistant', content: 'Second'},
        {role: 'user', content: 'Third'},
    ];
    const result = buildChatPrompt(history, summary);
    assert.deepEqual(result.slice(1), history);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run (from `backend/`): `node --test src/services/dashboardChat.service.test.ts`
Expected: FAIL — `dashboardChat.service.ts` does not exist yet.

- [ ] **Step 4: Implement the pure functions**

```ts
// backend/src/services/dashboardChat.service.ts
import type {Category} from "../types/category.ts";
import type {Transaction} from "../types/transaction.ts";
import type {ChatMessage, DashboardRange, FinancialSummary} from "../types/dashboardChat.ts";

const RANGE_DAYS: Record<Exclude<DashboardRange, 'all'>, number> = {
    '30d': 30,
    '90d': 90,
    '1y': 365,
};

/**
 * Returns the ISO date (YYYY-MM-DD) that a range starts at, or null for
 * 'all' (no lower bound).
 */
export function rangeStartDate(range: DashboardRange, now: Date = new Date()): string | null {
    if (range === 'all') {
        return null;
    }
    const start = new Date(now);
    start.setDate(start.getDate() - RANGE_DAYS[range]);
    return start.toISOString().slice(0, 10);
}

/**
 * Totals income, spend, and the top 5 spending categories within a range,
 * for grounding the AI assistant's answers in real figures.
 */
export function computeFinancialSummary(
    transactions: Transaction[],
    categories: Category[],
    range: DashboardRange,
    now: Date = new Date()
): FinancialSummary {
    const start = rangeStartDate(range, now);
    const inRange = start === null ? transactions : transactions.filter((t) => t.date >= start);

    let totalInCents = 0;
    let totalOutCents = 0;
    const spendByCategory = new Map<string, number>();

    for (const t of inRange) {
        if (t.amount_cents > 0) {
            totalInCents += t.amount_cents;
        } else if (t.amount_cents < 0) {
            const spend = -t.amount_cents;
            totalOutCents += spend;
            const name = t.category_id === null
                ? 'Uncategorized'
                : categories.find((c) => c.id === t.category_id)?.name ?? 'Uncategorized';
            spendByCategory.set(name, (spendByCategory.get(name) ?? 0) + spend);
        }
    }

    const topCategories = [...spendByCategory.entries()]
        .map(([name, totalCents]) => ({name, totalCents}))
        .sort((a, b) => b.totalCents - a.totalCents)
        .slice(0, 5);

    return {
        totalInCents,
        totalOutCents,
        netCents: totalInCents - totalOutCents,
        topCategories,
    };
}

function formatDollars(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Prepends a system message describing the assistant's role and the
 * computed financial summary, then appends the caller's conversation
 * history unchanged.
 */
export function buildChatPrompt(messages: ChatMessage[], summary: FinancialSummary): ChatMessage[] {
    const lines = [
        'You are a budgeting assistant inside a personal finance app.',
        'Answer only using the figures below, in dollars, concisely.',
        `Total money in: ${formatDollars(summary.totalInCents)}`,
        `Total money out: ${formatDollars(summary.totalOutCents)}`,
        `Net: ${formatDollars(summary.netCents)}`,
        summary.topCategories.length > 0
            ? `Biggest spending categories: ${summary.topCategories.map((c) => `${c.name} ${formatDollars(c.totalCents)}`).join(', ')}`
            : 'No categorized spending in this range.',
    ];

    return [
        {role: 'system', content: lines.join('\n')},
        ...messages,
    ];
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `backend/`): `node --test src/services/dashboardChat.service.test.ts`
Expected: PASS, all 8 tests green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/types/dashboardChat.ts backend/src/services/dashboardChat.service.ts backend/src/services/dashboardChat.service.test.ts
git commit -m "Add financial summary and chat prompt builder for dashboard assistant"
```

---

### Task 2: Backend — Ollama call, controller, router, and auth wiring

**Files:**
- Modify: `backend/src/services/dashboardChat.service.ts` (append `askDashboardAssistant`)
- Create: `backend/src/controllers/dashboardChat.controller.ts`
- Create: `backend/src/routes/dashboardChat.router.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/src/routes/dashboardChat.test.ts`

**Interfaces:**
- Consumes: `computeFinancialSummary`, `buildChatPrompt` from Task 1; `TransactionService` (`backend/src/services/transactions.service.ts`, `getAllTransactions()`); `CategoryService` (`backend/src/services/categories.service.ts`, `getAllCategories()`); `listen` from `backend/src/testHelpers/httpServer.ts`; `hashPassword` from `backend/src/helpers/password.ts`.
- Produces: `askDashboardAssistant(messages, range, now?): Promise<string>` (throws on any failure); `postChatMessage(req, res)` Express handler; `dashboardChatRouter` mounted at `/api/v1/dashboard` so the endpoint is `POST /api/v1/dashboard/chat`.

- [ ] **Step 1: Append the Ollama call to the service**

```ts
// backend/src/services/dashboardChat.service.ts — add below the existing imports
import {TransactionService} from "./transactions.service.ts";
import {CategoryService} from "./categories.service.ts";

const OLLAMA_URL = 'http://localhost:11434';
const OLLAMA_MODEL = 'gemma4:e4b';
const TIMEOUT_MS = 60_000;

const transactionService = new TransactionService();
const categoryService = new CategoryService();

// ... (append at the end of the file, after buildChatPrompt)

/**
 * Asks the local Ollama model a finance question grounded in the user's
 * actual transactions for the given range. Unlike the import-suggestion
 * fallback, this throws on any failure (connection refused, timeout, bad
 * response) rather than resolving silently — the caller is a direct user
 * action and needs to know the assistant didn't answer.
 */
export async function askDashboardAssistant(
    messages: ChatMessage[],
    range: DashboardRange,
    now: Date = new Date()
): Promise<string> {
    const transactions = transactionService.getAllTransactions();
    const categories = categoryService.getAllCategories();
    const summary = computeFinancialSummary(transactions, categories, range, now);
    const prompt = buildChatPrompt(messages, summary);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const response = await fetch(`${OLLAMA_URL}/api/chat`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                model: OLLAMA_MODEL,
                stream: false,
                think: false,
                messages: prompt,
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`Ollama responded with status ${response.status}`);
        }

        const body = await response.json() as {message?: {content?: string}};
        if (!body.message?.content) {
            throw new Error('Ollama returned an empty response');
        }

        return body.message.content;
    } finally {
        clearTimeout(timeout);
    }
}
```

- [ ] **Step 2: Create the controller**

```ts
// backend/src/controllers/dashboardChat.controller.ts
import type {Request, Response} from 'express';
import {askDashboardAssistant} from "../services/dashboardChat.service.ts";
import type {ChatMessage, DashboardRange} from "../types/dashboardChat.ts";

const VALID_RANGES: DashboardRange[] = ['30d', '90d', '1y', 'all'];

function isValidMessages(value: unknown): value is ChatMessage[] {
    return Array.isArray(value) && value.length > 0 && value.every((m) =>
        typeof m === 'object' && m !== null &&
        ((m as Record<string, unknown>).role === 'user' || (m as Record<string, unknown>).role === 'assistant') &&
        typeof (m as Record<string, unknown>).content === 'string' &&
        (m as Record<string, unknown>).content !== ''
    );
}

/**
 * Validates the chat request body, asks the local Ollama model for a
 * reply grounded in the user's transactions for the given range, and
 * returns it. Responds 502 with a plain-language error if Ollama can't
 * be reached.
 */
export async function postChatMessage(req: Request, res: Response) {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const {messages, range} = body;

    if (!isValidMessages(messages)) {
        return res.status(400).json({error: 'messages must be a non-empty array of {role, content}'});
    }

    if (typeof range !== 'string' || !VALID_RANGES.includes(range as DashboardRange)) {
        return res.status(400).json({error: `range must be one of ${VALID_RANGES.join(', ')}`});
    }

    try {
        const reply = await askDashboardAssistant(messages, range as DashboardRange);
        return res.status(200).json({data: {reply}});
    } catch {
        return res.status(502).json({error: "Can't reach the local AI model. Make sure Ollama is running."});
    }
}
```

- [ ] **Step 3: Create the router**

```ts
// backend/src/routes/dashboardChat.router.ts
import express from "express";
import {postChatMessage} from "../controllers/dashboardChat.controller.ts";

export const dashboardChatRouter = express.Router();

dashboardChatRouter.post('/chat', postChatMessage);
```

- [ ] **Step 4: Wire the router into the app**

In `backend/src/app.ts`, add the import alongside the other router imports:

```ts
import {dashboardChatRouter} from './routes/dashboardChat.router.ts'
```

And add the route registration alongside the other `app.use('/api/v1/...', requireAuth, ...)` lines:

```ts
app.use('/api/v1/dashboard', requireAuth, dashboardChatRouter)
```

- [ ] **Step 5: Write the integration test**

```ts
// backend/src/routes/dashboardChat.test.ts
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword} from '../helpers/password.ts';
import {listen} from '../testHelpers/httpServer.ts';

process.env.DATABASE_FILE = ':memory:';
process.env.APP_PASSWORD_HASH = hashPassword('test-password');

const {default: app} = await import('../app.ts');

async function loginCookie(url: string): Promise<string> {
    const res = await fetch(`${url}/api/v1/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({password: 'test-password'}),
    });
    return res.headers.get('set-cookie')!.split(';')[0];
}

test('the chat endpoint requires authentication', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/dashboard/chat`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({messages: [{role: 'user', content: 'hi'}], range: '90d'}),
        });
        assert.equal(res.status, 401);
    } finally {
        await close();
    }
});

test('rejects an empty messages array', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);
        const res = await fetch(`${url}/api/v1/dashboard/chat`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({messages: [], range: '90d'}),
        });
        assert.equal(res.status, 400);
    } finally {
        await close();
    }
});

test('rejects an invalid range', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);
        const res = await fetch(`${url}/api/v1/dashboard/chat`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({messages: [{role: 'user', content: 'hi'}], range: 'bogus'}),
        });
        assert.equal(res.status, 400);
    } finally {
        await close();
    }
});

test('returns 502 with a plain-language error when Ollama is unreachable', async () => {
    const {url, close} = await listen(app);
    const originalFetch = globalThis.fetch;
    // Simulate Ollama being down regardless of whether it's actually running
    // on this machine, by rejecting only requests aimed at its port.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof input === 'string' ? input : input.toString();
        if (target.includes('11434')) {
            throw new Error('simulated connection refused');
        }
        return originalFetch(input, init);
    }) as typeof fetch;

    try {
        const cookie = await loginCookie(url);
        const res = await fetch(`${url}/api/v1/dashboard/chat`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({messages: [{role: 'user', content: 'How much did we save?'}], range: '90d'}),
        });
        assert.equal(res.status, 502);
        const body = await res.json() as {error: string};
        assert.match(body.error, /Ollama/);
    } finally {
        globalThis.fetch = originalFetch;
        await close();
    }
});
```

This last test stubs `globalThis.fetch` for requests aimed at Ollama's port (11434) only, so it deterministically exercises the 502 path on any machine — including ones (like this project's own dev machines) where Ollama is normally running locally.

- [ ] **Step 6: Run the tests to verify they pass**

Run (from `backend/`): `node --test src/routes/dashboardChat.test.ts`
Expected: PASS, all 4 tests green, regardless of whether Ollama is running locally.

- [ ] **Step 7: Run the full backend test suite**

Run (from `backend/`): `node --test`
Expected: PASS, no regressions in existing tests.

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/dashboardChat.service.ts backend/src/controllers/dashboardChat.controller.ts backend/src/routes/dashboardChat.router.ts backend/src/routes/dashboardChat.test.ts backend/src/app.ts
git commit -m "Add POST /api/v1/dashboard/chat endpoint backed by local Ollama"
```

---

### Task 3: Frontend — add recharts, write chart data helpers

**Files:**
- Modify: `frontend/package.json` (add `recharts` dependency)
- Create: `frontend/src/helpers/dashboardMetrics.ts`

**Interfaces:**
- Consumes: `Transaction` from `frontend/src/types/transaction.ts`, `Category` from `frontend/src/types/category.ts`.
- Produces: `DashboardRange` type; `rangeStartDate`, `runningBalanceSeries`, `spendingTrendSeries`, `outflowsByCategory` functions, and `BalancePoint`, `SpendPoint`, `CategoryOutflow` types — all consumed by Task 4 and Task 5.

- [ ] **Step 1: Install recharts**

Run (from `frontend/`): `npm install recharts`
Expected: `recharts` added to `frontend/package.json` dependencies and `package-lock.json` updated.

- [ ] **Step 2: Write the helpers**

```ts
// frontend/src/helpers/dashboardMetrics.ts
import type {Transaction} from "../types/transaction.ts";
import type {Category} from "../types/category.ts";

export type DashboardRange = '30d' | '90d' | '1y' | 'all';

const RANGE_DAYS: Record<Exclude<DashboardRange, 'all'>, number> = {
    '30d': 30,
    '90d': 90,
    '1y': 365,
};

/**
 * Returns the ISO date (YYYY-MM-DD) that a range starts at, or null for
 * 'all' (no lower bound).
 */
export function rangeStartDate(range: DashboardRange, now: Date = new Date()): string | null {
    if (range === 'all') {
        return null;
    }
    const start = new Date(now);
    start.setDate(start.getDate() - RANGE_DAYS[range]);
    return start.toISOString().slice(0, 10);
}

function inRange(transactions: Transaction[], range: DashboardRange, now: Date): Transaction[] {
    const start = rangeStartDate(range, now);
    return start === null ? transactions : transactions.filter((t) => t.date >= start);
}

export type BalancePoint = {date: string; balanceCents: number};

/**
 * Cumulative sum of amount_cents ordered by date within the range — a
 * running balance, not true net worth (no asset/liability model exists).
 */
export function runningBalanceSeries(transactions: Transaction[], range: DashboardRange, now: Date = new Date()): BalancePoint[] {
    const sorted = [...inRange(transactions, range, now)].sort((a, b) => a.date.localeCompare(b.date));
    const points: BalancePoint[] = [];
    let runningTotal = 0;
    for (const t of sorted) {
        runningTotal += t.amount_cents;
        const last = points[points.length - 1];
        if (last && last.date === t.date) {
            last.balanceCents = runningTotal;
        } else {
            points.push({date: t.date, balanceCents: runningTotal});
        }
    }
    return points;
}

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

export type CategoryOutflow = {categoryId: number | null; name: string; color: string; totalCents: number; weight: number};

/**
 * Sum of debits grouped by category within the range, joined to each
 * category's name/color, sorted descending by total, with a weight
 * (fraction of total outflows). Uncategorized debits group under a
 * synthetic "Uncategorized" entry.
 */
export function outflowsByCategory(transactions: Transaction[], categories: Category[], range: DashboardRange, now: Date = new Date()): CategoryOutflow[] {
    const byCategory = new Map<number | null, number>();
    for (const t of inRange(transactions, range, now)) {
        if (t.amount_cents < 0) {
            byCategory.set(t.category_id, (byCategory.get(t.category_id) ?? 0) + -t.amount_cents);
        }
    }

    const total = [...byCategory.values()].reduce((sum, v) => sum + v, 0);

    return [...byCategory.entries()]
        .map(([categoryId, totalCents]) => {
            const category = categoryId === null ? undefined : categories.find((c) => c.id === categoryId);
            return {
                categoryId,
                name: category?.name ?? 'Uncategorized',
                color: category?.color ?? '#6f6552',
                totalCents,
                weight: total === 0 ? 0 : totalCents / total,
            };
        })
        .sort((a, b) => b.totalCents - a.totalCents);
}
```

- [ ] **Step 3: Verify it compiles clean**

Run (from `frontend/`): `npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/helpers/dashboardMetrics.ts
git commit -m "Add recharts dependency and dashboard chart data helpers"
```

---

### Task 4: Frontend — range selector and chart components

**Files:**
- Create: `frontend/src/dashboard/dashboard.css`
- Create: `frontend/src/dashboard/RangeSelect.tsx`
- Create: `frontend/src/dashboard/charts/RunningBalanceChart.tsx`
- Create: `frontend/src/dashboard/charts/SpendingTrendChart.tsx`
- Create: `frontend/src/dashboard/charts/OutflowsDonut.tsx`

**Interfaces:**
- Consumes: `BalancePoint`, `SpendPoint`, `CategoryOutflow`, `DashboardRange` from Task 3's `frontend/src/helpers/dashboardMetrics.ts`; `formatMoney` from `frontend/src/helpers/money.ts`.
- Produces: `RangeSelect` (props `{value: DashboardRange, onChange: (r: DashboardRange) => void}`), `RunningBalanceChart` (props `{data: BalancePoint[]}`), `SpendingTrendChart` (props `{data: SpendPoint[]}`), `OutflowsDonut` (props `{data: CategoryOutflow[]}`) — default exports, all consumed by Task 5.

- [ ] **Step 1: Create the dashboard stylesheet**

```css
/* frontend/src/dashboard/dashboard.css */
.range-select {
  display: inline-flex;
  gap: 1px;
  background: var(--rule-on-ink);
  border: 1px solid var(--rule-on-ink);
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 1.5rem;
}

.range-select__option {
  background: var(--ink-raised);
  color: var(--text-on-ink);
  border: none;
  font-family: var(--mono);
  font-size: 0.75rem;
  letter-spacing: 0.05em;
  padding: 0.4rem 0.9rem;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.range-select__option:hover {
  background: color-mix(in srgb, var(--ink-raised) 80%, var(--text-on-ink-strong));
}

.range-select__option.active {
  color: var(--text-on-ink-strong);
  background: color-mix(in srgb, var(--ink-raised) 60%, var(--due));
}

.range-select__option:focus-visible {
  outline: 2px solid var(--due);
  outline-offset: -2px;
}

.chart-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
  margin-bottom: 2rem;
}

.chart-grid > :last-child {
  grid-column: 1 / -1;
}

.chart-card {
  background: var(--ink-raised);
  border: 1px solid var(--rule-on-ink);
  border-radius: 6px;
  padding: 1.1rem 1.25rem;
}

.chart-card__title {
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-on-ink);
  margin-bottom: 0.75rem;
}

.chart-card--donut {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.outflows-donut {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.outflows-total {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
}

.outflows-total__label {
  font-family: var(--mono);
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-on-ink);
}

.outflows-total__value {
  font-family: var(--display);
  font-size: 1.1rem;
  color: var(--text-on-ink-strong);
  font-variant-numeric: tabular-nums oldstyle-nums;
}

.outflows-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--sans);
  font-size: 0.85rem;
}

.outflows-table th {
  text-align: left;
  font-family: var(--mono);
  font-size: 0.65rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-on-ink);
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid var(--rule-on-ink);
}

.outflows-table td {
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid var(--rule-on-ink);
  color: var(--text-on-ink-strong);
}

.outflows-table td:not(:first-child) {
  text-align: right;
  font-variant-numeric: tabular-nums oldstyle-nums;
}

.outflows-swatch {
  display: inline-block;
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 50%;
  margin-right: 0.5rem;
}

@media (max-width: 900px) {
  .chart-grid {
    grid-template-columns: 1fr;
  }

  .chart-grid > :last-child {
    grid-column: auto;
  }
}
```

- [ ] **Step 2: Create RangeSelect**

```tsx
// frontend/src/dashboard/RangeSelect.tsx
import type {DashboardRange} from "../helpers/dashboardMetrics.ts";
import './dashboard.css';

const RANGES: {value: DashboardRange; label: string}[] = [
    {value: '30d', label: '30D'},
    {value: '90d', label: '90D'},
    {value: '1y', label: '1Y'},
    {value: 'all', label: 'All'},
];

type Props = {
    value: DashboardRange;
    onChange: (range: DashboardRange) => void;
};

function RangeSelect({value, onChange}: Props) {
    return (
        <div className="range-select" role="group" aria-label="Chart time range">
            {RANGES.map((r) => (
                <button
                    key={r.value}
                    type="button"
                    className={r.value === value ? 'range-select__option active' : 'range-select__option'}
                    onClick={() => onChange(r.value)}
                    aria-pressed={r.value === value}
                >
                    {r.label}
                </button>
            ))}
        </div>
    );
}

export default RangeSelect;
```

- [ ] **Step 3: Create RunningBalanceChart**

```tsx
// frontend/src/dashboard/charts/RunningBalanceChart.tsx
import {Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from "recharts";
import type {BalancePoint} from "../../helpers/dashboardMetrics.ts";
import {formatMoney} from "../../helpers/money.ts";

type Props = {data: BalancePoint[]};

function RunningBalanceChart({data}: Props) {
    return (
        <article className="chart-card">
            <h3 className="chart-card__title">Running Balance</h3>
            <ResponsiveContainer width="100%" height={220}>
                <LineChart data={data}>
                    <XAxis dataKey="date" hide/>
                    <YAxis hide domain={['auto', 'auto']}/>
                    <Tooltip
                        formatter={(value: number) => formatMoney(value)}
                        contentStyle={{background: 'var(--ink-raised)', border: '1px solid var(--rule-on-ink)', borderRadius: 6}}
                    />
                    <Line type="monotone" dataKey="balanceCents" stroke="var(--credit)" strokeWidth={2} dot={false}/>
                </LineChart>
            </ResponsiveContainer>
        </article>
    );
}

export default RunningBalanceChart;
```

- [ ] **Step 4: Create SpendingTrendChart**

```tsx
// frontend/src/dashboard/charts/SpendingTrendChart.tsx
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
                        formatter={(value: number) => formatMoney(value)}
                        contentStyle={{background: 'var(--ink-raised)', border: '1px solid var(--rule-on-ink)', borderRadius: 6}}
                    />
                    <Area type="monotone" dataKey="spendCents" stroke="var(--debit)" fill="var(--debit)" fillOpacity={0.25}/>
                </AreaChart>
            </ResponsiveContainer>
        </article>
    );
}

export default SpendingTrendChart;
```

- [ ] **Step 5: Create OutflowsDonut**

```tsx
// frontend/src/dashboard/charts/OutflowsDonut.tsx
import {Cell, Pie, PieChart, ResponsiveContainer} from "recharts";
import type {CategoryOutflow} from "../../helpers/dashboardMetrics.ts";
import {formatMoney} from "../../helpers/money.ts";

type Props = {data: CategoryOutflow[]};

function OutflowsDonut({data}: Props) {
    const total = data.reduce((sum, c) => sum + c.totalCents, 0);

    return (
        <article className="chart-card chart-card--donut">
            <h3 className="chart-card__title">Outflows</h3>
            <div className="outflows-donut">
                <ResponsiveContainer width={160} height={160}>
                    <PieChart>
                        <Pie
                            data={data}
                            dataKey="totalCents"
                            nameKey="name"
                            innerRadius={50}
                            outerRadius={75}
                            paddingAngle={data.length > 1 ? 2 : 0}
                            stroke="none"
                        >
                            {data.map((entry) => (
                                <Cell key={entry.categoryId ?? 'uncategorized'} fill={entry.color}/>
                            ))}
                        </Pie>
                    </PieChart>
                </ResponsiveContainer>
                <div className="outflows-total">
                    <span className="outflows-total__label">Total</span>
                    <span className="outflows-total__value">{formatMoney(total)}</span>
                </div>
            </div>
            <table className="outflows-table">
                <thead>
                    <tr>
                        <th>Category</th>
                        <th>Value</th>
                        <th>Weight</th>
                    </tr>
                </thead>
                <tbody>
                    {data.map((c) => (
                        <tr key={c.categoryId ?? 'uncategorized'}>
                            <td>
                                <span className="outflows-swatch" style={{background: c.color}}/>
                                {c.name}
                            </td>
                            <td>{formatMoney(c.totalCents)}</td>
                            <td>{(c.weight * 100).toFixed(1)}%</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </article>
    );
}

export default OutflowsDonut;
```

- [ ] **Step 6: Verify it compiles clean**

Run (from `frontend/`): `npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/dashboard
git commit -m "Add dashboard range selector and chart components"
```

---

### Task 5: Frontend — wire the range selector and chart grid into the dashboard

**Files:**
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `RangeSelect`, `RunningBalanceChart`, `SpendingTrendChart`, `OutflowsDonut` from Task 4; `runningBalanceSeries`, `spendingTrendSeries`, `outflowsByCategory`, `DashboardRange` from Task 3.
- Produces: `App.tsx` now has `range`/`setRange` state and computed `balanceSeries`/`spendSeries`/`outflows`, consumed by Task 7 (no new exports — this is the page component itself).

- [ ] **Step 1: Add the new imports**

In `frontend/src/App.tsx`, add alongside the existing imports:

```tsx
import RangeSelect from "./dashboard/RangeSelect.tsx";
import RunningBalanceChart from "./dashboard/charts/RunningBalanceChart.tsx";
import SpendingTrendChart from "./dashboard/charts/SpendingTrendChart.tsx";
import OutflowsDonut from "./dashboard/charts/OutflowsDonut.tsx";
import {runningBalanceSeries, spendingTrendSeries, outflowsByCategory, type DashboardRange} from "./helpers/dashboardMetrics.ts";
```

- [ ] **Step 2: Add range state and computed series**

Inside `function App()`, after the existing `const [month, setMonth] = useState<string>(...)` line, add:

```tsx
const [range, setRange] = useState<DashboardRange>('90d');

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
```

- [ ] **Step 3: Render the range selector and chart grid**

In the `return (...)` block, immediately inside the top-level `<>` fragment, before the existing `<div className="month-switch">`, add:

```tsx
<RangeSelect value={range} onChange={setRange}/>
<section className="chart-grid" aria-label="Financial charts">
    <RunningBalanceChart data={balanceSeries}/>
    <SpendingTrendChart data={spendSeries}/>
    <OutflowsDonut data={outflows}/>
</section>
```

- [ ] **Step 4: Verify it compiles clean**

Run (from `frontend/`): `npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 5: Manually verify in the running app**

Run (from `frontend/`): `npm run dev` (and the backend separately per its own dev script), open `/dashboard` in a browser, and confirm:
- The three charts render above the existing month switcher/stat tiles/ledger.
- Switching 30D/90D/1Y/All visibly changes all three charts.
- The Outflows table lists categories with a plausible dollar value and weight percentage per row.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "Wire range selector and chart grid into the dashboard"
```

---

### Task 6: Frontend — AI chat service and sidebar component

**Files:**
- Create: `frontend/src/types/dashboardChat.ts`
- Create: `frontend/src/services/DashboardChatApiService.ts`
- Create: `frontend/src/dashboard/DashboardChat.tsx`
- Modify: `frontend/src/dashboard/dashboard.css` (append chat styles)

**Interfaces:**
- Consumes: `BaseApiService` from `frontend/src/services/BaseApiService.ts`; `DashboardRange` from `frontend/src/helpers/dashboardMetrics.ts`.
- Produces: `ChatMessage`/`ChatRole` types; `dashboardChatApiService.sendMessage(messages, range): Promise<string>`; `DashboardChat` component (props `{range: DashboardRange}`, default export) — consumed by Task 7.

- [ ] **Step 1: Create the frontend chat types**

```ts
// frontend/src/types/dashboardChat.ts
export type ChatRole = 'user' | 'assistant';

export type ChatMessage = {
    role: ChatRole;
    content: string;
};
```

- [ ] **Step 2: Create the API service**

```ts
// frontend/src/services/DashboardChatApiService.ts
import {BaseApiService} from "./BaseApiService.ts";
import type {ChatMessage} from "../types/dashboardChat.ts";
import type {DashboardRange} from "../helpers/dashboardMetrics.ts";

export class DashboardChatApiService extends BaseApiService {
    constructor() {
        super('/dashboard/chat');
    }

    /**
     * Sends the full conversation so far plus the currently-selected
     * dashboard range, and returns the assistant's reply text.
     */
    async sendMessage(messages: ChatMessage[], range: DashboardRange): Promise<string> {
        const result = await this.create<{reply: string}>({messages, range});
        return result.reply;
    }
}

export const dashboardChatApiService = new DashboardChatApiService();
```

- [ ] **Step 3: Append chat styles to the dashboard stylesheet**

```css
/* frontend/src/dashboard/dashboard.css — append */
.dashboard-layout {
  display: flex;
  align-items: flex-start;
  gap: 1.5rem;
}

.dashboard-main {
  flex: 1;
  min-width: 0;
}

.dashboard-chat {
  flex-shrink: 0;
  width: 320px;
  background: var(--ink-raised);
  border: 1px solid var(--rule-on-ink);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  max-height: 80vh;
  position: sticky;
  top: 1rem;
}

.dashboard-chat__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--rule-on-ink);
  font-family: var(--mono);
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-on-ink);
}

.dashboard-chat__messages {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.dashboard-chat__empty {
  font-family: var(--sans);
  font-size: 0.85rem;
  color: var(--text-on-ink);
}

.chat-bubble {
  font-family: var(--sans);
  font-size: 0.85rem;
  padding: 0.6rem 0.8rem;
  border-radius: 6px;
  line-height: 1.4;
}

.chat-bubble--user {
  background: var(--paper);
  color: var(--text-on-paper);
  align-self: flex-end;
}

.chat-bubble--assistant {
  background: var(--ink);
  color: var(--text-on-ink-strong);
  border: 1px solid var(--rule-on-ink);
}

.chat-bubble--pending {
  opacity: 0.6;
}

.dashboard-chat__input {
  display: flex;
  gap: 0.5rem;
  padding: 0.75rem;
  border-top: 1px solid var(--rule-on-ink);
}

.dashboard-chat__input input {
  flex: 1;
  background: var(--ink);
  border: 1px solid var(--rule-on-ink);
  border-radius: 4px;
  padding: 0.5rem 0.65rem;
  color: var(--text-on-ink-strong);
  font-family: var(--sans);
  font-size: 0.85rem;
}

.dashboard-chat__input button {
  background: var(--due);
  color: var(--ink);
  border: none;
  border-radius: 4px;
  padding: 0.5rem 0.9rem;
  font-family: var(--sans);
  font-weight: 600;
  font-size: 0.85rem;
  cursor: pointer;
}

.dashboard-chat__input button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.chat-toggle {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 1rem;
}

.chat-toggle--closed {
  position: fixed;
  right: 1.5rem;
  bottom: 1.5rem;
  width: 3rem;
  height: 3rem;
  border-radius: 50%;
  background: var(--due);
  border: none;
  font-size: 1.2rem;
  cursor: pointer;
}

@media (max-width: 640px) {
  .dashboard-layout {
    flex-direction: column;
  }

  .dashboard-chat {
    width: 100%;
    position: static;
    max-height: none;
  }
}
```

- [ ] **Step 4: Create the DashboardChat component**

```tsx
// frontend/src/dashboard/DashboardChat.tsx
import {useState} from "react";
import type {ChatMessage} from "../types/dashboardChat.ts";
import type {DashboardRange} from "../helpers/dashboardMetrics.ts";
import {dashboardChatApiService} from "../services/DashboardChatApiService.ts";
import './dashboard.css';

type Props = {range: DashboardRange};

const FALLBACK_ERROR = "Can't reach the local AI model. Make sure Ollama is running.";

function DashboardChat({range}: Props) {
    const [open, setOpen] = useState(() => window.innerWidth > 640);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);

    async function handleSend() {
        const content = draft.trim();
        if (content === '' || sending) {
            return;
        }

        const next: ChatMessage[] = [...messages, {role: 'user', content}];
        setMessages(next);
        setDraft('');
        setSending(true);

        try {
            const reply = await dashboardChatApiService.sendMessage(next, range);
            setMessages((prev) => [...prev, {role: 'assistant', content: reply}]);
        } catch (err) {
            const message = err instanceof Error ? err.message : FALLBACK_ERROR;
            setMessages((prev) => [...prev, {role: 'assistant', content: message}]);
        } finally {
            setSending(false);
        }
    }

    if (!open) {
        return (
            <button
                type="button"
                className="chat-toggle chat-toggle--closed"
                onClick={() => setOpen(true)}
                aria-label="Open assistant"
            >
                💬
            </button>
        );
    }

    return (
        <aside className="dashboard-chat" aria-label="Financial assistant">
            <div className="dashboard-chat__header">
                <span>Assistant</span>
                <button type="button" className="chat-toggle" onClick={() => setOpen(false)} aria-label="Close assistant">
                    ×
                </button>
            </div>
            <div className="dashboard-chat__messages">
                {messages.length === 0 && (
                    <p className="dashboard-chat__empty">Ask about your spending, savings, or where to cut back.</p>
                )}
                {messages.map((m, i) => (
                    <p key={i} className={`chat-bubble chat-bubble--${m.role}`}>{m.content}</p>
                ))}
                {sending && <p className="chat-bubble chat-bubble--assistant chat-bubble--pending">Thinking…</p>}
            </div>
            <form
                className="dashboard-chat__input"
                onSubmit={(e) => {
                    e.preventDefault();
                    void handleSend();
                }}
            >
                <input
                    type="text"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Ask anything…"
                    disabled={sending}
                />
                <button type="submit" disabled={sending || draft.trim() === ''}>Send</button>
            </form>
        </aside>
    );
}

export default DashboardChat;
```

- [ ] **Step 5: Verify it compiles clean**

Run (from `frontend/`): `npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/dashboardChat.ts frontend/src/services/DashboardChatApiService.ts frontend/src/dashboard/DashboardChat.tsx frontend/src/dashboard/dashboard.css
git commit -m "Add AI chat sidebar component backed by the dashboard chat endpoint"
```

---

### Task 7: Frontend — wire the chat sidebar into the dashboard layout

**Files:**
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `DashboardChat` from Task 6, `range` state from Task 5.
- Produces: final `/dashboard` page layout — no new exports.

- [ ] **Step 1: Import DashboardChat**

In `frontend/src/App.tsx`, add alongside the other new imports:

```tsx
import DashboardChat from "./dashboard/DashboardChat.tsx";
```

- [ ] **Step 2: Wrap the page content in the sidebar layout**

Change the top-level return from a bare `<>...</>` fragment to:

```tsx
return (
    <div className="dashboard-layout">
        <div className="dashboard-main">
            <RangeSelect value={range} onChange={setRange}/>
            <section className="chart-grid" aria-label="Financial charts">
                <RunningBalanceChart data={balanceSeries}/>
                <SpendingTrendChart data={spendSeries}/>
                <OutflowsDonut data={outflows}/>
            </section>

            <div className="month-switch">
                <button type="button" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month">‹</button>
                <span className="month-label">{monthLabel(month)}</span>
                <button type="button" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Next month">›</button>
            </div>

            <section className="stat-row" aria-label="Month summary">
                <article className="stat-tile">
                    <span className="stat-label">In</span>
                    <span className="stat-value credit">{formatMoney(totals.credit)}</span>
                </article>
                <article className="stat-tile">
                    <span className="stat-label">Out</span>
                    <span className="stat-value debit">{formatMoney(totals.debit)}</span>
                </article>
                <article className="stat-tile">
                    <span className="stat-label">Net</span>
                    <span className={`stat-value ${totals.net >= 0 ? 'credit' : 'debit'}`}>{formatMoney(totals.net)}</span>
                </article>
            </section>

            <section className="ledger" aria-label="Transactions">
                {loading && <p className="ledger-status">Loading transactions…</p>}
                {error && <p className="ledger-status error">Couldn't load transactions: {error}</p>}
                {!loading && !error && visible.length === 0 && (
                    <p className="ledger-status">Nothing logged for {monthLabel(month)}.</p>
                )}
                {!loading && !error && visible.map((t) => (
                    <article className="ledger-row" key={t.id}>
                        <div className="ledger-row__main">
                            <time className="ledger-date" dateTime={t.date}>{t.date}</time>
                            <span className="ledger-desc">{t.description}</span>
                            <span className="ledger-category">{categoryName(categories, t.category_id)}</span>
                        </div>
                        <div className="ledger-row__amount">
                            <span className={`ledger-amount ${t.amount_cents < 0 ? 'debit' : 'credit'}`}>
                                {formatMoney(t.amount_cents)}
                            </span>
                            <span className="ledger-cents">{t.amount_cents}¢</span>
                        </div>
                    </article>
                ))}
            </section>
        </div>
        <DashboardChat range={range}/>
    </div>
)
```

(This is the existing JSX unchanged, just moved inside `.dashboard-main`, with the two new top-level wrapper `div`s and the `<DashboardChat/>` sibling added.)

- [ ] **Step 3: Verify it compiles clean**

Run (from `frontend/`): `npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 4: Manually verify in the running app**

With the backend running (`npm run dev` in `backend/`) and the frontend running (`npm run dev` in `frontend/`), open `/dashboard` and confirm:
- On a wide viewport, the chat sidebar is open by default, docked to the right of the charts/ledger.
- Below 640px width (resize the browser or use device emulation), the sidebar starts collapsed behind a floating 💬 button; clicking it opens the sidebar full-width below the main content, and the × button collapses it again.
- Typing a question and sending it appends a user bubble, then either an assistant reply or (if Ollama isn't running) the "Can't reach the local AI model. Make sure Ollama is running." bubble.
- Changing the range selector changes which range the next chat message is grounded in (not independently testable in the UI beyond confirming no errors — the grounding itself was covered by Task 1/2's backend tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "Wire AI chat sidebar into the dashboard layout"
```
