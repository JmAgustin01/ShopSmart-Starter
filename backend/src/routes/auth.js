import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { DUMMY_PASSWORD_HASH, SESSION_DAYS, clearedSessionCookie, hashPassword, hashToken, newSessionToken, publicUser, sessionCookie, verifyPassword } from '../lib/auth.js';
import { attachUser, requireUser } from '../middleware/session.js';
import { loginSchema, registerSchema } from '../validators/schemas.js';

export function createAuthRouter(db) {
  const router = Router();
  // Slows down password guessing: 20 sign-in or sign-up attempts per 15 minutes per address.
  const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many attempts. Please wait a few minutes and try again.' } } });

  async function startSession(response, userId) {
    const token = newSessionToken();
    await db.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000) } });
    response.setHeader('Set-Cookie', sessionCookie(token));
  }

  router.post('/register', limiter, async (request, response, next) => {
    try {
      const parsed = registerSchema.safeParse(request.body);
      if (!parsed.success) return response.status(422).json({ error: { code: 'INVALID_ACCOUNT', message: 'Check the account details.', details: parsed.error.flatten() } });
      const { name, email, password } = parsed.data;
      if (await db.user.findUnique({ where: { email } })) {
        return response.status(409).json({ error: { code: 'EMAIL_IN_USE', message: 'An account with this email already exists. Please sign in.' } });
      }
      const user = await db.user.create({ data: { name, email, passwordHash: await hashPassword(password) } });
      await startSession(response, user.id);
      response.status(201).json({ user: publicUser(user) });
    } catch (error) {
      if (error.code === 'P2002') return response.status(409).json({ error: { code: 'EMAIL_IN_USE', message: 'An account with this email already exists. Please sign in.' } });
      next(error);
    }
  });

  router.post('/login', limiter, async (request, response, next) => {
    try {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) return response.status(422).json({ error: { code: 'INVALID_LOGIN', message: 'Enter your email and password.' } });
      const user = await db.user.findUnique({ where: { email: parsed.data.email } });
      const valid = await verifyPassword(parsed.data.password, user?.passwordHash || DUMMY_PASSWORD_HASH);
      // Same message for an unknown email and a wrong password.
      if (!user || !valid) return response.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } });
      await startSession(response, user.id);
      response.json({ user: publicUser(user) });
    } catch (error) { next(error); }
  });

  router.post('/logout', attachUser(db), async (request, response, next) => {
    try {
      if (request.sessionId) await db.session.deleteMany({ where: { id: request.sessionId } });
      response.setHeader('Set-Cookie', clearedSessionCookie());
      response.status(204).end();
    } catch (error) { next(error); }
  });

  router.get('/me', attachUser(db), requireUser, (request, response) => response.json({ user: publicUser(request.user) }));

  return router;
}
