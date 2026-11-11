import {test} from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_FILE = ':memory:';
const {resolveNewCategories} = await import('./importCategoryResolver.service.ts');
const {CategoryService} = await import('./categories.service.ts');
const {CategoryRuleService} = await import('./categoryRules.service.ts');

const categoryService = new CategoryService();
const categoryRuleService = new CategoryRuleService();

test('creates exactly one category, and one rule per row, when two rows propose the same new name', () => {
    const before = categoryService.getAllCategories().length;

    const result = resolveNewCategories([
        {date: '2026-11-01', description: 'Yarn Barn Austin', amount_cents: -1200, category_id: null, bill_id: null, newCategoryName: 'Hobbies'},
        {date: '2026-11-02', description: 'Yarn Barn Dallas', amount_cents: -800, category_id: null, bill_id: null, newCategoryName: 'Hobbies'},
    ]);

    const afterCategories = categoryService.getAllCategories();
    assert.equal(afterCategories.length, before + 1);
    const created = afterCategories.find((c) => c.name === 'Hobbies')!;
    assert.equal(result[0].category_id, created.id);
    assert.equal(result[1].category_id, created.id);

    const rules = categoryRuleService.getAllCategoryRules().filter((r) => r.category_id === created.id);
    assert.equal(rules.length, 2);
    assert.ok(rules.some((r) => r.pattern === 'Yarn Barn Austin'));
    assert.ok(rules.some((r) => r.pattern === 'Yarn Barn Dallas'));
});

test('reuses an existing category case-insensitively instead of creating a duplicate', () => {
    const existing = categoryService.createCategory({name: 'Dining Resolver Test', color: '#c06c52'});
    const before = categoryService.getAllCategories().length;

    const result = resolveNewCategories([
        {date: '2026-11-03', description: 'Some Diner', amount_cents: -500, category_id: null, bill_id: null, newCategoryName: 'dining resolver test'},
    ]);

    assert.equal(categoryService.getAllCategories().length, before);
    assert.equal(result[0].category_id, existing.id);
});

test('leaves a row with an already-resolved category_id untouched, ignoring any stray newCategoryName', () => {
    const category = categoryService.createCategory({name: 'Already Set Test', color: '#c99a3c'});
    const before = categoryService.getAllCategories().length;

    const result = resolveNewCategories([
        {date: '2026-11-04', description: 'Already Categorized', amount_cents: -300, category_id: category.id, bill_id: null, newCategoryName: 'Should Be Ignored'},
    ]);

    assert.equal(categoryService.getAllCategories().length, before);
    assert.equal(result[0].category_id, category.id);
});

test('leaves a row with no newCategoryName untouched', () => {
    const result = resolveNewCategories([
        {date: '2026-11-05', description: 'Still Uncategorized', amount_cents: -100, category_id: null, bill_id: null},
    ]);
    assert.equal(result[0].category_id, null);
});
