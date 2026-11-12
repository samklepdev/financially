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

test('getUpcomingBills marks an unpaid bill due within 14 days as upcoming', () => {
    const today = new Date('2026-06-15T00:00:00Z');
    const bill = service.createBill({name: 'Upcoming Test Bill', amount_cents: 1000, due_day: 20, match_pattern: ''});

    const results = service.getUpcomingBills(today);
    const entry = results.find((r) => r.bill.id === bill.id);
    assert.equal(entry?.status, 'upcoming');
    assert.equal(entry?.dueDate, '2026-06-20');
});

test('getUpcomingBills marks an unpaid bill past its due date this cycle as overdue', () => {
    const today = new Date('2026-06-15T00:00:00Z');
    const bill = service.createBill({name: 'Overdue Test Bill', amount_cents: 1000, due_day: 5, match_pattern: ''});

    const results = service.getUpcomingBills(today);
    const entry = results.find((r) => r.bill.id === bill.id);
    assert.equal(entry?.status, 'overdue');
    assert.equal(entry?.dueDate, '2026-06-05');
});

test('getUpcomingBills marks a bill with a linked transaction this cycle as paid', async () => {
    const {TransactionService} = await import('./transactions.service.ts');
    const transactionService = new TransactionService();
    const today = new Date('2026-06-15T00:00:00Z');
    const bill = service.createBill({name: 'Paid Test Bill', amount_cents: 1000, due_day: 10, match_pattern: ''});
    transactionService.createTransaction({
        date: '2026-06-09', description: 'Paid Test Bill payment', amount_cents: -1000,
        category_id: null, bill_id: bill.id,
    });

    const results = service.getUpcomingBills(today);
    const entry = results.find((r) => r.bill.id === bill.id);
    assert.equal(entry?.status, 'paid');
});

test('getUpcomingBills omits a bill due more than 14 days out', () => {
    const today = new Date('2026-06-15T00:00:00Z');
    const bill = service.createBill({name: 'Far Future Test Bill', amount_cents: 1000, due_day: 30, match_pattern: ''});
    service.createBill({name: 'Dummy Spacer Bill For Far Future Test', amount_cents: 1, due_day: 1, match_pattern: ''});

    const results = service.getUpcomingBills(today);
    assert.equal(results.some((r) => r.bill.id === bill.id), false);
});

test('getUpcomingBills clamps due_day 31 to the last day of a shorter month', () => {
    const today = new Date('2026-02-20T00:00:00Z');
    const bill = service.createBill({name: 'Clamp Test Bill', amount_cents: 1000, due_day: 31, match_pattern: ''});

    const results = service.getUpcomingBills(today);
    const entry = results.find((r) => r.bill.id === bill.id);
    assert.equal(entry?.dueDate, '2026-02-28');
    assert.equal(entry?.status, 'upcoming');
});

test('getUpcomingBills includes a bill due exactly 14 days out (inclusive upper boundary)', () => {
    // today = 2026-06-15, due_day = 29 => dueDate = 2026-06-29
    // daysUntilDue = (2026-06-29 - 2026-06-15) / (24*60*60*1000) = 14
    const today = new Date('2026-06-15T00:00:00Z');
    const bill = service.createBill({name: '14-Day Boundary Bill', amount_cents: 1000, due_day: 29, match_pattern: ''});

    const results = service.getUpcomingBills(today);
    const entry = results.find((r) => r.bill.id === bill.id);
    assert.equal(entry?.status, 'upcoming');
    assert.equal(entry?.dueDate, '2026-06-29');
});

test('getUpcomingBills marks a bill due today as upcoming (not overdue)', () => {
    // today = 2026-06-15, due_day = 15 => dueDate = 2026-06-15
    // daysUntilDue = 0, so status should be 'upcoming' (not 'overdue' which is < 0)
    const today = new Date('2026-06-15T00:00:00Z');
    const bill = service.createBill({name: 'Due Today Bill', amount_cents: 1000, due_day: 15, match_pattern: ''});

    const results = service.getUpcomingBills(today);
    const entry = results.find((r) => r.bill.id === bill.id);
    assert.equal(entry?.status, 'upcoming');
    assert.equal(entry?.dueDate, '2026-06-15');
});

test('getUpcomingBills counts a transaction on prevDueDate as paid (window start is inclusive)', async () => {
    const {TransactionService} = await import('./transactions.service.ts');
    const transactionService = new TransactionService();
    // today = 2026-06-15, due_day = 10 => dueDate = 2026-06-10
    // prevDueDate = 2026-05-10 (previous month)
    // Transaction on 2026-05-10 should count as paid
    const today = new Date('2026-06-15T00:00:00Z');
    const bill = service.createBill({name: 'Payment Window Start Test', amount_cents: 1000, due_day: 10, match_pattern: ''});
    transactionService.createTransaction({
        date: '2026-05-10', description: 'Payment on prev cycle due date', amount_cents: -1000,
        category_id: null, bill_id: bill.id,
    });

    const results = service.getUpcomingBills(today);
    const entry = results.find((r) => r.bill.id === bill.id);
    assert.equal(entry?.status, 'paid');
});

test('getUpcomingBills does not count a transaction on nextDueDate as paid (window end is exclusive)', async () => {
    const {TransactionService} = await import('./transactions.service.ts');
    const transactionService = new TransactionService();
    // today = 2026-06-15, due_day = 5 => dueDate = 2026-06-05 (overdue)
    // nextDueDate = 2026-07-05 (next month)
    // Transaction on 2026-07-05 should NOT count as paid, so status should be 'overdue'
    const today = new Date('2026-06-15T00:00:00Z');
    const bill = service.createBill({name: 'Payment Window End Test', amount_cents: 1000, due_day: 5, match_pattern: ''});
    transactionService.createTransaction({
        date: '2026-07-05', description: 'Payment on next cycle due date', amount_cents: -1000,
        category_id: null, bill_id: bill.id,
    });

    const results = service.getUpcomingBills(today);
    const entry = results.find((r) => r.bill.id === bill.id);
    assert.equal(entry?.status, 'overdue');
});

test('getUpcomingBills clamps due_day 31 to Feb 29 in a leap year', () => {
    // 2028 is a leap year, today = 2028-02-20, due_day = 31
    // dueDate should be 2028-02-29 (not 2028-02-28)
    const today = new Date('2028-02-20T00:00:00Z');
    const bill = service.createBill({name: 'Leap Year Clamp Test', amount_cents: 1000, due_day: 31, match_pattern: ''});

    const results = service.getUpcomingBills(today);
    const entry = results.find((r) => r.bill.id === bill.id);
    assert.equal(entry?.dueDate, '2028-02-29');
    assert.equal(entry?.status, 'upcoming');
});

test('getSuggestedBills suggests a description seen 3+ times about a month apart', async () => {
    const {TransactionService} = await import('./transactions.service.ts');
    const transactionService = new TransactionService();
    const description = 'Suggest Me Monthly Charge';

    transactionService.createTransaction({
        date: '2026-04-01', description, amount_cents: -1500, category_id: null, bill_id: null,
    });
    transactionService.createTransaction({
        date: '2026-05-01', description, amount_cents: -1500, category_id: null, bill_id: null,
    });
    transactionService.createTransaction({
        date: '2026-06-02', description, amount_cents: -1500, category_id: null, bill_id: null,
    });

    const suggestions = service.getSuggestedBills();
    const suggestion = suggestions.find((s) => s.description === description);
    assert.ok(suggestion);
    assert.equal(suggestion?.amount_cents, -1500);
    assert.equal(suggestion?.occurrences, 3);
    assert.equal(suggestion?.suggested_due_day, 2);
});

test('getSuggestedBills does not suggest only 2 occurrences', async () => {
    const {TransactionService} = await import('./transactions.service.ts');
    const transactionService = new TransactionService();
    const description = 'Only Twice Charge';

    transactionService.createTransaction({
        date: '2026-04-01', description, amount_cents: -2000, category_id: null, bill_id: null,
    });
    transactionService.createTransaction({
        date: '2026-05-01', description, amount_cents: -2000, category_id: null, bill_id: null,
    });

    const suggestions = service.getSuggestedBills();
    assert.equal(suggestions.some((s) => s.description === description), false);
});

test('getSuggestedBills does not suggest occurrences spaced too close together', async () => {
    const {TransactionService} = await import('./transactions.service.ts');
    const transactionService = new TransactionService();
    const description = 'Frequent Coffee Purchase';

    transactionService.createTransaction({
        date: '2026-04-01', description, amount_cents: -500, category_id: null, bill_id: null,
    });
    transactionService.createTransaction({
        date: '2026-04-08', description, amount_cents: -500, category_id: null, bill_id: null,
    });
    transactionService.createTransaction({
        date: '2026-04-15', description, amount_cents: -500, category_id: null, bill_id: null,
    });

    const suggestions = service.getSuggestedBills();
    assert.equal(suggestions.some((s) => s.description === description), false);
});

test('getSuggestedBills excludes a description already matched by an existing bill', async () => {
    const {TransactionService} = await import('./transactions.service.ts');
    const transactionService = new TransactionService();
    const description = 'Already A Bill Charge';

    service.createBill({name: 'Already A Bill', amount_cents: 999, due_day: 1, match_pattern: 'Already A Bill Charge'});

    transactionService.createTransaction({
        date: '2026-04-01', description, amount_cents: -999, category_id: null, bill_id: null,
    });
    transactionService.createTransaction({
        date: '2026-05-01', description, amount_cents: -999, category_id: null, bill_id: null,
    });
    transactionService.createTransaction({
        date: '2026-06-01', description, amount_cents: -999, category_id: null, bill_id: null,
    });

    const suggestions = service.getSuggestedBills();
    assert.equal(suggestions.some((s) => s.description === description), false);
});

test('getSuggestedBills rejects a group with a single out-of-range gap despite other gaps being valid', async () => {
    const {TransactionService} = await import('./transactions.service.ts');
    const transactionService = new TransactionService();
    const description = 'Non Uniform Gap Charge';

    transactionService.createTransaction({
        date: '2026-01-01', description, amount_cents: -1200, category_id: null, bill_id: null,
    });
    transactionService.createTransaction({
        date: '2026-01-31', description, amount_cents: -1200, category_id: null, bill_id: null,
    });
    transactionService.createTransaction({
        date: '2026-02-10', description, amount_cents: -1200, category_id: null, bill_id: null,
    });

    const suggestions = service.getSuggestedBills();
    assert.equal(suggestions.some((s) => s.description === description), false);
});
