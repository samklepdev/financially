import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateBill} from './billValidation.ts';

test('rejects a non-object body', () => {
    const result = validateBill('nope');
    assert.equal(result.ok, false);
});

test('rejects a missing name', () => {
    const result = validateBill({amount_cents: 1599, due_day: 5, match_pattern: 'netflix'});
    assert.equal(result.ok, false);
});

test('rejects a non-positive amount_cents', () => {
    const result = validateBill({name: 'Netflix', amount_cents: 0, due_day: 5, match_pattern: 'netflix'});
    assert.equal(result.ok, false);
});

test('rejects a due_day outside 1-31', () => {
    const result = validateBill({name: 'Netflix', amount_cents: 1599, due_day: 32, match_pattern: 'netflix'});
    assert.equal(result.ok, false);
});

test('rejects a non-string match_pattern', () => {
    const result = validateBill({name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: null});
    assert.equal(result.ok, false);
});

test('accepts an empty match_pattern', () => {
    const result = validateBill({name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: ''});
    assert.equal(result.ok, true);
});

test('accepts a fully valid bill', () => {
    const result = validateBill({name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: 'netflix'});
    assert.deepEqual(result, {
        ok: true,
        value: {name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: 'netflix'},
    });
});
