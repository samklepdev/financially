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

test('the suggest-category endpoint requires authentication', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/transactions/suggest-category`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({description: 'Anything'}),
        });
        assert.equal(res.status, 401);
    } finally {
        await close();
    }
});

test('rejects an empty description', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);
        const res = await fetch(`${url}/api/v1/transactions/suggest-category`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({description: '   '}),
        });
        assert.equal(res.status, 400);
    } finally {
        await close();
    }
});

test('resolves from exact-description history before anything else', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);

        const categoryRes = await fetch(`${url}/api/v1/categories`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Groceries HTTP Test', color: '#6b9478'}),
        });
        const {data: category} = await categoryRes.json();

        await fetch(`${url}/api/v1/transactions`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({
                date: '2026-10-01', description: 'Trader Joes Suggest Test', amount_cents: -4200,
                category_id: category.id, bill_id: null,
            }),
        });

        const res = await fetch(`${url}/api/v1/transactions/suggest-category`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({description: 'Trader Joes Suggest Test'}),
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.deepEqual(body.data, {category_id: category.id, bill_id: null, aiSuggested: false, proposedCategoryName: null});
    } finally {
        await close();
    }
});

test('falls back to a keyword rule when there is no history match', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);

        const categoryRes = await fetch(`${url}/api/v1/categories`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Pet Care HTTP Test', color: '#c06c52'}),
        });
        const {data: category} = await categoryRes.json();

        await fetch(`${url}/api/v1/category-rules`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({pattern: 'Petco Suggest Test', category_id: category.id}),
        });

        const res = await fetch(`${url}/api/v1/transactions/suggest-category`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({description: 'Petco Suggest Test Houston TX'}),
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.deepEqual(body.data, {category_id: category.id, bill_id: null, aiSuggested: false, proposedCategoryName: null});
    } finally {
        await close();
    }
});

test('auto-links to a bill by match_pattern when one matches', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);

        await fetch(`${url}/api/v1/bills`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({
                name: 'Netflix Suggest Test', amount_cents: 1599, due_day: 5, match_pattern: 'Netflix Suggest Test',
                deferred_until: null,
            }),
        });

        const res = await fetch(`${url}/api/v1/transactions/suggest-category`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({description: 'Netflix Suggest Test Monthly'}),
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.notEqual(body.data.bill_id, null);
    } finally {
        await close();
    }
});
