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

test('the import endpoint requires authentication', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/transactions/import`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({transactions: []}),
        });
        assert.equal(res.status, 401);
    } finally {
        await close();
    }
});

test('rejects a non-array transactions body', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);
        const res = await fetch(`${url}/api/v1/transactions/import`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({transactions: 'not-an-array'}),
        });
        assert.equal(res.status, 400);
    } finally {
        await close();
    }
});

test('rejects the whole batch if any transaction is invalid', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);
        const res = await fetch(`${url}/api/v1/transactions/import`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({
                transactions: [
                    {date: '2026-09-05', description: 'Valid', amount_cents: 100, category_id: null, bill_id: null},
                    {date: 'not-a-date', description: 'Invalid', amount_cents: 100, category_id: null, bill_id: null},
                ],
            }),
        });
        assert.equal(res.status, 400);
    } finally {
        await close();
    }
});

test('imports a valid batch and reports the created count', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);
        const res = await fetch(`${url}/api/v1/transactions/import`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({
                transactions: [
                    {date: '2026-09-05', description: 'First', amount_cents: 100, category_id: null, bill_id: null},
                    {date: '2026-09-06', description: 'Second', amount_cents: -200, category_id: null, bill_id: null},
                ],
            }),
        });
        assert.equal(res.status, 201);
        const body = await res.json();
        assert.equal(body.data.created, 2);
    } finally {
        await close();
    }
});

test('creates a new category and a matching rule when a row proposes newCategoryName with no category_id', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);
        const res = await fetch(`${url}/api/v1/transactions/import`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({
                transactions: [
                    {
                        date: '2026-11-01', description: 'Yarn Barn Austin', amount_cents: -1200,
                        category_id: null, bill_id: null, newCategoryName: 'Hobbies HTTP Test',
                    },
                ],
            }),
        });
        assert.equal(res.status, 201);

        const categoriesRes = await fetch(`${url}/api/v1/categories`, {headers: {Cookie: cookie}});
        const {data: categories} = await categoriesRes.json();
        const created = categories.find((c: {name: string}) => c.name === 'Hobbies HTTP Test');
        assert.ok(created);

        const rulesRes = await fetch(`${url}/api/v1/category-rules`, {headers: {Cookie: cookie}});
        const {data: rules} = await rulesRes.json();
        assert.ok(rules.some((r: {pattern: string, category_id: number}) =>
            r.pattern === 'Yarn Barn Austin' && r.category_id === created.id
        ));
    } finally {
        await close();
    }
});
