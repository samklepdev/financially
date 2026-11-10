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
