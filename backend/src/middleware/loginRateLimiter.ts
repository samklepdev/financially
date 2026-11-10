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
