import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { issueLink, redeemLink, parseToken, hashToken, revokeLinks } from '../src/magiclink.js';

const SECRET = 'test-secret';
const setup = () => {
  const db = openDb();
  db.prepare('INSERT INTO cases (id, ref) VALUES (?, ?)').run('case1', 'REF/1');
  db.prepare(`INSERT INTO participants (id, case_id, role) VALUES (?, ?, 'seller')`).run('p1', 'case1');
  return db;
};

test('a freshly issued link works', () => {
  const db = setup();
  const { token } = issueLink(db, SECRET, { caseId: 'case1', participantId: 'p1' });
  const result = redeemLink(db, SECRET, token);
  assert.equal(result.ok, true);
  assert.equal(result.caseId, 'case1');
  assert.equal(result.participantId, 'p1');
});

test('the raw token is never stored', () => {
  const db = setup();
  const { token } = issueLink(db, SECRET, { caseId: 'case1', participantId: 'p1' });
  const rows = db.prepare('SELECT token_hash FROM links').all();
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].token_hash, token);
  assert.equal(rows[0].token_hash, hashToken(token));
});

test('a tampered token is rejected', () => {
  const db = setup();
  const { token } = issueLink(db, SECRET, { caseId: 'case1', participantId: 'p1' });
  const parts = token.split('.');
  const tampered = ['case1', 'p2', ...parts.slice(2)].join('.');
  assert.equal(parseToken(SECRET, tampered), null);
  assert.equal(redeemLink(db, SECRET, tampered).reason, 'bad_signature');
});

test('a token signed with another secret is rejected', () => {
  const db = setup();
  const { token } = issueLink(db, 'other-secret', { caseId: 'case1', participantId: 'p1' });
  assert.equal(redeemLink(db, SECRET, token).reason, 'bad_signature');
});

test('a validly signed token that is not in the database is rejected', () => {
  const db = setup();
  const { token } = issueLink(db, SECRET, { caseId: 'case1', participantId: 'p1' });
  db.prepare('DELETE FROM links').run();
  assert.equal(redeemLink(db, SECRET, token).reason, 'unknown_token');
});

test('links expire', () => {
  const db = setup();
  const { token } = issueLink(db, SECRET, { caseId: 'case1', participantId: 'p1', ttlDays: 1 });
  const later = new Date(Date.now() + 2 * 86400000);
  assert.equal(redeemLink(db, SECRET, token, { now: later }).reason, 'expired');
});

test('a sign-off link can only be used once', () => {
  const db = setup();
  const { token } = issueLink(db, SECRET, { caseId: 'case1', participantId: 'p1', purpose: 'review_and_sign', singleUse: true });
  assert.equal(redeemLink(db, SECRET, token).ok, true);
  assert.equal(redeemLink(db, SECRET, token).reason, 'already_used');
});

test('an answering link survives repeated use', () => {
  const db = setup();
  const { token } = issueLink(db, SECRET, { caseId: 'case1', participantId: 'p1' });
  for (let i = 0; i < 5; i++) assert.equal(redeemLink(db, SECRET, token).ok, true);
});

test('links can be revoked, for a lost phone', () => {
  const db = setup();
  const { token } = issueLink(db, SECRET, { caseId: 'case1', participantId: 'p1' });
  revokeLinks(db, { participantId: 'p1' });
  assert.equal(redeemLink(db, SECRET, token).reason, 'unknown_token');
});
