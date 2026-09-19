// Inbound webhook authentication. A webhook that accepts unsigned traffic is
// an open door: anyone who knows a seller's phone number can answer their
// questions for them. Every check here fails closed - no secret, no entry.
import { createHmac, timingSafeEqual } from 'node:crypto';

const same = (a, b) => {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Twilio signs the full request URL followed by every POST parameter, sorted
 * by key, concatenated as key+value, HMAC-SHA1 with the account auth token,
 * base64. The URL must be exactly what Twilio was told to call.
 */
export function twilioSignature(authToken, url, params) {
  const sorted = Object.keys(params).sort().map((k) => `${k}${params[k]}`).join('');
  return createHmac('sha1', authToken).update(url + sorted).digest('base64');
}

export function verifyTwilio({ authToken, url, params, signature }) {
  if (!authToken) return { ok: false, reason: 'not_configured' };
  if (!signature) return { ok: false, reason: 'missing_signature' };
  return same(twilioSignature(authToken, url, params), signature)
    ? { ok: true }
    : { ok: false, reason: 'bad_signature' };
}

/** Meta signs the raw body: sha256=<hex HMAC-SHA256 with the app secret>. */
export function metaSignature(appSecret, rawBody) {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

export function verifyMeta({ appSecret, rawBody, signature }) {
  if (!appSecret) return { ok: false, reason: 'not_configured' };
  if (!signature) return { ok: false, reason: 'missing_signature' };
  return same(metaSignature(appSecret, rawBody), signature)
    ? { ok: true }
    : { ok: false, reason: 'bad_signature' };
}

/** A plain shared secret in a header, for providers that do not sign. */
export function verifySharedSecret({ secret, given }) {
  if (!secret) return { ok: false, reason: 'not_configured' };
  if (!given) return { ok: false, reason: 'missing_signature' };
  return same(secret, given) ? { ok: true } : { ok: false, reason: 'bad_signature' };
}
