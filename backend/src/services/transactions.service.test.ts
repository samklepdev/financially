import {test} from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_FILE = ':memory:';
const {TransactionService} = await import('./transactions.service.ts');

const service = new TransactionService();

test('existsSimilar returns false when nothing matches', () => {
    assert.equal(service.existsSimilar('2026-09-05', 'Walmart Houston TX', 9900), false);
});

test('existsSimilar returns true after a matching transaction is created', () => {
    service.createMany([
        {date: '2026-09-05', description: 'Walmart Houston TX', amount_cents: 9900, category_id: null, bill_id: null},
    ]);
    assert.equal(service.existsSimilar('2026-09-05', 'Walmart Houston TX', 9900), true);
});

test('createMany inserts every transaction and returns them with ids', () => {
    const created = service.createMany([
        {date: '2026-09-06', description: 'A', amount_cents: 100, category_id: null, bill_id: null},
        {date: '2026-09-06', description: 'B', amount_cents: -200, category_id: null, bill_id: null},
    ]);
    assert.equal(created.length, 2);
    assert.ok(created[0].id);
    assert.ok(created[1].id);
});

test('createMany rolls back entirely if one insert fails', () => {
    assert.throws(() => {
        service.createMany([
            {date: '2026-09-07', description: 'Good row', amount_cents: 100, category_id: null, bill_id: null},
            {date: '2026-09-07', description: 'Bad row', amount_cents: 200, category_id: 9999, bill_id: null},
        ]);
    });
    assert.equal(service.existsSimilar('2026-09-07', 'Good row', 100), false);
});

test('findRecentCategoryForDescription returns null when nothing matches', () => {
    assert.equal(service.findRecentCategoryForDescription('Nonexistent Merchant'), null);
});

test('findRecentCategoryForDescription ignores uncategorized matches', () => {
    service.createMany([
        {date: '2026-07-01', description: 'Uncategorized Merchant', amount_cents: -1000, category_id: null, bill_id: null},
    ]);
    assert.equal(service.findRecentCategoryForDescription('Uncategorized Merchant'), null);
});

test('findRecentCategoryForDescription returns the category from a matching transaction', async () => {
    const {CategoryService} = await import('./categories.service.ts');
    const categoryService = new CategoryService();
    const category = categoryService.createCategory({name: 'Groceries Test', color: '#6b9478'});

    service.createMany([
        {date: '2026-08-01', description: 'Trader Joes Austin TX', amount_cents: -5000, category_id: category.id, bill_id: null},
    ]);

    assert.equal(service.findRecentCategoryForDescription('Trader Joes Austin TX'), category.id);
});

test('findRecentCategoryForDescription uses the most recently dated match when categories differ', async () => {
    const {CategoryService} = await import('./categories.service.ts');
    const categoryService = new CategoryService();
    const older = categoryService.createCategory({name: 'Older Category Test', color: '#c06c52'});
    const newer = categoryService.createCategory({name: 'Newer Category Test', color: '#c99a3c'});

    service.createMany([
        {date: '2026-01-01', description: 'Recurring Merchant', amount_cents: -1000, category_id: older.id, bill_id: null},
        {date: '2026-06-01', description: 'Recurring Merchant', amount_cents: -1000, category_id: newer.id, bill_id: null},
    ]);

    assert.equal(service.findRecentCategoryForDescription('Recurring Merchant'), newer.id);
});
