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
