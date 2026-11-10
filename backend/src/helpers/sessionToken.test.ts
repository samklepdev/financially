import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateSessionToken, hashSessionToken} from './sessionToken.ts';

test('generateSessionToken returns a 64-character hex string', () => {
    const token = generateSessionToken();
    assert.match(token, /^[0-9a-f]{64}$/);
});

test('generateSessionToken returns a different value each call', () => {
    assert.notEqual(generateSessionToken(), generateSessionToken());
});

test('hashSessionToken is deterministic', () => {
    const token = generateSessionToken();
    assert.equal(hashSessionToken(token), hashSessionToken(token));
});

test('hashSessionToken matches a known sha256 vector', () => {
    assert.equal(
        hashSessionToken('abc'),
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
});
