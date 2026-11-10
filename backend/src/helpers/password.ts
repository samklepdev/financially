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
