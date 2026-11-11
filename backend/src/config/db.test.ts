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

test('categories table has a color column with a default value', () => {
    db.prepare('INSERT INTO categories (name) VALUES (?)').run('Groceries');

    const row = db.prepare('SELECT * FROM categories WHERE name = ?').get('Groceries') as
        {id: number, name: string, color: string} | undefined;

    assert.ok(row);
    assert.equal(row.color, '#6b9478');
});

test('category_rules table enforces a category_id foreign key and cascades on delete', () => {
    db.prepare('INSERT INTO categories (name, color) VALUES (?, ?)').run('Rule Test Category', '#6b9478');
    const category = db.prepare('SELECT * FROM categories WHERE name = ?').get('Rule Test Category') as {id: number};

    db.prepare('INSERT INTO category_rules (pattern, category_id) VALUES (?, ?)').run('walmart', category.id);
    const rule = db.prepare('SELECT * FROM category_rules WHERE pattern = ?').get('walmart') as
        {id: number, category_id: number} | undefined;
    assert.ok(rule);
    assert.equal(rule.category_id, category.id);

    db.prepare('DELETE FROM categories WHERE id = ?').run(category.id);
    const afterDelete = db.prepare('SELECT * FROM category_rules WHERE pattern = ?').get('walmart');
    assert.equal(afterDelete, undefined);
});
