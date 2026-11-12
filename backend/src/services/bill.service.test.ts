import {test} from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_FILE = ':memory:';
const {BillService} = await import('./bill.service.ts');

const service = new BillService();

test('createBill inserts and returns the bill with an id', () => {
    const created = service.createBill({name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: 'netflix'});
    assert.ok(created.id);
    assert.equal(created.name, 'Netflix');
    assert.equal(created.amount_cents, 1599);
    assert.equal(created.due_day, 5);
    assert.equal(created.match_pattern, 'netflix');
});

test('getBillById returns undefined for a missing id', () => {
    assert.equal(service.getBillById(999999), undefined);
});

test('getAllBills returns bills ordered by name', () => {
    service.createBill({name: 'Zzzzz Sort Test', amount_cents: 500, due_day: 1, match_pattern: ''});
    service.createBill({name: 'Aaaaa Sort Test', amount_cents: 500, due_day: 1, match_pattern: ''});
    const names = service.getAllBills().map((b) => b.name);
    assert.ok(names.indexOf('Aaaaa Sort Test') < names.indexOf('Zzzzz Sort Test'));
});

test('updateBill changes fields and returns the row', () => {
    const created = service.createBill({name: 'Spotify', amount_cents: 1099, due_day: 10, match_pattern: 'spotify'});
    const updated = service.updateBill(created.id, {
        name: 'Spotify Premium', amount_cents: 1199, due_day: 12, match_pattern: 'spotify premium',
    });
    assert.equal(updated?.name, 'Spotify Premium');
    assert.equal(updated?.amount_cents, 1199);
    assert.equal(updated?.due_day, 12);
    assert.equal(updated?.match_pattern, 'spotify premium');
});

test('updateBill returns undefined for a missing id', () => {
    const updated = service.updateBill(999999, {name: 'Nope', amount_cents: 100, due_day: 1, match_pattern: ''});
    assert.equal(updated, undefined);
});

test('deleteBill removes the row and reports changes', () => {
    const created = service.createBill({name: 'Temp Bill', amount_cents: 500, due_day: 1, match_pattern: ''});
    const {changes} = service.deleteBill(created.id);
    assert.equal(changes, 1);
    assert.equal(service.getBillById(created.id), undefined);
});

test('deleting a bill sets bill_id to null on referencing transactions', async () => {
    const {TransactionService} = await import('./transactions.service.ts');
    const transactionService = new TransactionService();

    const bill = service.createBill({name: 'Will Be Deleted', amount_cents: 500, due_day: 1, match_pattern: ''});
    const transaction = transactionService.createTransaction({
        date: '2026-01-01', description: 'Test row', amount_cents: -500, category_id: null, bill_id: bill.id,
    });

    service.deleteBill(bill.id);

    const reloaded = transactionService.getTransactionById(transaction.id);
    assert.equal(reloaded?.bill_id, null);
});

test('findBillForDescription matches a case-insensitive substring', () => {
    service.createBill({name: 'Netflix Sub Test', amount_cents: 1599, due_day: 5, match_pattern: 'NETFLIX SUB TEST'});
    const billId = service.findBillForDescription('netflix sub test monthly charge');
    const bill = service.getAllBills().find((b) => b.id === billId);
    assert.equal(bill?.name, 'Netflix Sub Test');
});

test('findBillForDescription returns null when no pattern matches', () => {
    assert.equal(service.findBillForDescription('Some Unmatched Merchant XYZ'), null);
});

test('findBillForDescription ignores bills with an empty match_pattern', () => {
    service.createBill({name: 'No Pattern Bill', amount_cents: 500, due_day: 1, match_pattern: ''});
    assert.equal(service.findBillForDescription('No Pattern Bill'), null);
});

test('findBillForDescription picks the longest matching pattern', () => {
    service.createBill({name: 'Generic Pattern Test', amount_cents: 500, due_day: 1, match_pattern: 'Cash App'});
    service.createBill({name: 'Specific Pattern Test', amount_cents: 500, due_day: 1, match_pattern: 'Cash App Walmart'});
    const billId = service.findBillForDescription('Cash App Walmart Houston TX');
    const bill = service.getAllBills().find((b) => b.id === billId);
    assert.equal(bill?.name, 'Specific Pattern Test');
});
