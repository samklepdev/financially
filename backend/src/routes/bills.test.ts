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

test('/api/v1/bills requires authentication', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/bills`);
        assert.equal(res.status, 401);
    } finally {
        await close();
    }
});

test('creates a bill and returns it with an id', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/bills`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: 'netflix'}),
        });
        assert.equal(res.status, 201);
        const body = await res.json();
        assert.ok(body.data.id);
        assert.equal(body.data.name, 'Netflix');
    } finally {
        await close();
    }
});

test('rejects a bill with an out-of-range due_day', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/bills`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Bad Bill', amount_cents: 1000, due_day: 0, match_pattern: ''}),
        });
        assert.equal(res.status, 400);
    } finally {
        await close();
    }
});

test('updates a bill', async () => {
    const {url, close} = await listen(app);
    try {
        const createRes = await fetch(`${url}/api/v1/bills`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Spotify', amount_cents: 1099, due_day: 10, match_pattern: 'spotify'}),
        });
        const {data: created} = await createRes.json();

        const updateRes = await fetch(`${url}/api/v1/bills/${created.id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Spotify Premium', amount_cents: 1199, due_day: 12, match_pattern: 'spotify'}),
        });
        assert.equal(updateRes.status, 200);
        const {data: updated} = await updateRes.json();
        assert.equal(updated.name, 'Spotify Premium');
    } finally {
        await close();
    }
});

test('deleting a bill 404s when it does not exist', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/bills/999999`, {
            method: 'DELETE',
            headers: {Cookie: cookie},
        });
        assert.equal(res.status, 404);
    } finally {
        await close();
    }
});

test('deletes a bill', async () => {
    const {url, close} = await listen(app);
    try {
        const createRes = await fetch(`${url}/api/v1/bills`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Temp Bill HTTP Test', amount_cents: 500, due_day: 1, match_pattern: ''}),
        });
        const {data: created} = await createRes.json();

        const deleteRes = await fetch(`${url}/api/v1/bills/${created.id}`, {
            method: 'DELETE',
            headers: {Cookie: cookie},
        });
        assert.equal(deleteRes.status, 204);
    } finally {
        await close();
    }
});

test('GET /bills/upcoming returns bills due soon or overdue', async () => {
    const {url, close} = await listen(app);
    try {
        await fetch(`${url}/api/v1/bills`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Upcoming HTTP Test Bill', amount_cents: 1000, due_day: 1, match_pattern: ''}),
        });

        const res = await fetch(`${url}/api/v1/bills/upcoming`, {headers: {Cookie: cookie}});
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.ok(Array.isArray(body.data));
    } finally {
        await close();
    }
});

test('GET /bills/suggestions returns an array', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/bills/suggestions`, {headers: {Cookie: cookie}});
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.ok(Array.isArray(body.data));
    } finally {
        await close();
    }
});
