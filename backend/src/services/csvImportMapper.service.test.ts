import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mapCsvToTransactions} from './csvImportMapper.service.ts';

const headers = ['Date', 'Notes', 'Amount'];

test('maps good rows to transactions using the given column mapping', () => {
    const rows = [
        ['2026-11-11 16:42:35 CST', 'CTLP*J&S VENDING', '-$2.10'],
        ['2026-11-10 09:24:01 CST', 'Add Cash', '$50.00'],
    ];
    const {transactions, errors} = mapCsvToTransactions(headers, rows, {
        date: 'Date', description: 'Notes', amount: 'Amount',
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(transactions, [
        {date: '2026-11-11', description: 'CTLP*J&S VENDING', amount_cents: -210, category_id: null, bill_id: null},
        {date: '2026-11-10', description: 'Add Cash', amount_cents: 5000, category_id: null, bill_id: null},
    ]);
});

test('collects a bad row into errors with its 1-indexed row number, and still processes the rest', () => {
    const rows = [
        ['2026-11-11 16:42:35 CST', 'Good row', '-$2.10'],
        ['not a date', 'Bad row', '-$2.10'],
        ['2026-11-10 09:24:01 CST', 'Another good row', '$50.00'],
    ];
    const {transactions, errors} = mapCsvToTransactions(headers, rows, {
        date: 'Date', description: 'Notes', amount: 'Amount',
    });
    assert.equal(transactions.length, 2);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].row, 2);
    assert.match(errors[0].message, /not a date/);
});

test('collects a row with an empty description into errors', () => {
    const rows = [['2026-11-11', '', '$10.00']];
    const {transactions, errors} = mapCsvToTransactions(headers, rows, {
        date: 'Date', description: 'Notes', amount: 'Amount',
    });
    assert.equal(transactions.length, 0);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].row, 1);
});
