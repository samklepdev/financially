# Single-user cookie auth — design

**Status:** approved, ready for implementation plan
**Context:** Financially is about to be deployed somewhere reachable from outside
the user's own machine (see the separate deploy spec/plan, written after this
one). Today the Express backend has no authentication at all — any route is
open to anyone who can reach the URL. This spec adds a login gate before that
happens.

## Scope

Single user, single password. No registration flow, no `users` table, no
`user_id` on any existing row. This is the session half of the pattern recorded
in the agent wiki's "HTTP-only Cookie Auth" note (built for LIAH Learning,
multi-user + Drizzle/Postgres), stripped down for one person and adapted to
raw SQL + `node:sqlite`.

Out of scope for this spec (tracked as "not done", not forgotten):
- CSRF double-submit tokens (beyond `sameSite: 'lax'`)
- A periodic expired-session sweep job
- Revoking individual sessions by id (realistically there's one session at a time)
- Any multi-user concept, ever, unless the project's goals change

## Schema

One new table, following the existing conventions (`STRICT`, no ORM, plain SQL):

```sql
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,        -- sha256(token), hex
    expires_at TEXT NOT NULL,   -- ISO datetime
    created_at TEXT NOT NULL
) STRICT;
```

The cookie holds a random 32-byte token (`crypto.randomBytes(32).toString('hex')`).
Only the SHA-256 hash of that token is ever stored, so a leaked DB dump can't be
replayed as a live session.

## Password storage

`APP_PASSWORD_HASH` lives in `.env`, in the form `salt:hash` (both hex), produced
by a one-time CLI script — never typed into the running app as plaintext apart
from that script's own argv.

`backend/src/scripts/hashPassword.ts`:
- reads the password from `process.argv[2]`
- generates a random 16-byte salt
- derives a key with `crypto.scrypt(password, salt, 64)`
- prints `APP_PASSWORD_HASH=<salt_hex>:<derivedKey_hex>` to stdout, ready to paste
  into `.env`
- run via `npm run hash-password -- "your password"` (add the script to
  `backend/package.json`)

Verifying a login attempt: split the stored value on `:`, re-derive a key from
the submitted password using the stored salt, compare with
`crypto.timingSafeEqual` (constant-time, so failed attempts don't leak timing
information about how close a guess was).

## Routes — `/api/v1/auth`

| Method | Path      | Body               | Behavior |
|--------|-----------|---------------------|----------|
| POST   | `/login`  | `{ password }`       | Verify against `APP_PASSWORD_HASH`. Match: insert a `sessions` row, set cookie, `200 { data: { authenticated: true } }`. No match: `401 { error: 'Invalid password' }`. Either branch takes the same wall-clock path (see rate limiting below) so a timing side-channel doesn't exist across the whole request either. |
| POST   | `/logout` | —                    | Delete the session row matching the request cookie (if any); clear the cookie regardless; `204`. |
| GET    | `/me`     | —                    | Cookie resolves to a non-expired session row: refresh `expires_at` (sliding expiry), `200 { data: { authenticated: true } }`. Otherwise `401`. |

Cookie flags: `httpOnly: true`, `secure` only when `NODE_ENV === 'production'`
(dev is plain http; `secure` would silently drop the cookie), `sameSite: 'lax'`,
`path: '/'`. `clearCookie` on logout must repeat the same flags used to set it,
or the browser keeps the cookie around.

Session lifetime: 30 days, sliding — refreshed on every successful `GET /me`.

## Middleware

`requireAuth` (`backend/src/middleware/requireAuth.ts`):
- reads the session cookie; if absent, `401`
- hashes it, looks up the `sessions` row; if missing or `expires_at` has
  passed, `401`
- otherwise calls `next()`

Applied to the transactions router now (`app.use('/api/v1/transactions', requireAuth, transactionsRouter)`
in `app.ts`), and to categories/bills routers whenever those get built. The
`/api/v1/auth/*` routes themselves are never behind `requireAuth` (`/login`
obviously can't be; `/logout` and `/me` need to work for an already-expired
cookie too).

## Rate limiting

A single password is a much more attractive brute-force target than a
multi-user login (one secret to guess, not many). Add a small in-memory
counter keyed by IP on `POST /login`: 5 attempts per 15-minute window, `429`
past that. In-memory is fine — this is a single-process personal app, no need
for a shared store. Resets on process restart, which is an acceptable gap for
this scale.

## Frontend

- `frontend/src/auth/AuthContext.tsx` — calls `GET /api/v1/auth/me` once on
  mount, exposes `{ authenticated, loading }` via a `useAuth()` hook. The
  `loading` gate matters: the cookie is unreadable from JS, so "am I logged
  in?" is always a server round-trip, and skipping the gate means the login
  screen flashes for an already-authenticated user on every refresh.
- `frontend/src/auth/Login.tsx` — a password field and submit button, posting
  to `/api/v1/auth/login`; on success, re-trigger the `me` check (or just
  navigate — the next protected-route check will confirm) and redirect to `/`.
- `frontend/src/auth/RequireAuth.tsx` — a route wrapper: while `loading`, render
  nothing (or a quiet loading state); once resolved, redirect to `/login` if
  not authenticated, otherwise render the matched route via `<Outlet/>`.
- `main.tsx` routing gains a `/login` route outside the guard, and the existing
  `/` and `/transactions` routes move inside `RequireAuth`.
- A "Log out" control in `Layout`'s nav, posting to `/api/v1/auth/logout` and
  redirecting to `/login`.
- `BaseApiService`'s axios instance needs `withCredentials: true`, or the
  browser won't send the cookie on cross-port requests in dev (frontend on
  5173, backend on 3000) nor in prod if they ever end up on different origins.
  The existing Vite proxy (`/api` → `localhost:3000`) means same-origin in dev
  regardless, but `withCredentials` costs nothing and removes a footgun if the
  proxy setup ever changes.

## Error handling

- `BaseApiService`'s existing `#send`/`#request` already turns a backend
  `{ error }` into a thrown `Error` — a `401` from `requireAuth` or `/login`
  flows through that same path unchanged. The frontend's `RequireAuth` wrapper
  is what actually redirects on a `401` from `/me`; other `401`s (e.g. a
  session that expires mid-use on some other page) should redirect to `/login`
  the same way — wire this as a shared axios response interceptor on
  `BaseApiService`'s `http` instance rather than per-call handling.

## Testing

- `node:test` coverage for: login with correct/incorrect password, `/me`
  with a valid/missing/expired cookie, `/logout` clearing the session row,
  `requireAuth` rejecting a request with no cookie and one with a stale
  cookie, and the rate limiter tripping after 5 failed attempts.
- No frontend test framework exists yet in this project; frontend auth flow
  gets verified manually in-browser (login, refresh, logout, hitting a
  protected route unauthenticated) rather than with automated tests, matching
  how the rest of the frontend is currently verified.

## Open questions for the deploy spec (not this one)

- Where `APP_PASSWORD_HASH` and the session cookie's `secure` flag get their
  production values from is a deploy-spec concern, not an auth-spec one — this
  spec assumes `.env` works the same in prod as in dev, which depends on the
  hosting choice.
