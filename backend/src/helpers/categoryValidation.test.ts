import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateCategory} from './categoryValidation.ts';

test('rejects a non-object body', () => {
    const result = validateCategory('nope');
    assert.equal(result.ok, false);
});

test('rejects a missing name', () => {
    const result = validateCategory({color: '#6b9478'});
    assert.equal(result.ok, false);
});

test('rejects an empty name', () => {
    const result = validateCategory({name: '   ', color: '#6b9478'});
    assert.equal(result.ok, false);
});

test('rejects a missing color', () => {
    const result = validateCategory({name: 'Groceries'});
    assert.equal(result.ok, false);
});

test('rejects a malformed color', () => {
    const result = validateCategory({name: 'Groceries', color: 'green'});
    assert.equal(result.ok, false);
});

test('accepts a valid category and returns the normalized value', () => {
    const result = validateCategory({name: 'Groceries', color: '#6b9478'});
    assert.deepEqual(result, {ok: true, value: {name: 'Groceries', color: '#6b9478'}});
});
