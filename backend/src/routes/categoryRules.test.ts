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

const bootstrap = await listen(app);
const cookie = await loginCookie(bootstrap.url);
await bootstrap.close();

async function createCategory(url: string, name: string): Promise<number> {
    const res = await fetch(`${url}/api/v1/categories`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Cookie: cookie},
        body: JSON.stringify({name, color: '#6b9478'}),
    });
    const {data} = await res.json();
    return data.id;
}

test('/api/v1/category-rules requires authentication', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/category-rules`);
        assert.equal(res.status, 401);
    } finally {
        await close();
    }
});

test('creates a category rule and returns it with an id', async () => {
    const {url, close} = await listen(app);
    try {
        const categoryId = await createCategory(url, 'Groceries Route Test');
        const res = await fetch(`${url}/api/v1/category-rules`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({pattern: 'walmart', category_id: categoryId}),
        });
        assert.equal(res.status, 201);
        const body = await res.json();
        assert.ok(body.data.id);
        assert.equal(body.data.pattern, 'walmart');
    } finally {
        await close();
    }
});

test('rejects a rule referencing a nonexistent category', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/category-rules`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({pattern: 'walmart', category_id: 999999}),
        });
        assert.equal(res.status, 400);
    } finally {
        await close();
    }
});

test('updates a category rule', async () => {
    const {url, close} = await listen(app);
    try {
        const categoryId = await createCategory(url, 'Dining Route Test');
        const createRes = await fetch(`${url}/api/v1/category-rules`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({pattern: 'uber eats', category_id: categoryId}),
        });
        const {data: created} = await createRes.json();

        const updateRes = await fetch(`${url}/api/v1/category-rules/${created.id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({pattern: 'doordash', category_id: categoryId}),
        });
        assert.equal(updateRes.status, 200);
        const {data: updated} = await updateRes.json();
        assert.equal(updated.pattern, 'doordash');
    } finally {
        await close();
    }
});

test('deleting a category rule 404s when it does not exist', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/category-rules/999999`, {
            method: 'DELETE',
            headers: {Cookie: cookie},
        });
        assert.equal(res.status, 404);
    } finally {
        await close();
    }
});

test('deletes a category rule', async () => {
    const {url, close} = await listen(app);
    try {
        const categoryId = await createCategory(url, 'Temp Route Test');
        const createRes = await fetch(`${url}/api/v1/category-rules`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({pattern: 'temp pattern', category_id: categoryId}),
        });
        const {data: created} = await createRes.json();

        const deleteRes = await fetch(`${url}/api/v1/category-rules/${created.id}`, {
            method: 'DELETE',
            headers: {Cookie: cookie},
        });
        assert.equal(deleteRes.status, 204);
    } finally {
        await close();
    }
});
