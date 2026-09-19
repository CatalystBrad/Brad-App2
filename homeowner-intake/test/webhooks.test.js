import test from 'node:test';
import assert from 'node:assert/strict';
import { twilioSignature, verifyTwilio, metaSignature, verifyMeta, verifySharedSecret } from '../src/webhooks.js';

test('Twilio signatures follow the documented scheme', () => {
  // Worked example from Twilio's own documentation.
  const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
  const params = { CallSid: 'CA1234567890ABCDE', Caller: '+12349013030', Digits: '1234', From: '+12349013030', To: '+18005551212' };
  const sig = twilioSignature('12345', url, params);
  assert.equal(sig, '0/KCTR6DLpKmkAf8muzZqo1nDgQ=');
  assert.deepEqual(verifyTwilio({ authToken: '12345', url, params, signature: sig }), { ok: true });
});

test('every way a Twilio check can fail is closed', () => {
  const url = 'https://host/webhooks/sms';
  const params = { From: '+447700900123', Body: 'Yes' };
  const sig = twilioSignature('tok', url, params);
  assert.equal(verifyTwilio({ authToken: null, url, params, signature: sig }).reason, 'not_configured');
  assert.equal(verifyTwilio({ authToken: 'tok', url, params, signature: undefined }).reason, 'missing_signature');
  assert.equal(verifyTwilio({ authToken: 'tok', url, params, signature: 'x' }).reason, 'bad_signature');
  assert.equal(verifyTwilio({ authToken: 'other', url, params, signature: sig }).reason, 'bad_signature');
  // Changing any parameter - the whole point - invalidates it.
  assert.equal(verifyTwilio({ authToken: 'tok', url, params: { ...params, Body: 'No' }, signature: sig }).reason, 'bad_signature');
  assert.equal(verifyTwilio({ authToken: 'tok', url: 'https://other/webhooks/sms', params, signature: sig }).reason, 'bad_signature');
});

test('Meta signatures cover the raw body byte for byte', () => {
  const raw = Buffer.from('{"entry":[]}');
  const sig = metaSignature('secret', raw);
  assert.match(sig, /^sha256=[0-9a-f]{64}$/);
  assert.deepEqual(verifyMeta({ appSecret: 'secret', rawBody: raw, signature: sig }), { ok: true });
  assert.equal(verifyMeta({ appSecret: 'secret', rawBody: Buffer.from('{"entry":[ ]}'), signature: sig }).reason, 'bad_signature');
  assert.equal(verifyMeta({ appSecret: null, rawBody: raw, signature: sig }).reason, 'not_configured');
  assert.equal(verifyMeta({ appSecret: 'secret', rawBody: raw, signature: '' }).reason, 'missing_signature');
});

test('a shared secret is compared in constant time and never matches empty', () => {
  assert.deepEqual(verifySharedSecret({ secret: 'abc', given: 'abc' }), { ok: true });
  assert.equal(verifySharedSecret({ secret: 'abc', given: 'abd' }).reason, 'bad_signature');
  assert.equal(verifySharedSecret({ secret: 'abc', given: '' }).reason, 'missing_signature');
  assert.equal(verifySharedSecret({ secret: '', given: '' }).reason, 'not_configured');
});
