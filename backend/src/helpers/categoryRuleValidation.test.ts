import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateCategoryRule} from './categoryRuleValidation.ts';

test('rejects a non-object body', () => {
    const result = validateCategoryRule('nope');
    assert.equal(result.ok, false);
});

test('rejects a missing pattern', () => {
    const result = validateCategoryRule({category_id: 1});
    assert.equal(result.ok, false);
});

test('rejects an empty pattern', () => {
    const result = validateCategoryRule({pattern: '   ', category_id: 1});
    assert.equal(result.ok, false);
});

test('rejects a missing category_id', () => {
    const result = validateCategoryRule({pattern: 'walmart'});
    assert.equal(result.ok, false);
});

test('rejects a non-integer category_id', () => {
    const result = validateCategoryRule({pattern: 'walmart', category_id: 'one'});
    assert.equal(result.ok, false);
});

test('accepts a valid rule and returns the normalized value', () => {
    const result = validateCategoryRule({pattern: 'walmart', category_id: 1});
    assert.deepEqual(result, {ok: true, value: {pattern: 'walmart', category_id: 1}});
});
