# Single-User Cookie Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the Financially backend behind a single-password cookie login, so it's safe to deploy somewhere reachable off the user's own machine.

**Architecture:** A `sessions` table (hashed tokens, no `users` table — single user, single password from an env var). Express middleware (`requireAuth`) protects the existing transactions router. A new `/api/v1/auth` router handles login/logout/me. The React frontend gets an `AuthContext`, a `Login` page, and a route guard; `BaseApiService`'s axios instance sends/receives the cookie and redirects to `/login` on a 401.

**Tech Stack:** Express 5, `node:sqlite`, `node:crypto` (scrypt, sha256, randomBytes), `node:test` — no new backend dependencies. React 19, react-router-dom 7, axios — no new frontend dependencies.

## Global Constraints

- No ORM, plain SQL with `?` placeholders (existing convention).
- New tables are `STRICT`, same as `categories`/`bills`/`transactions`.
- API response shape: success `{ data }`, failure `{ error }` (existing convention, `backend/src/controllers/transactions.controller.ts` is the reference).
- No new npm dependencies — this spec was approved specifically to avoid adding `argon2`/`cookie-parser`/etc. Use `node:crypto` and manual cookie-header parsing.
- Every backend file uses the `.ts` extension in its own imports (`allowImportingTsExtensions`), e.g. `import {db} from "../config/db.ts"`.
- Backend runs TypeScript directly via Node 26 (`node --watch src/app.ts`) — no build step, no `tsx`/`ts-node`.

---

### Task 1: Sessions table + overridable DB path

**Files:**
- Modify: `backend/src/config/db.ts`
- Test: `backend/src/config/db.test.ts`

**Interfaces:**
- Produces: `db` (unchanged export, `DatabaseSync` instance) now also has a `sessions` table. `DATABASE_FILE` env var, read once at import time, overrides the DB path (defaults to `'financially.db'`, unchanged behavior when unset).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/config/db.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/config/db.test.ts`
Expected: FAIL — `sessions` table doesn't exist yet (`SqliteError: no such table: sessions`).

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/config/db.ts
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
`)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test src/config/db.test.ts`
Expected: PASS (1 test passing)

- [ ] **Step 5: Commit**

```bash
git add backend/src/config/db.ts backend/src/config/db.test.ts
git commit -m "Add sessions table and overridable DB path for tests"
```

---

### Task 2: Password hashing helper

**Files:**
- Create: `backend/src/helpers/password.ts`
- Test: `backend/src/helpers/password.test.ts`

**Interfaces:**
- Produces: `hashPassword(password: string): string` → `"<saltHex>:<derivedKeyHex>"`. `verifyPassword(password: string, stored: string): boolean`.

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/helpers/password.test.ts
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword, verifyPassword} from './password.ts';

test('verifyPassword accepts the correct password against its own hash', () => {
    const stored = hashPassword('correct horse battery staple');
    assert.equal(verifyPassword('correct horse battery staple', stored), true);
});

test('verifyPassword rejects the wrong password', () => {
    const stored = hashPassword('correct horse battery staple');
    assert.equal(verifyPassword('wrong password', stored), false);
});

test('hashPassword salts each call differently', () => {
    const a = hashPassword('same password');
    const b = hashPassword('same password');
    assert.notEqual(a, b);
});

test('verifyPassword rejects a malformed stored value', () => {
    assert.equal(verifyPassword('anything', 'not-a-valid-stored-hash'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/helpers/password.test.ts`
Expected: FAIL — `password.ts` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/helpers/password.ts
import {randomBytes, scryptSync, timingSafeEqual} from 'node:crypto';

const KEY_LENGTH = 64;

/**
 * Hashes a password with a random salt, for storage in APP_PASSWORD_HASH.
 *
 * @param password The plaintext password to hash.
 * @return A string of the form "<saltHex>:<derivedKeyHex>".
 */
export function hashPassword(password: string): string {
    const salt = randomBytes(16);
    const derivedKey = scryptSync(password, salt, KEY_LENGTH);
    return `${salt.toString('hex')}:${derivedKey.toString('hex')}`;
}

/**
 * Verifies a plaintext password against a hash produced by hashPassword, in constant time.
 *
 * @param password The plaintext password to check.
 * @param stored The "<saltHex>:<derivedKeyHex>" value to check against.
 * @return True if the password matches, false otherwise (including a malformed stored value).
 */
export function verifyPassword(password: string, stored: string): boolean {
    const [saltHex, keyHex] = stored.split(':');

    if (!saltHex || !keyHex) {
        return false;
    }

    const salt = Buffer.from(saltHex, 'hex');
    const storedKey = Buffer.from(keyHex, 'hex');
    const derivedKey = scryptSync(password, salt, KEY_LENGTH);

    if (derivedKey.length !== storedKey.length) {
        return false;
    }

    return timingSafeEqual(derivedKey, storedKey);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test src/helpers/password.test.ts`
Expected: PASS (4 tests passing)

- [ ] **Step 5: Commit**

```bash
git add backend/src/helpers/password.ts backend/src/helpers/password.test.ts
git commit -m "Add scrypt-based password hashing helper"
```

---

### Task 3: Session token helper

**Files:**
- Create: `backend/src/helpers/sessionToken.ts`
- Test: `backend/src/helpers/sessionToken.test.ts`

**Interfaces:**
- Produces: `generateSessionToken(): string` (64 hex chars, random). `hashSessionToken(token: string): string` (sha256 hex digest, deterministic).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/helpers/sessionToken.test.ts
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateSessionToken, hashSessionToken} from './sessionToken.ts';

test('generateSessionToken returns a 64-character hex string', () => {
    const token = generateSessionToken();
    assert.match(token, /^[0-9a-f]{64}$/);
});

test('generateSessionToken returns a different value each call', () => {
    assert.notEqual(generateSessionToken(), generateSessionToken());
});

test('hashSessionToken is deterministic', () => {
    const token = generateSessionToken();
    assert.equal(hashSessionToken(token), hashSessionToken(token));
});

test('hashSessionToken matches a known sha256 vector', () => {
    assert.equal(
        hashSessionToken('abc'),
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'.slice(0, 64)
    );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/helpers/sessionToken.test.ts`
Expected: FAIL — `sessionToken.ts` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/helpers/sessionToken.ts
import {createHash, randomBytes} from 'node:crypto';

/**
 * Generates a random session token to store in the session cookie.
 *
 * @return A 64-character hex string.
 */
export function generateSessionToken(): string {
    return randomBytes(32).toString('hex');
}

/**
 * Hashes a session token for storage, so a leaked DB dump can't be replayed as a live session.
 *
 * @param token The raw session token (from the cookie).
 * @return The sha256 hex digest of the token.
 */
export function hashSessionToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test src/helpers/sessionToken.test.ts`
Expected: PASS (4 tests passing)

- [ ] **Step 5: Commit**

```bash
git add backend/src/helpers/sessionToken.ts backend/src/helpers/sessionToken.test.ts
git commit -m "Add session token generation/hashing helper"
```

---

### Task 4: Cookie header parsing helper

**Files:**
- Create: `backend/src/helpers/cookies.ts`
- Test: `backend/src/helpers/cookies.test.ts`

**Interfaces:**
- Produces: `parseCookieHeader(header: string | undefined): Record<string, string>`.

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/helpers/cookies.test.ts
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCookieHeader} from './cookies.ts';

test('returns an empty object for an undefined header', () => {
    assert.deepEqual(parseCookieHeader(undefined), {});
});

test('parses a single cookie', () => {
    assert.deepEqual(parseCookieHeader('a=1'), {a: '1'});
});

test('parses multiple cookies', () => {
    assert.deepEqual(parseCookieHeader('a=1; b=2'), {a: '1', b: '2'});
});

test('decodes a URL-encoded value', () => {
    assert.deepEqual(parseCookieHeader('a=hello%20world'), {a: 'hello world'});
});

test('preserves a value containing an equals sign', () => {
    assert.deepEqual(parseCookieHeader('a=x=y'), {a: 'x=y'});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/helpers/cookies.test.ts`
Expected: FAIL — `cookies.ts` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/helpers/cookies.ts

/**
 * Parses a raw Cookie request header into a name -> value map.
 *
 * @param header The raw value of req.headers.cookie, if present.
 * @return A map of cookie names to decoded values. Empty if the header is missing.
 */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
    if (!header) {
        return {};
    }

    const cookies: Record<string, string> = {};

    for (const pair of header.split(';')) {
        const [name, ...rest] = pair.trim().split('=');
        if (!name) {
            continue;
        }
        cookies[name] = decodeURIComponent(rest.join('='));
    }

    return cookies;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test src/helpers/cookies.test.ts`
Expected: PASS (5 tests passing)

- [ ] **Step 5: Commit**

```bash
git add backend/src/helpers/cookies.ts backend/src/helpers/cookies.test.ts
git commit -m "Add Cookie header parsing helper"
```

---

### Task 5: Auth config (cookie name, TTL, cookie options)

**Files:**
- Create: `backend/src/config/auth.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `SESSION_COOKIE_NAME: string`, `SESSION_TTL_MS: number`, `sessionCookieOptions(expiresAt: string): { httpOnly: true, secure: boolean, sameSite: 'lax', path: '/', expires: Date }`.

This task has no isolated test — `sessionCookieOptions` is exercised through Task 9's integration tests. It's a small, pure configuration module.

- [ ] **Step 1: Write the implementation**

```typescript
// backend/src/config/auth.ts

export const SESSION_COOKIE_NAME = 'financially_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Builds the cookie options used for both setting and clearing the session cookie.
 * Must stay consistent between res.cookie and res.clearCookie calls, or the browser
 * will keep the old cookie around.
 *
 * @param expiresAt ISO datetime string for the cookie's expiry.
 */
export function sessionCookieOptions(expiresAt: string) {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax' as const,
        path: '/',
        expires: new Date(expiresAt),
    };
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/config/auth.ts
git commit -m "Add session cookie configuration"
```

---

### Task 6: Session service

**Files:**
- Create: `backend/src/services/session.service.ts`
- Test: `backend/src/services/session.service.test.ts`

**Interfaces:**
- Consumes: `db` from `../config/db.ts`, `generateSessionToken`/`hashSessionToken` from `../helpers/sessionToken.ts`, `SESSION_TTL_MS` from `../config/auth.ts`.
- Produces: `class SessionService` with `createSession(): {token: string, expiresAt: string}`, `getValidSession(token: string): {id: string, expires_at: string, created_at: string} | undefined`, `refreshSession(id: string): string` (returns new `expiresAt`), `deleteSession(token: string): void`. Exported singleton `sessionService`.

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/services/session.service.test.ts
import {test} from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_FILE = ':memory:';
const {db} = await import('../config/db.ts');
const {SessionService} = await import('./session.service.ts');

const sessionService = new SessionService();

test('createSession returns a token and a future expiry', () => {
    const {token, expiresAt} = sessionService.createSession();
    assert.match(token, /^[0-9a-f]{64}$/);
    assert.ok(new Date(expiresAt).getTime() > Date.now());
});

test('getValidSession finds a freshly created session by its token', () => {
    const {token} = sessionService.createSession();
    const session = sessionService.getValidSession(token);
    assert.ok(session);
});

test('getValidSession returns undefined for an unknown token', () => {
    assert.equal(sessionService.getValidSession('does-not-exist'), undefined);
});

test('getValidSession returns undefined for an expired session', () => {
    const {token} = sessionService.createSession();
    const session = sessionService.getValidSession(token)!;
    db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
        .run('2000-01-01T00:00:00.000Z', session.id);

    assert.equal(sessionService.getValidSession(token), undefined);
});

test('refreshSession pushes expires_at into the future', () => {
    const {token} = sessionService.createSession();
    const session = sessionService.getValidSession(token)!;
    const originalExpiry = session.expires_at;

    const refreshedExpiry = sessionService.refreshSession(session.id);

    assert.ok(new Date(refreshedExpiry).getTime() >= new Date(originalExpiry).getTime());
});

test('deleteSession removes the row', () => {
    const {token} = sessionService.createSession();
    sessionService.deleteSession(token);
    assert.equal(sessionService.getValidSession(token), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/services/session.service.test.ts`
Expected: FAIL — `session.service.ts` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/services/session.service.ts
import {db} from "../config/db.ts";
import {generateSessionToken, hashSessionToken} from "../helpers/sessionToken.ts";
import {SESSION_TTL_MS} from "../config/auth.ts";

export type Session = {
    id: string;
    expires_at: string;
    created_at: string;
}

export class SessionService {
    /**
     * Creates a new session row and returns the raw token to put in the cookie.
     *
     * @return The raw token (never stored) and its expiry.
     */
    createSession(): {token: string, expiresAt: string} {
        const token = generateSessionToken();
        const id = hashSessionToken(token);
        const now = new Date();
        const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

        db.prepare('INSERT INTO sessions (id, expires_at, created_at) VALUES (?, ?, ?)')
            .run(id, expiresAt, now.toISOString());

        return {token, expiresAt};
    }

    /**
     * Looks up a session by its raw token, treating an expired session as not found.
     *
     * @param token The raw token from the session cookie.
     * @return The session row, or undefined if it doesn't exist or has expired.
     */
    getValidSession(token: string): Session | undefined {
        const id = hashSessionToken(token);
        const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | undefined;

        if (!session || session.expires_at <= new Date().toISOString()) {
            return undefined;
        }

        return session;
    }

    /**
     * Pushes a session's expiry forward (sliding expiry), by its row id.
     *
     * @param id The session's id (the hashed token), as returned by getValidSession.
     * @return The new expiry.
     */
    refreshSession(id: string): string {
        const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
        db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(expiresAt, id);
        return expiresAt;
    }

    /**
     * Deletes a session by its raw token.
     *
     * @param token The raw token from the session cookie.
     */
    deleteSession(token: string): void {
        const id = hashSessionToken(token);
        db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    }
}

export const sessionService = new SessionService();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test src/services/session.service.test.ts`
Expected: PASS (6 tests passing)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/session.service.ts backend/src/services/session.service.test.ts
git commit -m "Add SessionService"
```

---

### Task 7: requireAuth middleware

**Files:**
- Create: `backend/src/middleware/requireAuth.ts`
- Test: `backend/src/middleware/requireAuth.test.ts`

**Interfaces:**
- Consumes: `parseCookieHeader` from `../helpers/cookies.ts`, `SESSION_COOKIE_NAME` from `../config/auth.ts`, `sessionService` from `../services/session.service.ts`.
- Produces: `requireAuth(req: Request, res: Response, next: NextFunction): void` — Express middleware.

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/middleware/requireAuth.test.ts
import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Request, Response} from 'express';

process.env.DATABASE_FILE = ':memory:';
const {sessionService} = await import('../services/session.service.ts');
const {requireAuth} = await import('./requireAuth.ts');
const {SESSION_COOKIE_NAME} = await import('../config/auth.ts');

function fakeResponse() {
    const res = {
        statusCode: 200,
        body: undefined as unknown,
        status(code: number) { this.statusCode = code; return this; },
        json(body: unknown) { this.body = body; return this; },
    };
    return res;
}

test('rejects a request with no cookie', () => {
    const req = {headers: {}} as Request;
    const res = fakeResponse();
    let nextCalled = false;

    requireAuth(req, res as unknown as Response, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
});

test('rejects a request with an unknown session token', () => {
    const req = {headers: {cookie: `${SESSION_COOKIE_NAME}=not-a-real-token`}} as Request;
    const res = fakeResponse();
    let nextCalled = false;

    requireAuth(req, res as unknown as Response, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
});

test('calls next for a request with a valid session token', () => {
    const {token} = sessionService.createSession();
    const req = {headers: {cookie: `${SESSION_COOKIE_NAME}=${token}`}} as Request;
    const res = fakeResponse();
    let nextCalled = false;

    requireAuth(req, res as unknown as Response, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/middleware/requireAuth.test.ts`
Expected: FAIL — `requireAuth.ts` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/middleware/requireAuth.ts
import type {NextFunction, Request, Response} from 'express';
import {parseCookieHeader} from '../helpers/cookies.ts';
import {SESSION_COOKIE_NAME} from '../config/auth.ts';
import {sessionService} from '../services/session.service.ts';

/**
 * Rejects a request with 401 unless it carries a valid session cookie.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
    const token = parseCookieHeader(req.headers.cookie)[SESSION_COOKIE_NAME];

    if (!token) {
        return res.status(401).json({error: 'Not authenticated'});
    }

    const session = sessionService.getValidSession(token);

    if (!session) {
        return res.status(401).json({error: 'Not authenticated'});
    }

    next();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test src/middleware/requireAuth.test.ts`
Expected: PASS (3 tests passing)

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/requireAuth.ts backend/src/middleware/requireAuth.test.ts
git commit -m "Add requireAuth middleware"
```

---

### Task 8: Login rate limiter middleware

**Files:**
- Create: `backend/src/middleware/loginRateLimiter.ts`
- Test: `backend/src/middleware/loginRateLimiter.test.ts`

**Interfaces:**
- Produces: `loginRateLimiter(req: Request, res: Response, next: NextFunction): void` — Express middleware, 5 requests per IP per 15-minute window, `429` past that.

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/middleware/loginRateLimiter.test.ts
import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Request, Response} from 'express';
import {loginRateLimiter} from './loginRateLimiter.ts';

function fakeResponse() {
    const res = {
        statusCode: 200,
        body: undefined as unknown,
        status(code: number) { this.statusCode = code; return this; },
        json(body: unknown) { this.body = body; return this; },
    };
    return res;
}

function callOnce(ip: string) {
    const req = {ip} as Request;
    const res = fakeResponse();
    let nextCalled = false;
    loginRateLimiter(req, res as unknown as Response, () => { nextCalled = true; });
    return {nextCalled, statusCode: res.statusCode};
}

test('allows 5 attempts from the same IP then blocks the 6th', () => {
    const ip = '203.0.113.5';

    for (let i = 0; i < 5; i++) {
        const result = callOnce(ip);
        assert.equal(result.nextCalled, true, `attempt ${i + 1} should pass through`);
    }

    const sixth = callOnce(ip);
    assert.equal(sixth.nextCalled, false);
    assert.equal(sixth.statusCode, 429);
});

test('tracks IPs independently', () => {
    for (let i = 0; i < 5; i++) {
        callOnce('203.0.113.10');
    }
    const otherIp = callOnce('203.0.113.11');
    assert.equal(otherIp.nextCalled, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/middleware/loginRateLimiter.test.ts`
Expected: FAIL — `loginRateLimiter.ts` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/middleware/loginRateLimiter.ts
import type {NextFunction, Request, Response} from 'express';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const attempts = new Map<string, {count: number, resetAt: number}>();

/**
 * Limits login attempts per IP: 5 per 15-minute window, 429 past that.
 * A single-password app is a much more attractive brute-force target than a
 * multi-user login, so this matters more here than it would elsewhere.
 */
export function loginRateLimiter(req: Request, res: Response, next: NextFunction) {
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    const entry = attempts.get(ip);

    if (!entry || entry.resetAt <= now) {
        attempts.set(ip, {count: 1, resetAt: now + WINDOW_MS});
        return next();
    }

    if (entry.count >= MAX_ATTEMPTS) {
        return res.status(429).json({error: 'Too many login attempts. Try again later.'});
    }

    entry.count += 1;
    next();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test src/middleware/loginRateLimiter.test.ts`
Expected: PASS (2 tests passing)

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/loginRateLimiter.ts backend/src/middleware/loginRateLimiter.test.ts
git commit -m "Add login rate limiter middleware"
```

---

### Task 9: Auth controller, router, and app wiring

**Files:**
- Create: `backend/src/controllers/auth.controller.ts`
- Create: `backend/src/routes/auth.router.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/src/app.test.ts`

**Interfaces:**
- Consumes: `verifyPassword` from `../helpers/password.ts`, `parseCookieHeader` from `../helpers/cookies.ts`, `SESSION_COOKIE_NAME`/`sessionCookieOptions` from `../config/auth.ts`, `sessionService` from `../services/session.service.ts`, `loginRateLimiter` from `../middleware/loginRateLimiter.ts`, `requireAuth` from `../middleware/requireAuth.ts`.
- Produces: `authRouter` (Express Router) mounted at `/api/v1/auth`. `app` is now the default export of `app.ts` (previously it had no export and called `app.listen` unconditionally).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/app.test.ts
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword} from './helpers/password.ts';

process.env.DATABASE_FILE = ':memory:';
process.env.APP_PASSWORD_HASH = hashPassword('correct-password');

const {default: app} = await import('./app.ts');

function listen(): Promise<{url: string, close: () => Promise<void>}> {
    return new Promise((resolve) => {
        const server = app.listen(0, () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            resolve({
                url: `http://127.0.0.1:${port}`,
                close: () => new Promise((r) => server.close(() => r())),
            });
        });
    });
}

test('login with the wrong password returns 401', async () => {
    const {url, close} = await listen();
    try {
        const res = await fetch(`${url}/api/v1/auth/login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({password: 'wrong-password'}),
        });
        assert.equal(res.status, 401);
    } finally {
        await close();
    }
});

test('login with a missing password returns 400', async () => {
    const {url, close} = await listen();
    try {
        const res = await fetch(`${url}/api/v1/auth/login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({}),
        });
        assert.equal(res.status, 400);
    } finally {
        await close();
    }
});

test('login with the correct password sets a cookie that /me accepts', async () => {
    const {url, close} = await listen();
    try {
        const loginRes = await fetch(`${url}/api/v1/auth/login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({password: 'correct-password'}),
        });
        assert.equal(loginRes.status, 200);
        const cookie = loginRes.headers.get('set-cookie');
        assert.ok(cookie, 'expected a Set-Cookie header');

        const meRes = await fetch(`${url}/api/v1/auth/me`, {
            headers: {Cookie: cookie!.split(';')[0]},
        });
        assert.equal(meRes.status, 200);
    } finally {
        await close();
    }
});

test('/api/v1/transactions requires authentication', async () => {
    const {url, close} = await listen();
    try {
        const res = await fetch(`${url}/api/v1/transactions`);
        assert.equal(res.status, 401);
    } finally {
        await close();
    }
});

test('logout clears the session so a later /me call is unauthenticated', async () => {
    const {url, close} = await listen();
    try {
        const loginRes = await fetch(`${url}/api/v1/auth/login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({password: 'correct-password'}),
        });
        const cookie = loginRes.headers.get('set-cookie')!.split(';')[0];

        const logoutRes = await fetch(`${url}/api/v1/auth/logout`, {
            method: 'POST',
            headers: {Cookie: cookie},
        });
        assert.equal(logoutRes.status, 204);

        const meRes = await fetch(`${url}/api/v1/auth/me`, {headers: {Cookie: cookie}});
        assert.equal(meRes.status, 401);
    } finally {
        await close();
    }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/app.test.ts`
Expected: FAIL — `auth.controller.ts`/`auth.router.ts` don't exist, and `app.ts` has no default export.

- [ ] **Step 3: Write the controller**

```typescript
// backend/src/controllers/auth.controller.ts
import type {Request, Response} from 'express';
import {verifyPassword} from '../helpers/password.ts';
import {parseCookieHeader} from '../helpers/cookies.ts';
import {SESSION_COOKIE_NAME, sessionCookieOptions} from '../config/auth.ts';
import {sessionService} from '../services/session.service.ts';

/**
 * Checks the submitted password against APP_PASSWORD_HASH and, on a match,
 * starts a new session and sets its cookie.
 */
export function login(req: Request, res: Response) {
    const {password} = req.body ?? {};

    if (typeof password !== 'string' || password.length === 0) {
        return res.status(400).json({error: 'password is required'});
    }

    const hash = process.env.APP_PASSWORD_HASH;

    if (!hash) {
        return res.status(500).json({error: 'Auth is not configured'});
    }

    if (!verifyPassword(password, hash)) {
        return res.status(401).json({error: 'Invalid password'});
    }

    const {token, expiresAt} = sessionService.createSession();
    res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions(expiresAt));
    return res.status(200).json({data: {authenticated: true}});
}

/**
 * Deletes the current session (if any) and clears the cookie.
 */
export function logout(req: Request, res: Response) {
    const token = parseCookieHeader(req.headers.cookie)[SESSION_COOKIE_NAME];

    if (token) {
        sessionService.deleteSession(token);
    }

    res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions(new Date().toISOString()));
    return res.status(204).end();
}

/**
 * Reports whether the request carries a valid session, refreshing its expiry if so.
 */
export function me(req: Request, res: Response) {
    const token = parseCookieHeader(req.headers.cookie)[SESSION_COOKIE_NAME];

    if (!token) {
        return res.status(401).json({error: 'Not authenticated'});
    }

    const session = sessionService.getValidSession(token);

    if (!session) {
        return res.status(401).json({error: 'Not authenticated'});
    }

    const expiresAt = sessionService.refreshSession(session.id);
    res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions(expiresAt));
    return res.status(200).json({data: {authenticated: true}});
}
```

- [ ] **Step 4: Write the router**

```typescript
// backend/src/routes/auth.router.ts
import express from 'express';
import {login, logout, me} from '../controllers/auth.controller.ts';
import {loginRateLimiter} from '../middleware/loginRateLimiter.ts';

export const authRouter = express.Router();

authRouter.post('/login', loginRateLimiter, login);
authRouter.post('/logout', logout);
authRouter.get('/me', me);
```

- [ ] **Step 5: Wire into app.ts and export the app for testing**

```typescript
// backend/src/app.ts
import express, {type Request, type Response} from 'express';
import {fileURLToPath} from 'node:url';
import {transactionsRouter} from './routes/transactions.router.ts'
import {authRouter} from './routes/auth.router.ts'
import {requireAuth} from './middleware/requireAuth.ts'

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Routes
app.use('/api/v1/auth', authRouter)
app.use('/api/v1/transactions', requireAuth, transactionsRouter)

app.get('/', (req: Request, res: Response) => {
  res.send('Hello, World!');
});

// Only start listening when this file is run directly (e.g. `node src/app.ts`),
// not when a test imports it to get the `app` instance.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}

export default app;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && node --test src/app.test.ts`
Expected: PASS (5 tests passing)

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/auth.controller.ts backend/src/routes/auth.router.ts backend/src/app.ts backend/src/app.test.ts
git commit -m "Add auth routes and gate transactions behind requireAuth"
```

---

### Task 10: Password-hashing CLI script, env setup, and dev script

**Files:**
- Create: `backend/src/scripts/hashPassword.ts`
- Create: `backend/.env.example`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `hashPassword` from `../helpers/password.ts` (already tested in Task 2).
- Produces: a one-time CLI command that prints a value to paste into `.env`. No new exported functions (the script is the deliverable).

- [ ] **Step 1: Write the script**

```typescript
// backend/src/scripts/hashPassword.ts
import {hashPassword} from '../helpers/password.ts';

const password = process.argv[2];

if (!password) {
    console.error('Usage: npm run hash-password -- "your password"');
    process.exit(1);
}

console.log(`APP_PASSWORD_HASH=${hashPassword(password)}`);
```

- [ ] **Step 2: Add the env example file**

```
# backend/.env.example
# Generate with: npm run hash-password -- "your password"
APP_PASSWORD_HASH=

# Set to "production" when deployed, so the session cookie gets the Secure flag.
NODE_ENV=development
```

- [ ] **Step 3: Add scripts to package.json**

Modify `backend/package.json`'s `scripts` block:

```json
{
  "scripts": {
    "dev": "node --watch --env-file-if-exists=.env src/app.ts",
    "test": "node --test",
    "hash-password": "node src/scripts/hashPassword.ts"
  }
}
```

(The `dev` script previously didn't load `.env` at all — `--env-file-if-exists=.env` is required for `APP_PASSWORD_HASH` to actually reach `process.env` when running locally.)

- [ ] **Step 4: Verify manually**

Run: `cd backend && npm run hash-password -- "test-password-123"`
Expected output: a line like `APP_PASSWORD_HASH=3f2a...:9c1b...` (hex salt, colon, hex key — exact hex values differ each run since the salt is random).

Then create `backend/.env` (gitignored already, confirmed via the repo's `.gitignore`) with that line plus `NODE_ENV=development`, and run `cd backend && npm run dev`. Confirm the server starts without errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/scripts/hashPassword.ts backend/.env.example backend/package.json
git commit -m "Add password-hashing CLI script and wire .env loading into dev script"
```

(Do not `git add backend/.env` — it's gitignored and must never be committed.)

- [ ] **Step 6: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: all tests from Tasks 1–9 pass (PASS, 0 fail).

---

### Task 11: BaseApiService — cookies + session-expiry redirect

**Files:**
- Modify: `frontend/src/services/BaseApiService.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `BaseApiService`'s `http` instance now sends credentials (cookies) and redirects to `/login` on any `401` it receives (used by every existing subclass — `TransactionApiService` — unchanged otherwise).

- [ ] **Step 1: Add withCredentials and a 401 interceptor**

```typescript
// frontend/src/services/BaseApiService.ts
import axios, {type AxiosInstance, type AxiosRequestConfig} from "axios";
import type {ApiErrorBody, ApiResponse, IBaseApiService} from "../types/api.ts";

export abstract class BaseApiService implements IBaseApiService {
    protected readonly http: AxiosInstance = axios.create({
        baseURL: import.meta.env.VITE_BASE_API_URL,
        withCredentials: true,
    })
    protected readonly path: string;

    constructor(path: string) {
        this.path = path;
        this.http.interceptors.response.use(
            (response) => response,
            (error) => {
                if (
                    axios.isAxiosError(error) &&
                    error.response?.status === 401 &&
                    window.location.pathname !== '/login'
                ) {
                    window.location.assign('/login');
                }
                return Promise.reject(error);
            }
        )
    }

    // ... rest of the class is unchanged (getAll, getById, create, update, delete, #request, #send)
```

Leave every other method in the file exactly as-is — only the `http` field initializer (added `withCredentials: true`) and the constructor body (added the interceptor) change.

- [ ] **Step 2: Verify manually**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output (clean type-check).

This task has no automated test — the project has no frontend test framework yet, and the behavior (redirect on session expiry) is verified end-to-end in Task 17.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/services/BaseApiService.ts
git commit -m "Send cookies on API requests and redirect to /login on 401"
```

---

### Task 12: AuthApiService

**Files:**
- Create: `frontend/src/services/AuthApiService.ts`

**Interfaces:**
- Produces: `class AuthApiService` with `login(password: string): Promise<void>`, `logout(): Promise<void>`, `me(): Promise<boolean>`. Exported singleton `authApiService`.

This is a small standalone class rather than a `BaseApiService` subclass: `BaseApiService`'s CRUD-shaped methods (`getAll`/`getById`/`create`/`update`/`delete`) don't map onto three bespoke, differently-shaped endpoints (`/auth/login`, `/auth/logout`, `/auth/me`) under one path — forcing that shape on would be worse than a few duplicated lines.

- [ ] **Step 1: Write the implementation**

```typescript
// frontend/src/services/AuthApiService.ts
import axios, {type AxiosInstance} from "axios";
import type {ApiErrorBody} from "../types/api.ts";

export class AuthApiService {
    private readonly http: AxiosInstance = axios.create({
        baseURL: import.meta.env.VITE_BASE_API_URL,
        withCredentials: true,
    })

    /**
     * Logs in with the app password. Throws if the password is wrong.
     */
    async login(password: string): Promise<void> {
        await this.#send(() => this.http.post('/auth/login', {password}));
    }

    /**
     * Logs out, clearing the session on the server and the cookie in the browser.
     */
    async logout(): Promise<void> {
        await this.#send(() => this.http.post('/auth/logout'));
    }

    /**
     * Checks whether the current session cookie (if any) is still valid.
     *
     * @return True if authenticated, false otherwise — never throws.
     */
    async me(): Promise<boolean> {
        try {
            await this.http.get('/auth/me');
            return true;
        } catch {
            return false;
        }
    }

    async #send(request: () => Promise<unknown>): Promise<void> {
        try {
            await request();
        } catch (error) {
            if (axios.isAxiosError<ApiErrorBody>(error)) {
                throw new Error(error.response?.data?.error ?? error.message, {cause: error});
            }
            throw error;
        }
    }
}

export const authApiService = new AuthApiService();
```

- [ ] **Step 2: Verify manually**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output (clean type-check).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/services/AuthApiService.ts
git commit -m "Add AuthApiService"
```

---

### Task 13: AuthContext and useAuth hook

**Files:**
- Create: `frontend/src/auth/AuthContext.tsx`

**Interfaces:**
- Consumes: `authApiService` from `../services/AuthApiService.ts`.
- Produces: `AuthProvider` (component, wraps children), `useAuth(): {authenticated: boolean, loading: boolean, login: (password: string) => Promise<void>, logout: () => Promise<void>}`.

- [ ] **Step 1: Write the implementation**

```typescript
// frontend/src/auth/AuthContext.tsx
import {createContext, useContext, useEffect, useState, type ReactNode} from "react";
import {authApiService} from "../services/AuthApiService.ts";

type AuthState = {
    authenticated: boolean;
    loading: boolean;
    login: (password: string) => Promise<void>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({children}: {children: ReactNode}) {
    const [authenticated, setAuthenticated] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        authApiService.me()
            .then(setAuthenticated)
            .finally(() => setLoading(false));
    }, []);

    async function login(password: string) {
        await authApiService.login(password);
        setAuthenticated(true);
    }

    async function logout() {
        await authApiService.logout();
        setAuthenticated(false);
    }

    return (
        <AuthContext.Provider value={{authenticated, loading, login, logout}}>
            {children}
        </AuthContext.Provider>
    )
}

/**
 * @throws Error if called outside an AuthProvider.
 */
export function useAuth(): AuthState {
    const ctx = useContext(AuthContext);

    if (!ctx) {
        throw new Error('useAuth must be used within an AuthProvider');
    }

    return ctx;
}
```

- [ ] **Step 2: Verify manually**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output (clean type-check). (`AuthProvider` isn't wired into `main.tsx` until Task 16, so it isn't reachable yet — this step just confirms the file itself compiles.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/auth/AuthContext.tsx
git commit -m "Add AuthContext and useAuth hook"
```

---

### Task 14: RequireAuth route guard

**Files:**
- Create: `frontend/src/auth/RequireAuth.tsx`

**Interfaces:**
- Consumes: `useAuth` from `./AuthContext.tsx`.
- Produces: `RequireAuth` — a route-element component rendering `<Outlet/>` when authenticated, redirecting to `/login` otherwise, rendering nothing while the initial `/me` check is in flight.

- [ ] **Step 1: Write the implementation**

```typescript
// frontend/src/auth/RequireAuth.tsx
import {Navigate, Outlet} from "react-router-dom";
import {useAuth} from "./AuthContext.tsx";

function RequireAuth() {
    const {authenticated, loading} = useAuth();

    if (loading) {
        return null;
    }

    if (!authenticated) {
        return <Navigate to="/login" replace/>;
    }

    return <Outlet/>;
}

export default RequireAuth
```

- [ ] **Step 2: Verify manually**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output (clean type-check).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/auth/RequireAuth.tsx
git commit -m "Add RequireAuth route guard"
```

---

### Task 15: Login page

**Files:**
- Create: `frontend/src/auth/Login.tsx`
- Create: `frontend/src/auth/Login.css`

**Interfaces:**
- Consumes: `useAuth` from `./AuthContext.tsx`, `useNavigate` from `react-router-dom`.
- Produces: `Login` — default export, a route element (no props).

- [ ] **Step 1: Write the component**

```typescript
// frontend/src/auth/Login.tsx
import {useState, type FormEvent} from "react";
import {useNavigate} from "react-router-dom";
import {useAuth} from "./AuthContext.tsx";
import './Login.css'

function Login() {
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const {login} = useAuth();
    const navigate = useNavigate();

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setSubmitting(true);
        setError(null);

        try {
            await login(password);
            navigate('/');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="login-shell">
            <form className="login-card" onSubmit={handleSubmit}>
                <span className="login-wordmark">Financially</span>
                <label className="login-field">
                    <span>Password</span>
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoFocus
                        required
                    />
                </label>
                {error && <p className="login-error">{error}</p>}
                <button type="submit" disabled={submitting}>
                    {submitting ? 'Checking…' : 'Log in'}
                </button>
            </form>
        </div>
    )
}

export default Login
```

- [ ] **Step 2: Write the styles**

```css
/* frontend/src/auth/Login.css */
.login-shell {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}

.login-card {
  width: 100%;
  max-width: 320px;
  background: var(--paper);
  color: var(--text-on-paper);
  border-radius: 6px;
  padding: 2rem 1.75rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.login-wordmark {
  font-family: var(--display);
  font-style: italic;
  font-weight: 500;
  font-size: 1.5rem;
  text-align: center;
}

.login-field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-family: var(--mono);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-on-paper-dim);
}

.login-field input {
  font-family: var(--sans);
  font-size: 1rem;
  text-transform: none;
  letter-spacing: normal;
  color: var(--text-on-paper);
  background: #fff;
  border: 1px solid var(--rule-on-paper);
  border-radius: 4px;
  padding: 0.55rem 0.7rem;
}

.login-field input:focus-visible {
  outline: 2px solid var(--due);
  outline-offset: 2px;
}

.login-error {
  font-family: var(--sans);
  font-size: 0.85rem;
  color: var(--debit-dim);
}

.login-card button {
  font-family: var(--sans);
  font-weight: 600;
  font-size: 0.95rem;
  background: var(--ink);
  color: var(--text-on-ink-strong);
  border: none;
  border-radius: 4px;
  padding: 0.65rem;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.login-card button:hover {
  opacity: 0.85;
}

.login-card button:disabled {
  opacity: 0.6;
  cursor: default;
}

.login-card button:focus-visible {
  outline: 2px solid var(--due);
  outline-offset: 2px;
}
```

- [ ] **Step 3: Verify manually**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output (clean type-check). (Not reachable in the browser until Task 16 wires the route.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/auth/Login.tsx frontend/src/auth/Login.css
git commit -m "Add Login page"
```

---

### Task 16: Wire routing — AuthProvider, /login route, RequireAuth guard

**Files:**
- Modify: `frontend/src/main.tsx`

**Interfaces:**
- Consumes: `AuthProvider` from `./auth/AuthContext.tsx`, `RequireAuth` from `./auth/RequireAuth.tsx`, `Login` from `./auth/Login.tsx`.

- [ ] **Step 1: Restructure the routes**

```typescript
// frontend/src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import '@fontsource/fraunces/400.css'
import '@fontsource/fraunces/500.css'
import '@fontsource/fraunces/400-italic.css'
import '@fontsource/fraunces/500-italic.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './index.css'
import { AuthProvider } from './auth/AuthContext.tsx'
import RequireAuth from './auth/RequireAuth.tsx'
import Login from './auth/Login.tsx'
import Layout from './Layout.tsx'
import App from './App.tsx'
import Transactions from './transactions/Transactions.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login/>}/>
          <Route element={<RequireAuth/>}>
            <Route element={<Layout/>}>
              <Route path="/" element={<App/>}/>
              <Route path="/transactions" element={<Transactions/>}/>
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
```

- [ ] **Step 2: Verify manually**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output (clean type-check).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/main.tsx
git commit -m "Wire AuthProvider and route guard into the router"
```

---

### Task 17: Logout button in Layout

**Files:**
- Modify: `frontend/src/Layout.tsx`
- Modify: `frontend/src/Layout.css`

**Interfaces:**
- Consumes: `useAuth` from `./auth/AuthContext.tsx`, `useNavigate` from `react-router-dom`.

- [ ] **Step 1: Add the logout control**

```typescript
// frontend/src/Layout.tsx
import {NavLink, Outlet, useNavigate} from "react-router-dom";
import {useAuth} from "./auth/AuthContext.tsx";
import './Layout.css'

function navClass({isActive}: {isActive: boolean}) {
    return isActive ? 'tape-nav__link active' : 'tape-nav__link'
}

function Layout() {
    const {logout} = useAuth();
    const navigate = useNavigate();

    async function handleLogout() {
        await logout();
        navigate('/login');
    }

    return (
        <div className="ledger-shell">
            <header className="ledger-tape">
                <NavLink to="/" className="wordmark">Financially</NavLink>
                <nav className="tape-nav" aria-label="Primary">
                    <NavLink to="/" end className={navClass}>Dashboard</NavLink>
                    <NavLink to="/transactions" className={navClass}>Transactions</NavLink>
                </nav>
                <button type="button" className="logout-button" onClick={handleLogout}>
                    Log out
                </button>
            </header>
            <main>
                <Outlet/>
            </main>
        </div>
    )
}

export default Layout
```

- [ ] **Step 2: Add its styling**

Append to `frontend/src/Layout.css`:

```css
.logout-button {
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-on-ink);
  background: none;
  padding: 0.3rem 0.65rem;
  border: 1px solid var(--rule-on-ink);
  border-radius: 999px;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.logout-button:hover {
  color: var(--text-on-ink-strong);
  border-color: var(--text-on-ink);
}

.logout-button:focus-visible {
  outline: 2px solid var(--due);
  outline-offset: 2px;
}
```

- [ ] **Step 3: Verify manually**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output (clean type-check).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/Layout.tsx frontend/src/Layout.css
git commit -m "Add logout button to the nav"
```

---

### Task 18: End-to-end manual verification

**Files:** none (verification only).

- [ ] **Step 1: Start both servers**

Run: `cd backend && npm run dev` (confirm `backend/.env` exists with `APP_PASSWORD_HASH` from Task 10, and `NODE_ENV=development`)
Run (separate terminal): `cd frontend && npm run dev`

- [ ] **Step 2: Confirm the guard redirects when logged out**

In a browser, visit `http://localhost:5173/transactions` directly. Expected: redirected to `/login` (not the transactions page).

- [ ] **Step 3: Confirm a wrong password shows an inline error, not a redirect loop**

On the login page, submit an incorrect password. Expected: an inline error message ("Invalid password"), page stays on `/login`, no full page reload.

- [ ] **Step 4: Confirm a correct password logs in**

Submit the correct password (the one hashed in Task 10). Expected: redirected to `/` (Dashboard), nav shows "Log out".

- [ ] **Step 5: Confirm the session survives a refresh**

Reload the page. Expected: still on the Dashboard, not bounced to `/login` (confirms the cookie + `GET /me` loading-gate works, per the spec's "flash of login screen" concern).

- [ ] **Step 6: Confirm logout works**

Click "Log out". Expected: redirected to `/login`; visiting `/transactions` again afterward redirects back to `/login`.

- [ ] **Step 7: Confirm the rate limiter**

Submit 6 wrong passwords in a row quickly. Expected: the 6th attempt returns a "Too many login attempts" error instead of "Invalid password" (check the Network tab for a `429`).

- [ ] **Step 8: Run both test suites one more time**

Run: `cd backend && npm test`
Expected: all tests passing.

Run: `cd frontend && npx tsc --noEmit`
Expected: no output.

No commit for this task — it's verification only, confirming Tasks 1–17 work together.
