import {test} from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_FILE = ':memory:';
const {db} = await import('./db.ts');

test('sessions table accepts an insert and round-trips it', () => {
    db.prepare('INSERT INTO sessions (id, expires_at, created_at) VALUES (?, ?, ?)')
        .run('abc123', '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get('abc123') as
        {id: string, expires_at: string, created_at: string} | undefined;

    assert.ok(row);
    assert.equal(row.id, 'abc123');
    assert.equal(row.expires_at, '2099-01-01T00:00:00.000Z');
});
