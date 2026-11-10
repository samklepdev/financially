import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword, verifyPassword} from './password.ts';

test('verifyPassword accepts the correct password against its own hash', () => {
    const stored = hashPassword('correct horse battery staple');
    assert.equal(verifyPassword('correct horse battery staple', stored), true);
});

test('verifyPassword rejects the wrong password', () => {
    const stored = hashPassword('correct horse battery staple');
    assert.equal(verifyPassword('wrong password', stored), false);
});

test('hashPassword salts each call differently', () => {
    const a = hashPassword('same password');
    const b = hashPassword('same password');
    assert.notEqual(a, b);
});

test('verifyPassword rejects a malformed stored value', () => {
    assert.equal(verifyPassword('anything', 'not-a-valid-stored-hash'), false);
});
