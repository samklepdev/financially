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
