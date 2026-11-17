// Password hashing, session tokens and cookies for ShopSmart sign-in.
// Uses only node:crypto, so there is no native dependency to build on the server.
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };

export const SESSION_COOKIE = 'shopsmart_session';
export const SESSION_DAYS = 7;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, saltText, hashText] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, 'base64');
  const actual = await scrypt(password, Buffer.from(saltText, 'base64'), expected.length, SCRYPT_OPTIONS);
  return crypto.timingSafeEqual(actual, expected);
}

// Compared against when an email has no account, so a wrong email and a wrong password
// take about the same time and an attacker cannot tell which accounts exist.
export const DUMMY_PASSWORD_HASH = `scrypt$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(KEY_LENGTH).toString('base64')}`;

export function newSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function parseCookies(header = '') {
  const cookies = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    try { cookies[name] = decodeURIComponent(part.slice(index + 1).trim()); } catch { /* ignore a malformed cookie */ }
  }
  return cookies;
}

// HttpOnly: page scripts cannot read it. SameSite=Lax: other sites cannot send it with a POST.
// Secure: only sent over HTTPS. It is on in production, where the site is served through HTTPS.
export function sessionCookie(token, { secure = process.env.NODE_ENV === 'production', maxAgeSeconds = SESSION_DAYS * 86400 } = {}) {
  return [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`, secure ? 'Secure' : null]
    .filter(Boolean).join('; ');
}

export function clearedSessionCookie(options = {}) {
  return sessionCookie('', { ...options, maxAgeSeconds: 0 });
}

// The single ownership rule: a customer may read an order only if it was placed from their account.
export function canReadOrder(user, order) {
  return Boolean(user && order && order.userId !== null && order.userId === user.id);
}

export function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}
