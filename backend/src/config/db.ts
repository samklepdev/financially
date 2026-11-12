import {DatabaseSync} from 'node:sqlite'

const DB_PATH = process.env.DATABASE_FILE ?? 'financially.db';

export const db = new DatabaseSync(DB_PATH);

db.exec(`
    PRAGMA foreign_keys = ON;
    
    CREATE TABLE IF NOT EXISTS categories(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
    ) STRICT;
    
    CREATE TABLE IF NOT EXISTS bills(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31)
    ) STRICT;
    
    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        description TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        category_id INTEGER,
        bill_id INTEGER,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
        FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE SET NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS category_rules(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern TEXT NOT NULL,
        category_id INTEGER NOT NULL,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    ) STRICT;
`)

// SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so guard it by
// checking the column list first — this runs every process start, but only
// ever ALTERs once per database file.
const categoryColumns = db.prepare("SELECT name FROM pragma_table_info('categories')").all() as {name: string}[];
if (!categoryColumns.some((c) => c.name === 'color')) {
    db.exec(`ALTER TABLE categories ADD COLUMN color TEXT NOT NULL DEFAULT '#6b9478'`);
}

const billColumns = db.prepare("SELECT name FROM pragma_table_info('bills')").all() as {name: string}[];
if (!billColumns.some((c) => c.name === 'match_pattern')) {
    db.exec(`ALTER TABLE bills ADD COLUMN match_pattern TEXT NOT NULL DEFAULT ''`);
}
if (!billColumns.some((c) => c.name === 'deferred_until')) {
    db.exec(`ALTER TABLE bills ADD COLUMN deferred_until TEXT`);
}
if (!billColumns.some((c) => c.name === 'category_id')) {
    db.exec(`ALTER TABLE bills ADD COLUMN category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL`);
}
if (!billColumns.some((c) => c.name === 'marked_paid_for')) {
    db.exec(`ALTER TABLE bills ADD COLUMN marked_paid_for TEXT`);
}

