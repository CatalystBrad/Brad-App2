// Magic links, done so that a leaked database does not hand over every seller's
// form: the token is only ever stored as a hash, exactly like a password.
import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

const DEFAULT_TTL_DAYS = 30;

export function mintToken(secret, { caseId, participantId, purpose = 'answer' }) {
  const nonce = randomBytes(16).toString('base64url');
  const body = `${caseId}.${participantId}.${purpose}.${nonce}`;
  const sig = createHmac('sha256', secret).update(body).digest('base64url').slice(0, 27);
  return `${body}.${sig}`;
}

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function parseToken(secret, token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 5) return null;
  const [caseId, participantId, purpose, nonce, sig] = parts;
  const expected = createHmac('sha256', secret)
    .update(`${caseId}.${participantId}.${purpose}.${nonce}`)
    .digest('base64url')
    .slice(0, 27);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { caseId, participantId, purpose };
}

export function issueLink(db, secret, { caseId, participantId, purpose = 'answer', ttlDays = DEFAULT_TTL_DAYS, singleUse = false }) {
  const token = mintToken(secret, { caseId, participantId, purpose });
  const expires = new Date(Date.now() + ttlDays * 86400000).toISOString();
  db.prepare(
    `INSERT INTO links (token_hash, case_id, participant_id, purpose, expires_at, single_use)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(hashToken(token), caseId, participantId, purpose, expires, singleUse ? 1 : 0);
  return { token, expiresAt: expires };
}

export function redeemLink(db, secret, token, { now = new Date() } = {}) {
  const parsed = parseToken(secret, token);
  if (!parsed) return { ok: false, reason: 'bad_signature' };
  const row = db.prepare('SELECT * FROM links WHERE token_hash = ?').get(hashToken(token));
  if (!row) return { ok: false, reason: 'unknown_token' };
  if (new Date(row.expires_at) < now) return { ok: false, reason: 'expired' };
  if (row.single_use && row.used_at) return { ok: false, reason: 'already_used' };
  if (row.single_use) {
    db.prepare('UPDATE links SET used_at = ? WHERE token_hash = ?').run(now.toISOString(), hashToken(token));
  }
  return { ok: true, caseId: row.case_id, participantId: row.participant_id, purpose: row.purpose };
}

// Links stop working the moment the form is signed, or if a seller says their
// phone was lost.
export function revokeLinks(db, { caseId, participantId } = {}) {
  if (participantId) return db.prepare('DELETE FROM links WHERE participant_id = ?').run(participantId);
  return db.prepare('DELETE FROM links WHERE case_id = ?').run(caseId);
}
