import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword} from './helpers/password.ts';
import {listen} from './testHelpers/httpServer.ts';

process.env.DATABASE_FILE = ':memory:';
process.env.APP_PASSWORD_HASH = hashPassword('correct-password');

const {default: app} = await import('./app.ts');

test('login with the wrong password returns 401', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/auth/login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({password: 'wrong-password'}),
        });
        assert.equal(res.status, 401);
    } finally {
        await close();
    }
});

test('login with a missing password returns 400', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/auth/login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({}),
        });
        assert.equal(res.status, 400);
    } finally {
        await close();
    }
});

test('login with the correct password sets a cookie that /me accepts', async () => {
    const {url, close} = await listen(app);
    try {
        const loginRes = await fetch(`${url}/api/v1/auth/login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({password: 'correct-password'}),
        });
        assert.equal(loginRes.status, 200);
        const cookie = loginRes.headers.get('set-cookie');
        assert.ok(cookie, 'expected a Set-Cookie header');

        const meRes = await fetch(`${url}/api/v1/auth/me`, {
            headers: {Cookie: cookie!.split(';')[0]},
        });
        assert.equal(meRes.status, 200);
    } finally {
        await close();
    }
});

test('/api/v1/transactions requires authentication', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/transactions`);
        assert.equal(res.status, 401);
    } finally {
        await close();
    }
});

test('logout clears the session so a later /me call is unauthenticated', async () => {
    const {url, close} = await listen(app);
    try {
        const loginRes = await fetch(`${url}/api/v1/auth/login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({password: 'correct-password'}),
        });
        const cookie = loginRes.headers.get('set-cookie')!.split(';')[0];

        const logoutRes = await fetch(`${url}/api/v1/auth/logout`, {
            method: 'POST',
            headers: {Cookie: cookie},
        });
        assert.equal(logoutRes.status, 204);

        const meRes = await fetch(`${url}/api/v1/auth/me`, {headers: {Cookie: cookie}});
        assert.equal(meRes.status, 401);
    } finally {
        await close();
    }
});
