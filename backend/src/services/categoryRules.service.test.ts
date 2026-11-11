import {test} from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_FILE = ':memory:';
const {CategoryRuleService} = await import('./categoryRules.service.ts');
const {CategoryService} = await import('./categories.service.ts');

const service = new CategoryRuleService();
const categoryService = new CategoryService();

test('createCategoryRule inserts and returns the rule with an id', () => {
    const category = categoryService.createCategory({name: 'Groceries Rule Test', color: '#6b9478'});
    const created = service.createCategoryRule({pattern: 'walmart', category_id: category.id});
    assert.ok(created.id);
    assert.equal(created.pattern, 'walmart');
    assert.equal(created.category_id, category.id);
});

test('getCategoryRuleById returns undefined for a missing id', () => {
    assert.equal(service.getCategoryRuleById(999999), undefined);
});

test('updateCategoryRule changes pattern and category_id', () => {
    const category = categoryService.createCategory({name: 'Dining Rule Test', color: '#c06c52'});
    const otherCategory = categoryService.createCategory({name: 'Subscriptions Rule Test', color: '#c99a3c'});
    const created = service.createCategoryRule({pattern: 'uber eats', category_id: category.id});

    const updated = service.updateCategoryRule(created.id, {pattern: 'netflix', category_id: otherCategory.id});
    assert.equal(updated?.pattern, 'netflix');
    assert.equal(updated?.category_id, otherCategory.id);
});

test('updateCategoryRule returns undefined for a missing id', () => {
    const category = categoryService.createCategory({name: 'Missing Update Rule Test', color: '#000000'});
    const updated = service.updateCategoryRule(999999, {pattern: 'nope', category_id: category.id});
    assert.equal(updated, undefined);
});

test('deleteCategoryRule removes the row and reports changes', () => {
    const category = categoryService.createCategory({name: 'Temp Rule Test', color: '#000000'});
    const created = service.createCategoryRule({pattern: 'temp merchant', category_id: category.id});
    const {changes} = service.deleteCategoryRule(created.id);
    assert.equal(changes, 1);
    assert.equal(service.getCategoryRuleById(created.id), undefined);
});

test('findCategoryForDescription returns null when nothing matches', () => {
    assert.equal(service.findCategoryForDescription('Totally Unrelated Merchant XYZ'), null);
});

test('findCategoryForDescription matches case-insensitively as a substring', () => {
    const category = categoryService.createCategory({name: 'Groceries Substring Test', color: '#6b9478'});
    service.createCategoryRule({pattern: 'TraderJoesTest', category_id: category.id});

    assert.equal(service.findCategoryForDescription('tradeRjoesTest Austin TX'), category.id);
});

test('findCategoryForDescription returns the longest matching pattern when rules overlap', () => {
    const generic = categoryService.createCategory({name: 'Generic Rule Test', color: '#c06c52'});
    const specific = categoryService.createCategory({name: 'Specific Rule Test', color: '#c99a3c'});
    service.createCategoryRule({pattern: 'cash app', category_id: generic.id});
    service.createCategoryRule({pattern: 'cash app pay walmart', category_id: specific.id});

    assert.equal(
        service.findCategoryForDescription('Cash App Pay Walmart Houston TX'),
        specific.id
    );
});
