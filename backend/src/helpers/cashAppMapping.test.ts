import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
    reconstructDate,
    computeAmountCents,
    buildDescription,
    isCanceled,
    mapRowToTransaction,
} from './cashAppMapping.ts';
import type {BucketedRow} from './statementRows.ts';

test('reconstructDate combines the page month/year with the row\'s short date', () => {
    assert.equal(reconstructDate('September 2026', 'Sep 5'), '2026-09-05');
    assert.equal(reconstructDate('September 2026', 'Sep 27'), '2026-09-27');
});

test('reconstructDate throws when the row date doesn\'t match the statement month', () => {
    assert.throws(() => reconstructDate('September 2026', 'Oct 1'));
});

test('computeAmountCents folds a fee into a credit', () => {
    // Walmart deposit: +$100.00, $1.00 fee -> net +$99.00
    assert.equal(computeAmountCents('+ $100.00', '$1.00'), 9900);
});

test('computeAmountCents folds a fee into a debit', () => {
    // Visa instant transfer: $16.88, $0.50 fee -> net -$17.38
    assert.equal(computeAmountCents('$16.88', '$0.50'), -1738);
});

test('computeAmountCents handles a zero fee', () => {
    assert.equal(computeAmountCents('$10.00', '$0.00'), -1000);
    assert.equal(computeAmountCents('+ $10.00', '$0.00'), 1000);
});

test('buildDescription combines Description and Details', () => {
    assert.equal(
        buildDescription('From Stride Bank, National Association x8703', 'Standard transfer'),
        'From Stride Bank, National Association x8703 (Standard transfer)'
    );
});

test('isCanceled detects a canceled transaction\'s Details text', () => {
    assert.equal(isCanceled('Cash App Pay (canceled)'), true);
    assert.equal(isCanceled('Cash App Card'), false);
});

test('mapRowToTransaction returns null for a canceled row', () => {
    const row: BucketedRow = {
        date: 'Sep 27', description: 'Google', details: 'Cash App Pay (canceled)', fee: '$0.00', amount: '$0.00',
    };
    assert.equal(mapRowToTransaction('September 2026', row), null);
});

test('mapRowToTransaction maps a normal row to a NewTransaction', () => {
    const row: BucketedRow = {
        date: 'Sep 5', description: 'Walmart Houston TX', details: 'Paper money deposit', fee: '$1.00', amount: '+ $100.00',
    };
    assert.deepEqual(mapRowToTransaction('September 2026', row), {
        date: '2026-09-05',
        description: 'Walmart Houston TX (Paper money deposit)',
        amount_cents: 9900,
        category_id: null,
        bill_id: null,
    });
});
