import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateBill} from './billValidation.ts';

test('rejects a non-object body', () => {
    const result = validateBill('nope');
    assert.equal(result.ok, false);
});

test('rejects a missing name', () => {
    const result = validateBill({amount_cents: 1599, due_day: 5, match_pattern: 'netflix', deferred_until: null});
    assert.equal(result.ok, false);
});

test('rejects a non-positive amount_cents', () => {
    const result = validateBill({name: 'Netflix', amount_cents: 0, due_day: 5, match_pattern: 'netflix', deferred_until: null});
    assert.equal(result.ok, false);
});

test('rejects a due_day outside 1-31', () => {
    const result = validateBill({name: 'Netflix', amount_cents: 1599, due_day: 32, match_pattern: 'netflix', deferred_until: null});
    assert.equal(result.ok, false);
});

test('rejects a non-string match_pattern', () => {
    const result = validateBill({name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: null, deferred_until: null});
    assert.equal(result.ok, false);
});

test('accepts an empty match_pattern', () => {
    const result = validateBill({name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: '', deferred_until: null});
    assert.equal(result.ok, true);
});

test('accepts a fully valid bill', () => {
    const result = validateBill({name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: 'netflix', deferred_until: null});
    assert.deepEqual(result, {
        ok: true,
        value: {
            name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: 'netflix',
            deferred_until: null, category_id: null, marked_paid_for: null,
        },
    });
});

test('accepts a valid deferred_until date', () => {
    const result = validateBill({name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: 'netflix', deferred_until: '2026-12-18'});
    assert.deepEqual(result, {
        ok: true,
        value: {
            name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: 'netflix',
            deferred_until: '2026-12-18', category_id: null, marked_paid_for: null,
        },
    });
});

test('accepts a bill with a category_id', () => {
    const result = validateBill({name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: 'netflix', deferred_until: null, category_id: 3});
    assert.deepEqual(result, {
        ok: true,
        value: {
            name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: 'netflix',
            deferred_until: null, category_id: 3, marked_paid_for: null,
        },
    });
});

test('accepts a bill with a marked_paid_for date', () => {
    const result = validateBill({
        name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: 'netflix', deferred_until: null, marked_paid_for: '2026-06-05',
    });
    assert.deepEqual(result, {
        ok: true,
        value: {
            name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: 'netflix',
            deferred_until: null, category_id: null, marked_paid_for: '2026-06-05',
        },
    });
});

test('treats a missing marked_paid_for as null', () => {
    const result = validateBill({name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: 'netflix', deferred_until: null});
    assert.equal(result.ok, true);
    assert.equal((result as {ok: true, value: {marked_paid_for: string | null}}).value.marked_paid_for, null);
});

test('rejects a malformed marked_paid_for', () => {
    const result = validateBill({
        name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: 'netflix', deferred_until: null, marked_paid_for: '06/05/2026',
    });
    assert.equal(result.ok, false);
});

test('treats a missing category_id as null', () => {
    const result = validateBill({name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: 'netflix', deferred_until: null});
    assert.equal(result.ok, true);
    assert.equal((result as {ok: true, value: {category_id: number | null}}).value.category_id, null);
});

test('rejects a non-integer category_id', () => {
    const result = validateBill({name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: 'netflix', deferred_until: null, category_id: 'three'});
    assert.equal(result.ok, false);
});

test('rejects a malformed deferred_until', () => {
    const result = validateBill({name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: 'netflix', deferred_until: '12/18/2026'});
    assert.equal(result.ok, false);
});

test('rejects a missing deferred_until', () => {
    const result = validateBill({name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: 'netflix'});
    assert.equal(result.ok, false);
});
