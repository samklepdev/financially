import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword} from '../helpers/password.ts';
import {listen} from '../testHelpers/httpServer.ts';

process.env.DATABASE_FILE = ':memory:';
process.env.APP_PASSWORD_HASH = hashPassword('test-password');

const {default: app} = await import('../app.ts');

async function loginCookie(url: string): Promise<string> {
    const res = await fetch(`${url}/api/v1/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({password: 'test-password'}),
    });
    return res.headers.get('set-cookie')!.split(';')[0];
}

test('the chat endpoint requires authentication', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/dashboard/chat`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({messages: [{role: 'user', content: 'hi'}], range: '90d'}),
        });
        assert.equal(res.status, 401);
    } finally {
        await close();
    }
});

test('rejects an empty messages array', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);
        const res = await fetch(`${url}/api/v1/dashboard/chat`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({messages: [], range: '90d'}),
        });
        assert.equal(res.status, 400);
    } finally {
        await close();
    }
});

test('rejects an invalid range', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);
        const res = await fetch(`${url}/api/v1/dashboard/chat`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({messages: [{role: 'user', content: 'hi'}], range: 'bogus'}),
        });
        assert.equal(res.status, 400);
    } finally {
        await close();
    }
});

test('returns 502 with a plain-language error when Ollama is unreachable', async () => {
    const {url, close} = await listen(app);
    const originalFetch = globalThis.fetch;
    // Simulate Ollama being down regardless of whether it's actually running
    // on this machine, by rejecting only requests aimed at its port.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof input === 'string' ? input : input.toString();
        if (target.includes('11434')) {
            throw new Error('simulated connection refused');
        }
        return originalFetch(input, init);
    }) as typeof fetch;

    try {
        const cookie = await loginCookie(url);
        const res = await fetch(`${url}/api/v1/dashboard/chat`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({messages: [{role: 'user', content: 'How much did we save?'}], range: '90d'}),
        });
        assert.equal(res.status, 502);
        const body = await res.json() as {error: string};
        assert.match(body.error, /Ollama/);
    } finally {
        globalThis.fetch = originalFetch;
        await close();
    }
});
