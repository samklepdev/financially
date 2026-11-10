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
