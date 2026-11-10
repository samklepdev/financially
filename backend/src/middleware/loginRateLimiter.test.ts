import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Request, Response} from 'express';
import {loginRateLimiter} from './loginRateLimiter.ts';

function fakeResponse() {
    const res = {
        statusCode: 200,
        body: undefined as unknown,
        status(code: number) { this.statusCode = code; return this; },
        json(body: unknown) { this.body = body; return this; },
    };
    return res;
}

function callOnce(ip: string) {
    const req = {ip} as Request;
    const res = fakeResponse();
    let nextCalled = false;
    loginRateLimiter(req, res as unknown as Response, () => { nextCalled = true; });
    return {nextCalled, statusCode: res.statusCode};
}

test('allows 5 attempts from the same IP then blocks the 6th', () => {
    const ip = '203.0.113.5';

    for (let i = 0; i < 5; i++) {
        const result = callOnce(ip);
        assert.equal(result.nextCalled, true, `attempt ${i + 1} should pass through`);
    }

    const sixth = callOnce(ip);
    assert.equal(sixth.nextCalled, false);
    assert.equal(sixth.statusCode, 429);
});

test('tracks IPs independently', () => {
    for (let i = 0; i < 5; i++) {
        callOnce('203.0.113.10');
    }
    const otherIp = callOnce('203.0.113.11');
    assert.equal(otherIp.nextCalled, true);
});
