import express from 'express';
import {login, logout, me} from '../controllers/auth.controller.ts';
import {loginRateLimiter} from '../middleware/loginRateLimiter.ts';

export const authRouter = express.Router();

authRouter.post('/login', loginRateLimiter, login);
authRouter.post('/logout', logout);
authRouter.get('/me', me);
