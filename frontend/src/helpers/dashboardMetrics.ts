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
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    start.setUTCDate(start.getUTCDate() - RANGE_DAYS[range]);
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
