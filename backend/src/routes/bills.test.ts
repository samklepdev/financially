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
            body: JSON.stringify({name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: 'netflix', deferred_until: null, category_id: null}),
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
            body: JSON.stringify({name: 'Bad Bill', amount_cents: 1000, due_day: 0, match_pattern: '', deferred_until: null, category_id: null}),
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
            body: JSON.stringify({name: 'Spotify', amount_cents: 1099, due_day: 10, match_pattern: 'spotify', deferred_until: null, category_id: null}),
        });
        const {data: created} = await createRes.json();

        const updateRes = await fetch(`${url}/api/v1/bills/${created.id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Spotify Premium', amount_cents: 1199, due_day: 12, match_pattern: 'spotify', deferred_until: null, category_id: null}),
        });
        assert.equal(updateRes.status, 200);
        const {data: updated} = await updateRes.json();
        assert.equal(updated.name, 'Spotify Premium');
    } finally {
        await close();
    }
});

test('updates a bill with a deferred_until date, and accepts clearing it back to null', async () => {
    const {url, close} = await listen(app);
    try {
        const createRes = await fetch(`${url}/api/v1/bills`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Defer HTTP Test Bill', amount_cents: 500, due_day: 10, match_pattern: '', deferred_until: null, category_id: null}),
        });
        const {data: created} = await createRes.json();

        const deferRes = await fetch(`${url}/api/v1/bills/${created.id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Defer HTTP Test Bill', amount_cents: 500, due_day: 10, match_pattern: '', deferred_until: '2026-12-18', category_id: null}),
        });
        assert.equal(deferRes.status, 200);
        const {data: deferred} = await deferRes.json();
        assert.equal(deferred.deferred_until, '2026-12-18');

        const clearRes = await fetch(`${url}/api/v1/bills/${created.id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Defer HTTP Test Bill', amount_cents: 500, due_day: 10, match_pattern: '', deferred_until: null, category_id: null}),
        });
        assert.equal(clearRes.status, 200);
        const {data: cleared} = await clearRes.json();
        assert.equal(cleared.deferred_until, null);
    } finally {
        await close();
    }
});

test('updates a bill with a marked_paid_for date, and accepts clearing it back to null', async () => {
    const {url, close} = await listen(app);
    try {
        const createRes = await fetch(`${url}/api/v1/bills`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Mark Paid HTTP Test Bill', amount_cents: 500, due_day: 10, match_pattern: '', deferred_until: null, category_id: null}),
        });
        const {data: created} = await createRes.json();

        const markRes = await fetch(`${url}/api/v1/bills/${created.id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({
                name: 'Mark Paid HTTP Test Bill', amount_cents: 500, due_day: 10, match_pattern: '',
                deferred_until: null, category_id: null, marked_paid_for: '2026-06-10',
            }),
        });
        assert.equal(markRes.status, 200);
        const {data: marked} = await markRes.json();
        assert.equal(marked.marked_paid_for, '2026-06-10');

        const clearRes = await fetch(`${url}/api/v1/bills/${created.id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Mark Paid HTTP Test Bill', amount_cents: 500, due_day: 10, match_pattern: '', deferred_until: null, category_id: null}),
        });
        assert.equal(clearRes.status, 200);
        const {data: cleared} = await clearRes.json();
        assert.equal(cleared.marked_paid_for, null);
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
            body: JSON.stringify({name: 'Temp Bill HTTP Test', amount_cents: 500, due_day: 1, match_pattern: '', deferred_until: null, category_id: null}),
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
            body: JSON.stringify({name: 'Upcoming HTTP Test Bill', amount_cents: 1000, due_day: 1, match_pattern: '', deferred_until: null, category_id: null}),
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

test('GET /bills/:id returns a bill by id', async () => {
    const {url, close} = await listen(app);
    try {
        const createRes = await fetch(`${url}/api/v1/bills`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Get By ID Test Bill', amount_cents: 2000, due_day: 15, match_pattern: 'test', deferred_until: null, category_id: null}),
        });
        const {data: created} = await createRes.json();

        const getRes = await fetch(`${url}/api/v1/bills/${created.id}`, {
            headers: {Cookie: cookie},
        });
        assert.equal(getRes.status, 200);
        const {data: retrieved} = await getRes.json();
        assert.equal(retrieved.id, created.id);
        assert.equal(retrieved.name, 'Get By ID Test Bill');
    } finally {
        await close();
    }
});

test('GET /bills/:id returns 400 when id is not a number', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/bills/not-a-number`, {
            headers: {Cookie: cookie},
        });
        assert.equal(res.status, 400);
    } finally {
        await close();
    }
});

test('GET /bills/:id returns 404 when bill does not exist', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/bills/999999`, {
            headers: {Cookie: cookie},
        });
        assert.equal(res.status, 404);
    } finally {
        await close();
    }
});
