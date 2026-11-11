import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildOllamaPrompt, parseOllamaResponse} from './ollamaCategorySuggester.service.ts';
import type {Category} from '../types/category.ts';

const categories: Category[] = [
    {id: 1, name: 'Groceries', color: '#6b9478'},
    {id: 2, name: 'Dining', color: '#c06c52'},
];

test('buildOllamaPrompt includes every category name', () => {
    const prompt = buildOllamaPrompt(['Walmart Houston TX'], categories);
    assert.ok(prompt.includes('Groceries'));
    assert.ok(prompt.includes('Dining'));
});

test('buildOllamaPrompt includes every description', () => {
    const prompt = buildOllamaPrompt(['Walmart Houston TX', 'Chipotle Mexican Grill'], categories);
    assert.ok(prompt.includes('Walmart Houston TX'));
    assert.ok(prompt.includes('Chipotle Mexican Grill'));
});

test('buildOllamaPrompt dedupes repeated descriptions', () => {
    const prompt = buildOllamaPrompt(['Walmart Houston TX', 'Walmart Houston TX'], categories);
    const occurrences = prompt.split('Walmart Houston TX').length - 1;
    assert.equal(occurrences, 1);
});

test('parseOllamaResponse resolves a valid category name to its id, case-insensitively', () => {
    const result = parseOllamaResponse('{"Walmart Houston TX": "groceries"}', categories);
    assert.deepEqual(result, {'Walmart Houston TX': 1});
});

test('parseOllamaResponse keeps an explicit null as null', () => {
    const result = parseOllamaResponse('{"Some Merchant": null}', categories);
    assert.deepEqual(result, {'Some Merchant': null});
});

test('parseOllamaResponse resolves an unknown/hallucinated category name to null', () => {
    const result = parseOllamaResponse('{"Some Merchant": "Entertainment"}', categories);
    assert.deepEqual(result, {'Some Merchant': null});
});

test('parseOllamaResponse returns an empty object for malformed JSON', () => {
    const result = parseOllamaResponse('not json at all', categories);
    assert.deepEqual(result, {});
});

test('parseOllamaResponse returns an empty object for a non-object JSON value', () => {
    const result = parseOllamaResponse('["Groceries", "Dining"]', categories);
    assert.deepEqual(result, {});
});
