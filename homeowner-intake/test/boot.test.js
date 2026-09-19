import test from 'node:test';
import assert from 'node:assert/strict';
import { checkConfig, clientIp, PLACEHOLDERS } from '../src/boot.js';

const GOOD = {
  NODE_ENV: 'production',
  LINK_SECRET: 'x'.repeat(48),
  ADMIN_KEY: 'a-long-random-admin-key-value-here',
  WA_VERIFY_TOKEN: 'random-verify',
  BASE_URL: 'https://intake.example.co.uk',
  DB_PATH: '/data/intake.db',
  WA_APP_SECRET: 's', SMS_AUTH_TOKEN: 't', WA_TOKEN: 'w', TRUST_PROXY: '1',
};

test('a correctly configured production deployment passes cleanly', () => {
  const r = checkConfig(GOOD);
  assert.equal(r.ok, true);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.production, true);
});

test('development with all the defaults runs, but says so', () => {
  const r = checkConfig({});
  assert.equal(r.ok, true, 'a developer must be able to run it with no setup');
  assert.equal(r.production, false);
  assert.ok(r.warnings.some((w) => w.includes('LINK_SECRET')));
});

test('production refuses to boot on any placeholder secret', () => {
  for (const [name, placeholder] of Object.entries(PLACEHOLDERS)) {
    if (name === 'WA_VERIFY_TOKEN') continue;   // only a warning: used once, by Meta
    const r = checkConfig({ ...GOOD, [name]: placeholder });
    assert.equal(r.ok, false, `${name} placeholder must stop the server`);
    assert.ok(r.problems.some((p) => p.includes(name)), `problem should name ${name}`);
  }
  // Deleting the variable is the same as leaving the placeholder.
  const { LINK_SECRET, ...noSecret } = GOOD;
  assert.equal(checkConfig(noSecret).ok, false);
});

test('production refuses a short secret, a plain-http URL, a trailing slash, and an in-memory database', () => {
  assert.equal(checkConfig({ ...GOOD, LINK_SECRET: 'short' }).ok, false);
  assert.ok(checkConfig({ ...GOOD, BASE_URL: 'http://intake.example.co.uk' }).problems.some((p) => /https/.test(p)));
  assert.ok(checkConfig({ ...GOOD, BASE_URL: 'https://intake.example.co.uk/' }).problems.some((p) => /slash/.test(p)));
  const { DB_PATH, ...noDb } = GOOD;
  assert.ok(checkConfig(noDb).problems.some((p) => /memory/.test(p)));
  const { BASE_URL, ...noUrl } = GOOD;
  assert.ok(checkConfig(noUrl).problems.some((p) => /BASE_URL is not set/.test(p)));
});

test('missing channel credentials warn but do not block', () => {
  const { WA_APP_SECRET, SMS_AUTH_TOKEN, WA_TOKEN, TRUST_PROXY, ...bare } = GOOD;
  const r = checkConfig(bare);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.includes('WA_APP_SECRET')));
  assert.ok(r.warnings.some((w) => w.includes('SMS_AUTH_TOKEN')));
  assert.ok(r.warnings.some((w) => w.includes('dry-run')));
  assert.ok(r.warnings.some((w) => w.includes('TRUST_PROXY')));
});

test('the client address honours X-Forwarded-For only when the proxy is trusted', () => {
  const req = { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.2' }, socket: { remoteAddress: '10.0.0.2' } };
  assert.equal(clientIp(req, {}), '10.0.0.2', 'untrusted: the header could be forged by anyone');
  assert.equal(clientIp(req, { TRUST_PROXY: '1' }), '203.0.113.9', 'trusted: the first hop is the client');
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '198.51.100.4' } }, { TRUST_PROXY: '1' }), '198.51.100.4', 'no header: fall back');
});

test('the database directory is created on first boot', async () => {
  const { openDb } = await import('../src/db.js');
  const { mkdtempSync, existsSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'hi-boot-'));
  const path = join(root, 'nested', 'deeper', 'intake.db');
  assert.equal(existsSync(join(root, 'nested')), false);
  const db = openDb(path);
  assert.equal(existsSync(path), true);
  db.close();
  rmSync(root, { recursive: true, force: true });
});
