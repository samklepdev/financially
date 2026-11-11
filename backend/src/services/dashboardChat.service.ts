import type {Category} from "../types/category.ts";
import type {Transaction} from "../types/transaction.ts";
import type {ChatMessage, DashboardRange, FinancialSummary} from "../types/dashboardChat.ts";
import {TransactionService} from "./transactions.service.ts";
import {CategoryService} from "./categories.service.ts";

const RANGE_DAYS: Record<Exclude<DashboardRange, 'all'>, number> = {
    '30d': 30,
    '90d': 90,
    '1y': 365,
};

const OLLAMA_URL = 'http://localhost:11434';
const OLLAMA_MODEL = 'gemma4:e4b';
const TIMEOUT_MS = 60_000;

const transactionService = new TransactionService();
const categoryService = new CategoryService();

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
