import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword} from '../helpers/password.ts';
import {listen} from '../testHelpers/httpServer.ts';

process.env.DATABASE_FILE = ':memory:';
process.env.APP_PASSWORD_HASH = hashPassword('test-password');

const {default: app} = await import('../app.ts');

// The login rate limiter is 5 attempts per IP per 15-minute window, shared
// across this whole process — log in once and reuse the cookie everywhere
// below rather than calling loginCookie() per test.
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

test('/api/v1/categories requires authentication', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/categories`);
        assert.equal(res.status, 401);
    } finally {
        await close();
    }
});

test('creates a category and returns it with an id', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/categories`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Groceries', color: '#6b9478'}),
        });
        assert.equal(res.status, 201);
        const body = await res.json();
        assert.ok(body.data.id);
        assert.equal(body.data.name, 'Groceries');
    } finally {
        await close();
    }
});

test('rejects a category with an invalid color', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/categories`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Bad Color', color: 'not-a-color'}),
        });
        assert.equal(res.status, 400);
    } finally {
        await close();
    }
});

test('rejects a duplicate category name', async () => {
    const {url, close} = await listen(app);
    try {
        await fetch(`${url}/api/v1/categories`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Rent', color: '#c06c52'}),
        });
        const res = await fetch(`${url}/api/v1/categories`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Rent', color: '#c99a3c'}),
        });
        assert.equal(res.status, 400);
    } finally {
        await close();
    }
});

test('updates a category', async () => {
    const {url, close} = await listen(app);
    try {
        const createRes = await fetch(`${url}/api/v1/categories`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Dining', color: '#c06c52'}),
        });
        const {data: created} = await createRes.json();

        const updateRes = await fetch(`${url}/api/v1/categories/${created.id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Dining Out', color: '#c99a3c'}),
        });
        assert.equal(updateRes.status, 200);
        const {data: updated} = await updateRes.json();
        assert.equal(updated.name, 'Dining Out');
    } finally {
        await close();
    }
});

test('deleting a category 404s when it does not exist', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/categories/999999`, {
            method: 'DELETE',
            headers: {Cookie: cookie},
        });
        assert.equal(res.status, 404);
    } finally {
        await close();
    }
});

test('deletes a category', async () => {
    const {url, close} = await listen(app);
    try {
        const createRes = await fetch(`${url}/api/v1/categories`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Temp Category', color: '#000000'}),
        });
        const {data: created} = await createRes.json();

        const deleteRes = await fetch(`${url}/api/v1/categories/${created.id}`, {
            method: 'DELETE',
            headers: {Cookie: cookie},
        });
        assert.equal(deleteRes.status, 204);
    } finally {
        await close();
    }
});
