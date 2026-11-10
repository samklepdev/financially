import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Request, Response} from 'express';

process.env.DATABASE_FILE = ':memory:';
const {sessionService} = await import('../services/session.service.ts');
const {requireAuth} = await import('./requireAuth.ts');
const {SESSION_COOKIE_NAME} = await import('../config/auth.ts');

function fakeResponse() {
    const res = {
        statusCode: 200,
        body: undefined as unknown,
        status(code: number) { this.statusCode = code; return this; },
        json(body: unknown) { this.body = body; return this; },
    };
    return res;
}

test('rejects a request with no cookie', () => {
    const req = {headers: {}} as Request;
    const res = fakeResponse();
    let nextCalled = false;

    requireAuth(req, res as unknown as Response, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
});

test('rejects a request with an unknown session token', () => {
    const req = {headers: {cookie: `${SESSION_COOKIE_NAME}=not-a-real-token`}} as Request;
    const res = fakeResponse();
    let nextCalled = false;

    requireAuth(req, res as unknown as Response, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
});

test('calls next for a request with a valid session token', () => {
    const {token} = sessionService.createSession();
    const req = {headers: {cookie: `${SESSION_COOKIE_NAME}=${token}`}} as Request;
    const res = fakeResponse();
    let nextCalled = false;

    requireAuth(req, res as unknown as Response, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
});
