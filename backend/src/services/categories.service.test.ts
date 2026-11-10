import {test} from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_FILE = ':memory:';
const {CategoryService} = await import('./categories.service.ts');

const service = new CategoryService();

test('createCategory inserts and returns the category with an id', () => {
    const created = service.createCategory({name: 'Groceries', color: '#6b9478'});
    assert.ok(created.id);
    assert.equal(created.name, 'Groceries');
    assert.equal(created.color, '#6b9478');
});

test('getCategoryById returns undefined for a missing id', () => {
    assert.equal(service.getCategoryById(999999), undefined);
});

test('getAllCategories returns categories ordered by name', () => {
    service.createCategory({name: 'Zzzzz Sort Test', color: '#c06c52'});
    service.createCategory({name: 'Aaaaa Sort Test', color: '#c99a3c'});
    const names = service.getAllCategories().map((c) => c.name);
    assert.ok(names.indexOf('Aaaaa Sort Test') < names.indexOf('Zzzzz Sort Test'));
});

test('updateCategory changes name and color and returns the row', () => {
    const created = service.createCategory({name: 'Dining', color: '#c06c52'});
    const updated = service.updateCategory(created.id, {name: 'Dining Out', color: '#c99a3c'});
    assert.equal(updated?.name, 'Dining Out');
    assert.equal(updated?.color, '#c99a3c');
});

test('updateCategory returns undefined for a missing id', () => {
    const updated = service.updateCategory(999999, {name: 'Nope', color: '#000000'});
    assert.equal(updated, undefined);
});

test('deleteCategory removes the row and reports changes', () => {
    const created = service.createCategory({name: 'Temp', color: '#000000'});
    const {changes} = service.deleteCategory(created.id);
    assert.equal(changes, 1);
    assert.equal(service.getCategoryById(created.id), undefined);
});

test('deleting a category sets category_id to null on referencing transactions', async () => {
    const {TransactionService} = await import('./transactions.service.ts');
    const transactionService = new TransactionService();

    const category = service.createCategory({name: 'Will Be Deleted', color: '#000000'});
    const transaction = transactionService.createTransaction({
        date: '2026-01-01', description: 'Test row', amount_cents: -500, category_id: category.id, bill_id: null,
    });

    service.deleteCategory(category.id);

    const reloaded = transactionService.getTransactionById(transaction.id);
    assert.equal(reloaded?.category_id, null);
});
