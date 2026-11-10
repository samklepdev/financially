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
