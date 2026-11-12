import {describe, expect, test} from 'vitest';
import {incomeTrendSeries, netCashFlowByMonth} from './dashboardMetrics.ts';
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
