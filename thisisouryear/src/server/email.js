// Sending email, and unsubscribe links.
//
// No email service is connected by default, and nothing here sends until one
// is. The one adapter included is for Resend. It has been tested against a
// stand-in server, not against the real service.
import { createHmac } from 'node:crypto';
import { sameSecret } from './http.js';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url').toString('utf8');

// An unsubscribe link carries the address and a signature, so nobody can
// unsubscribe someone else by guessing.
export function unsubscribeToken(email, secret) {
  const address = String(email).trim().toLowerCase();
  const sig = createHmac('sha256', secret).update(address).digest('base64url');
  return `${b64(address)}.${sig}`;
}

export function readUnsubscribeToken(token, secret) {
  if (!secret || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  let address;
  try {
    address = unb64(body);
  } catch {
    return null;
  }
  const expected = createHmac('sha256', secret).update(address).digest('base64url');
  return sameSecret(sig, expected) ? address : null;
}

// Returns a send() function for the configured service, or null if there
// isn't one. `fetchImpl` is only swapped out in tests.
export function emailSender(env, fetchImpl = fetch) {
  if (env.EMAIL_PROVIDER !== 'resend' || !env.RESEND_API_KEY || !env.EMAIL_FROM) return null;
  const base = env.RESEND_API_BASE || 'https://api.resend.com';
  return async function send({ to, subject, text, unsubscribeUrl, idempotencyKey }) {
    const res = await fetchImpl(`${base}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        // The service refuses to send twice for the same key.
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [to],
        subject,
        text,
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Email service said ${res.status}: ${body?.message ?? 'no detail'}`);
    return { id: body.id ?? null };
  };
}
