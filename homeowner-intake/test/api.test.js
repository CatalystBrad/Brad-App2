import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import * as wa from '../src/channels/whatsapp.js';

async function listen() {
  const app = createApp({ sender: wa.createSender({}) });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { app, base, close: () => new Promise((r) => app.server.close(r)) };
}

const jsonFetch = async (base, path, opts = {}) => {
  const res = await fetch(base + path, { headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) }, ...opts });
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  return { status: res.status, body, headers: res.headers };
};

test('the API serves a full seller journey over HTTP', async (t) => {
  const { base, close } = await listen();
  t.after(close);

  // A conveyancer opens a case; prefill runs; a magic link comes back.
  const created = await jsonFetch(base, '/api/cases', {
    method: 'POST',
    body: JSON.stringify({
      ref: 'CAT/2026/001', address: '12 Example Street, Leeds', postcode: 'LS1 1AA', firm: 'Catalyst Services',
      seller: { name: 'Sam Okafor', phone: '447700900123', whatsappOptIn: true },
      plan: { mode: 'count', size: 2 },
      cadence: { window: { start: '00:00', end: '23:59' } },
    }),
  });
  assert.equal(created.status, 201);
  assert.match(created.body.link, /\/s\//);

  // The seller's magic link signs them in.
  const token = created.body.link.split('/s/')[1];
  const redeem = await fetch(`${base}/s/${token}`, { redirect: 'manual' });
  assert.equal(redeem.status, 302);
  const cookie = redeem.headers.getSetCookie()[0].split(';')[0];
  assert.match(cookie, /^hi_session=/);

  const auth = { headers: { cookie } };

  // Without the cookie, nothing is readable.
  assert.equal((await jsonFetch(base, '/api/me')).status, 401);

  const me = await jsonFetch(base, '/api/me', auth);
  assert.equal(me.status, 200);
  assert.equal(me.body.name, 'Sam Okafor');
  assert.equal(me.body.plan.size, 2);
  assert.ok(me.body.forecast.sessionsLeft > 1);
  assert.ok(me.body.progress.applicable > 40);

  // Answer two questions; the third request closes the session.
  let asked = 0;
  let spent = 0;
  const seen = [];
  for (let i = 0; i < 3; i++) {
    const next = await jsonFetch(base, `/api/next?asked=${asked}&spent=${spent}`, auth);
    assert.equal(next.status, 200);
    if (next.body.sessionDone) {
      assert.equal(i, 2, 'session should have lasted exactly two questions');
      break;
    }
    const item = next.body.item;
    seen.push(item.id);
    const value = item.t === 'multi' ? [item.opts.at(-1)] : item.t === 'yesno' ? 'No' : (item.opts?.[0] ?? 'Not known');
    const saved = await jsonFetch(base, '/api/answer', { method: 'POST', body: JSON.stringify({ itemId: item.id, value }), ...auth });
    assert.equal(saved.status, 200);
    asked += 1;
    spent += item.secs;
  }
  assert.equal(seen.length, 2);

  // An unknown question id is refused rather than silently stored.
  const bogus = await jsonFetch(base, '/api/answer', { method: 'POST', body: JSON.stringify({ itemId: 'not-a-question', value: 'x' }), ...auth });
  assert.equal(bogus.status, 400);

  // Parking a question, then changing the cadence from the phone.
  assert.equal((await jsonFetch(base, '/api/park', { method: 'POST', body: JSON.stringify({ itemId: '3.1', days: 2 }), ...auth })).status, 200);
  const prefs = await jsonFetch(base, '/api/preferences', {
    method: 'POST', body: JSON.stringify({ plan: { mode: 'time', size: 300 }, cadence: { frequency: 'weekly' } }), ...auth,
  });
  assert.equal(prefs.body.plan.size, 300);
  assert.equal(prefs.body.cadence.frequency, 'weekly');

  // Uploading a document.
  const upload = await fetch(`${base}/api/upload?itemId=2.5::doc&filename=party-wall.jpg`, {
    method: 'POST', headers: { cookie, 'content-type': 'image/jpeg' }, body: Buffer.from('fake-image-bytes'),
  });
  assert.equal(upload.status, 200);
  assert.equal((await upload.json()).bytes, 16);

  // Signing is refused while the form is incomplete.
  const early = await jsonFetch(base, '/api/sign', { method: 'POST', body: JSON.stringify({ confirmed: true }), ...auth });
  assert.equal(early.status, 409);
  assert.equal(early.body.error, 'incomplete');

  // The conveyancer's views.
  const caseId = created.body.caseId;
  const html = await jsonFetch(base, `/api/cases/${caseId}/export.html`);
  assert.equal(html.status, 200);
  assert.match(html.body, /TA6 Property Information/);
  const chase = await jsonFetch(base, '/api/cases');
  assert.equal(chase.body.cases[0].readyToSend, false);
  assert.ok(chase.body.cases[0].blocking.length > 0);
});

test('an expired or forged magic link gets a human-readable page, not a stack trace', async (t) => {
  const { base, close } = await listen();
  t.after(close);
  const res = await fetch(`${base}/s/forged.token.here.now`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /link has expired/i);
});

test('a forged session cookie is rejected', async (t) => {
  const { base, close } = await listen();
  t.after(close);
  const res = await jsonFetch(base, '/api/me', { headers: { cookie: 'hi_session=case.participant.answer.badsignature' } });
  assert.equal(res.status, 401);
});

test('the WhatsApp webhook verifies, then drives the conversation', async (t) => {
  const { app, base, close } = await listen();
  t.after(close);

  const verify = await fetch(`${base}/webhooks/whatsapp?hub.verify_token=dev-verify&hub.challenge=abc123`);
  assert.equal(await verify.text(), 'abc123');
  assert.equal((await fetch(`${base}/webhooks/whatsapp?hub.verify_token=wrong`)).status, 403);

  await jsonFetch(base, '/api/cases', {
    method: 'POST',
    body: JSON.stringify({
      ref: 'CAT/2026/002', address: '9 Test Road', postcode: 'LS2 2BB',
      seller: { name: 'Ada', phone: '447700900999', whatsappOptIn: true },
      cadence: { window: { start: '00:00', end: '23:59' } },
    }),
  });

  const before = app.sender.sent.length;
  const post = await fetch(`${base}/webhooks/whatsapp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: '447700900999', id: 'wamid.x', type: 'text', text: { body: 'ready' } }] } }] }] }),
  });
  assert.equal(post.status, 200);
  await new Promise((r) => setTimeout(r, 120));   // the webhook is acknowledged before processing
  assert.ok(app.sender.sent.length > before, 'inbound message should have produced a reply');
});

test('health and static serving work', async (t) => {
  const { base, close } = await listen();
  t.after(close);
  const health = await jsonFetch(base, '/healthz');
  assert.equal(health.body.ok, true);
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Your property questions<\/title>/);
  assert.equal((await fetch(`${base}/../package.json`)).status, 404);
});
