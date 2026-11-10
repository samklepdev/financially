import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCookieHeader} from './cookies.ts';

test('returns an empty object for an undefined header', () => {
    assert.deepEqual(parseCookieHeader(undefined), {});
});

test('parses a single cookie', () => {
    assert.deepEqual(parseCookieHeader('a=1'), {a: '1'});
});

test('parses multiple cookies', () => {
    assert.deepEqual(parseCookieHeader('a=1; b=2'), {a: '1', b: '2'});
});

test('decodes a URL-encoded value', () => {
    assert.deepEqual(parseCookieHeader('a=hello%20world'), {a: 'hello world'});
});

test('preserves a value containing an equals sign', () => {
    assert.deepEqual(parseCookieHeader('a=x=y'), {a: 'x=y'});
});
