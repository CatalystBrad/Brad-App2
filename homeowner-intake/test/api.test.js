import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { createDispatcher } from '../src/channels/index.js';

async function listen() {
  const app = createApp({ sender: createDispatcher() });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { app, base, close: () => new Promise((r) => app.server.close(r)) };
}

/** Bootstraps a firm and returns headers a fee earner would send. */
async function onboard(base, name = 'Example & Co') {
  const res = await fetch(`${base}/api/firms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer dev-admin-key' },
    body: JSON.stringify({ name, brand: { colour: '#0F6E5C', signOff: 'Rachel' }, admin: { email: 'rachel@example.test', name: 'Rachel' } }),
  });
  const body = await res.json();
  return { firm: body.firm, key: body.staff.key, headers: { authorization: `Bearer ${body.staff.key}` } };
}

const jsonFetch = async (base, path, opts = {}) => {
  const res = await fetch(base + path, { headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) }, ...opts });
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  return { status: res.status, body, headers: res.headers };
};

test('the API serves a full seller journey over HTTP', async (t) => {
  const { base, close } = await listen();
  t.after(close);

  const { headers: staffHeaders } = await onboard(base);

  // A conveyancer opens a case; prefill runs; a magic link comes back.
  const created = await jsonFetch(base, '/api/cases', {
    method: 'POST',
    headers: staffHeaders,
    body: JSON.stringify({
      ref: 'CAT/2026/001', address: '12 Example Street, Leeds', postcode: 'LS1 1AA',
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
  const html = await jsonFetch(base, `/api/cases/${caseId}/export.html`, { headers: staffHeaders });
  assert.equal(html.status, 200);
  assert.match(html.body, /TA6 Property Information/);
  const chase = await jsonFetch(base, '/api/cases', { headers: staffHeaders });
  assert.equal(chase.body.cases[0].readyToSend, false);
  assert.ok(chase.body.cases[0].blocking > 0);
  assert.ok(chase.body.cases[0].attention.label, 'every file should say what to do about it');
});

test('a firm sees only its own files', async (t) => {
  const { base, close } = await listen();
  t.after(close);
  const a = await onboard(base, 'Firm A');
  const b = await onboard(base, 'Firm B');

  const mine = await jsonFetch(base, '/api/cases', {
    method: 'POST', headers: a.headers,
    body: JSON.stringify({ ref: 'A/1', address: '1 A Street', seller: { name: 'Seller A', phone: '447700900001' } }),
  });
  assert.equal(mine.status, 201);

  // Firm B's list must not contain it.
  const theirList = await jsonFetch(base, '/api/cases', { headers: b.headers });
  assert.equal(theirList.body.cases.length, 0);

  // Nor may Firm B open it by guessing the id - and the answer is 404, not 403,
  // so the reference is not confirmed to exist.
  for (const path of [`/api/cases/${mine.body.caseId}`, `/api/cases/${mine.body.caseId}/export.json`]) {
    assert.equal((await jsonFetch(base, path, { headers: b.headers })).status, 404, path);
  }
  assert.equal((await jsonFetch(base, `/api/cases/${mine.body.caseId}/nudge`, { method: 'POST', headers: b.headers })).status, 404);

  // Firm A can.
  assert.equal((await jsonFetch(base, `/api/cases/${mine.body.caseId}`, { headers: a.headers })).status, 200);
});

test('conveyancer endpoints refuse a missing or wrong key', async (t) => {
  const { base, close } = await listen();
  t.after(close);
  await onboard(base);
  assert.equal((await jsonFetch(base, '/api/cases')).status, 401);
  assert.equal((await jsonFetch(base, '/api/cases', { headers: { authorization: 'Bearer hi_madeup' } })).status, 401);
  assert.equal((await jsonFetch(base, '/api/firms', { method: 'POST', body: JSON.stringify({ name: 'Sneaky' }) })).status, 401);
});

test('a staff key is stored only as a hash, and only an admin can mint more', async (t) => {
  const { app, base, close } = await listen();
  t.after(close);
  const a = await onboard(base);
  const rows = app.store.db.prepare('SELECT key_hash FROM staff').all();
  assert.ok(rows.every((r) => !r.key_hash.startsWith('hi_')), 'plaintext key must not be stored');

  const colleague = await jsonFetch(base, '/api/staff', {
    method: 'POST', headers: a.headers, body: JSON.stringify({ email: 'sam@example.test', name: 'Sam', role: 'fee_earner' }),
  });
  assert.equal(colleague.status, 201);
  assert.match(colleague.body.staff.key, /^hi_/);

  // A fee earner cannot mint keys.
  const denied = await jsonFetch(base, '/api/staff', {
    method: 'POST', headers: { authorization: `Bearer ${colleague.body.staff.key}` }, body: JSON.stringify({ email: 'x@y.z' }),
  });
  assert.equal(denied.status, 403);
});

test('the firm brand reaches the seller, not ours', async (t) => {
  const { app, base, close } = await listen();
  t.after(close);
  const a = await onboard(base, 'Hardcastle & Byrne');
  const created = await jsonFetch(base, '/api/cases', {
    method: 'POST', headers: a.headers,
    body: JSON.stringify({
      address: '3 Brand Road', seller: { name: 'Jo', phone: '447700900777', whatsappOptIn: true },
      cadence: { window: { start: '00:00', end: '23:59' } },
    }),
  });
  await jsonFetch(base, `/api/cases/${created.body.caseId}/invite`, { method: 'POST', headers: a.headers });
  const sent = app.sender.lastTo('whatsapp');
  const params = sent.template.components[0].parameters.map((p) => p.text);
  assert.ok(params.includes('Hardcastle & Byrne'), `firm name missing from invite: ${JSON.stringify(params)}`);
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

  const a = await onboard(base);
  await jsonFetch(base, '/api/cases', {
    method: 'POST', headers: a.headers,
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

test('the SMS webhook drives the same conversation', async (t) => {
  const { app, base, close } = await listen();
  t.after(close);
  const a = await onboard(base);
  await jsonFetch(base, '/api/cases', {
    method: 'POST', headers: a.headers,
    body: JSON.stringify({
      ref: 'SMS/1', address: '4 Text Lane',
      seller: { name: 'Pat', phone: '447700900444' },
      cadence: { channel: 'sms', window: { start: '00:00', end: '23:59' } },
    }),
  });
  const before = app.sender.sent.length;
  const res = await fetch(`${base}/webhooks/sms`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: '+447700900444', Body: 'GO', MessageSid: 'SM1', NumMedia: '0' }),
  });
  assert.equal(res.status, 200);
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(app.sender.sent.length > before, 'an inbound text should produce a reply');
  assert.equal(app.sender.sent.at(-1).channel, 'sms');
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

test('the review screen can re-open any answer with its real control', async (t) => {
  const { base, close } = await listen();
  t.after(close);
  const a = await onboard(base);
  const created = await jsonFetch(base, '/api/cases', {
    method: 'POST', headers: a.headers,
    body: JSON.stringify({
      ref: 'REV/1', address: '5 Review Road', forms: ['ta6', 'ta10'],
      seller: { name: 'Sam', phone: '447700900801' },
    }),
  });
  const redeem = await fetch(`${base}/s/${created.body.link.split('/s/')[1]}`, { redirect: 'manual' });
  const cookie = redeem.headers.getSetCookie()[0].split(';')[0];
  const auth = { headers: { cookie } };

  // A multiple-choice question must come back as a choice with its own options -
  // guessing the control from the stored answer would turn it into free text
  // and put an invalid value on a legal form.
  const choice = await jsonFetch(base, '/api/item?id=2.1a', auth);
  assert.equal(choice.status, 200);
  assert.equal(choice.body.item.t, 'choice');
  assert.deepEqual(choice.body.item.opts, ['Me (the seller)', 'The neighbour', 'Shared', 'Not known']);

  // A TA10 checklist must come back as a checklist, with its rows.
  const list = await jsonFetch(base, '/api/item?id=fc.2', auth);
  assert.equal(list.body.item.t, 'checklist');
  assert.ok(list.body.item.rows.length > 5);

  // The current answer comes with it, so the control can show what is there.
  await jsonFetch(base, '/api/answer', { method: 'POST', body: JSON.stringify({ itemId: '2.1a', value: 'Shared' }), ...auth });
  const again = await jsonFetch(base, '/api/item?id=2.1a', auth);
  assert.equal(again.body.current.value, 'Shared');

  assert.equal((await jsonFetch(base, '/api/item?id=not-a-question', auth)).status, 404);
  assert.equal((await jsonFetch(base, '/api/item?id=2.1a')).status, 401, 'must need the seller session');
});

test('a TA6-only case cannot open a TA10 question by id', async (t) => {
  const { base, close } = await listen();
  t.after(close);
  const a = await onboard(base);
  const created = await jsonFetch(base, '/api/cases', {
    method: 'POST', headers: a.headers,
    body: JSON.stringify({ ref: 'REV/2', address: '6 Review Road', seller: { name: 'Jo', phone: '447700900802' } }),
  });
  const redeem = await fetch(`${base}/s/${created.body.link.split('/s/')[1]}`, { redirect: 'manual' });
  const cookie = redeem.headers.getSetCookie()[0].split(';')[0];
  assert.equal((await jsonFetch(base, '/api/item?id=fc.2', { headers: { cookie } })).status, 404);
  assert.equal((await jsonFetch(base, '/api/item?id=2.1a', { headers: { cookie } })).status, 200);
});

test('a completed form tells the seller they still have to sign, and who else must', async (t) => {
  const { app, base, close } = await listen();
  t.after(close);
  const a = await onboard(base);
  const created = await jsonFetch(base, '/api/cases', {
    method: 'POST', headers: a.headers,
    body: JSON.stringify({ ref: 'SIGN/1', address: '7 Sign Street', seller: { name: 'Sam Okafor', phone: '447700900901' } }),
  });
  const caseId = created.body.caseId;
  const second = app.store.addParticipant(caseId, { name: 'Ada Okafor', phone: '447700900902' });

  const cookieFor = async (link) => {
    const res = await fetch(`${base}/s/${link.split('/s/')[1]}`, { redirect: 'manual' });
    return res.headers.getSetCookie()[0].split(';')[0];
  };
  const samCookie = await cookieFor(created.body.link);
  const adaCookie = await cookieFor(app.store.issueAnswerLink(caseId, second.id));

  // Answer everything as Sam.
  const { isApplicable } = await import('../src/questions.js');
  for (let pass = 0; pass < 8; pass++) {
    const answers = app.store.answers(caseId);
    for (const item of app.bank.items.filter((i) => (i.track ?? 'form') === 'form' && i.form === 'ta6')) {
      if (answers[item.id] && answers[item.id].status !== 'prefilled') continue;
      if (!isApplicable(item, answers)) continue;
      app.store.saveAnswer(caseId, item.id, { value: item.t === 'multi' ? [item.opts[0]] : (item.opts?.[0] ?? 'No'), by: created.body.participantId });
    }
  }

  // Before signing: the client is told it is complete and unsigned, which is
  // what sends it to the sign-off screen rather than "carry on answering".
  let me = await jsonFetch(base, '/api/me', { headers: { cookie: samCookie } });
  assert.equal(me.body.progress.percent, 100);
  assert.equal(me.body.signed, false);
  assert.deepEqual(me.body.sellers.map((s) => s.signed), [false, false]);

  const first = await jsonFetch(base, '/api/sign', { method: 'POST', body: JSON.stringify({ confirmed: true }), headers: { cookie: samCookie } });
  assert.equal(first.body.allSigned, false);
  assert.equal(app.store.getCase(caseId).status, 'collecting', 'one signature is not enough');

  // Sam now sees the signed screen and can be told who is outstanding by name.
  me = await jsonFetch(base, '/api/me', { headers: { cookie: samCookie } });
  assert.equal(me.body.signed, true);
  assert.deepEqual(me.body.sellers.find((s) => !s.signed).name, 'Ada Okafor');

  // Signing without ticking the box is refused.
  const unticked = await jsonFetch(base, '/api/sign', { method: 'POST', body: JSON.stringify({}), headers: { cookie: adaCookie } });
  assert.equal(unticked.status, 400);

  const both = await jsonFetch(base, '/api/sign', { method: 'POST', body: JSON.stringify({ confirmed: true }), headers: { cookie: adaCookie } });
  assert.equal(both.body.allSigned, true);
  assert.equal(app.store.getCase(caseId).status, 'signed');

  // And an amendment after signing re-opens it for everyone.
  await jsonFetch(base, '/api/answer', { method: 'POST', body: JSON.stringify({ itemId: '3.1', value: 'Yes' }), headers: { cookie: samCookie } });
  assert.equal(app.store.getCase(caseId).status, 'collecting');
  const after = await jsonFetch(base, '/api/me', { headers: { cookie: samCookie } });
  assert.equal(after.body.signed, false, 'an amended form is unsigned for every owner');
  assert.deepEqual(after.body.sellers.map((s) => s.signed), [false, false]);
});
