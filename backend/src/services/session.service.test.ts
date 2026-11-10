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
