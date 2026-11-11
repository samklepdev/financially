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
