// Small helpers shared by the server functions.
import { createHash, timingSafeEqual, randomBytes } from 'node:crypto';

export function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

// Reads a JSON body, refusing anything bigger than the limit.
export async function readJson(req, maxBytes = 64 * 1024) {
  const length = Number(req.headers.get('content-length') ?? 0);
  if (length > maxBytes) return { error: 'too_large' };
  let text;
  try {
    text = await req.text();
  } catch {
    return { error: 'unreadable' };
  }
  if (text.length > maxBytes) return { error: 'too_large' };
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? { value } : { error: 'not_an_object' };
  } catch {
    return { error: 'bad_json' };
  }
}

export function sha256(text) {
  return createHash('sha256').update(String(text)).digest('hex');
}

// A short random ID that is safe to show people, like "Q-7F3K9Q2M".
export function shortId(prefix) {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = randomBytes(8);
  return `${prefix}-${[...bytes].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

// Compares two secrets without leaking how much of them matched.
export function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const [ha, hb] = [createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest()];
  return timingSafeEqual(ha, hb);
}

// The admin screen sends its password as "Authorization: Bearer <password>".
// Returns null when allowed, or a Response explaining why not.
export function requireAdmin(req, env) {
  const expected = env.ADMIN_TOKEN;
  if (!expected || expected.length < 16) {
    return json({ error: 'admin_not_configured', message: 'Set ADMIN_TOKEN in Netlify (16 characters or more) to turn the admin screen on.' }, 503);
  }
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!sameSecret(given, expected)) return json({ error: 'unauthorized', message: 'Wrong admin password.' }, 401);
  return null;
}

export const isEmail = (value) => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
