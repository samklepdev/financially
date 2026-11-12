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
