import { SESSION_COOKIE, hashToken, parseCookies } from '../lib/auth.js';

// Reads the session cookie and sets request.user (or null). The database is only asked when a
// cookie is present, so guest requests never touch the sessions table.
export function attachUser(db) {
  return async (request, _response, next) => {
    request.user = null;
    try {
      const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
      if (!token) return next();
      const session = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
      if (session && session.expiresAt > new Date()) {
        request.user = session.user;
        request.sessionId = session.id;
      }
      next();
    } catch (error) { next(error); }
  };
}

// Enforced on the server: hiding a button in React is not a permission check.
export function requireUser(request, response, next) {
  if (!request.user) return response.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Please sign in to continue.' } });
  next();
}
