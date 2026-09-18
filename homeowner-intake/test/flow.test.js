import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { Store } from '../src/store.js';
import { loadBank } from '../src/questions.js';
import * as wa from '../src/channels/whatsapp.js';
import { handleInbound, startSession, askNext, tick, lastAsked } from '../src/conversation.js';
import { buildExport, toHtml, toChaseList } from '../src/export/ta6.js';
import { applyPrefill } from '../src/prefill.js';

const bank = loadBank();
const PHONE = '447700900123';

function setup({ cadence, plan } = {}) {
  const store = new Store(openDb(), bank).configureLinks({ secret: 's3cret', baseUrl: 'https://app.test' });
  const c = store.createCase({ ref: 'CAT/1234', address: '12 Example Street, Leeds', postcode: 'LS1 1AA', firm: 'Catalyst' });
  const seller = store.addParticipant(c.id, {
    name: 'Sam Okafor', phone: PHONE, whatsappOptIn: true,
    cadence: { window: { start: '00:00', end: '23:59' }, ...(cadence ?? {}) },
    plan: { mode: 'count', size: 3, ...(plan ?? {}) },
  });
  return { store, caseId: c.id, seller, sender: wa.createSender({}) };
}

const inbound = (over = {}) => ({ from: PHONE, kind: 'text', text: 'hello', ...over });

test('a WhatsApp invite opens with an approved template, not a raw question', async () => {
  const { store, sender, seller } = setup();
  const res = await startSession(store, sender, seller.id, { template: 'invite' });
  assert.equal(res.opened, 'template');
  assert.equal(sender.sent.at(-1).type, 'template');
  assert.equal(sender.sent.at(-1).template.name, 'ta6_invite');
});

test('once the seller replies, questions flow free-form in the same chat', async () => {
  const { store, sender, seller } = setup();
  await startSession(store, sender, seller.id, { template: 'invite' });
  await handleInbound(store, sender, inbound({ text: 'yes ok' }));
  const last = sender.sent.at(-1);
  assert.ok(last.interactive || last.text, 'a question should have been asked');
  assert.ok(lastAsked(store, seller.id), 'the asked question is remembered');
});

test('a tapped button is saved against the right question', async () => {
  const { store, caseId, sender, seller } = setup();
  await startSession(store, sender, seller.id, { template: 'resume' });
  await handleInbound(store, sender, inbound({ text: 'go' }));
  const asked = lastAsked(store, seller.id);
  await handleInbound(store, sender, { from: PHONE, kind: 'choice', itemId: asked.id, value: asked.t === 'yesno' ? 'No' : (asked.opts?.[0] ?? 'No') });
  const answers = store.answers(caseId);
  assert.ok(answers[asked.id], 'answer not stored');
  assert.equal(answers[asked.id].source, 'whatsapp');
});

test('the session stops at the seller\'s chosen size and says so', async () => {
  const { store, caseId, sender, seller } = setup({ plan: { size: 2 } });
  await startSession(store, sender, seller.id, { template: 'resume' });
  await handleInbound(store, sender, inbound({ text: 'go' }));
  for (let i = 0; i < 4; i++) {
    const asked = lastAsked(store, seller.id);
    if (!asked) break;
    await handleInbound(store, sender, { from: PHONE, kind: 'choice', itemId: asked.id, value: asked.t === 'yesno' ? 'No' : (asked.opts?.[0] ?? 'No') });
  }
  const answered = Object.keys(store.answers(caseId)).filter((k) => store.answers(caseId)[k].status === 'answered');
  assert.ok(answered.length <= 4, `should not have run away with the whole form: ${answered.length}`);
  const bodies = sender.sent.map((m) => m.text?.body ?? '').filter(Boolean);
  assert.ok(bodies.some((b) => /done for now|another one off the list|moves the sale forward/i.test(b)), 'expected a sign-off message');
});

test('saying yes pulls the follow-up in straight away', async () => {
  const { store, caseId, sender, seller } = setup({ plan: { size: 1 } });
  store.saveAnswer(caseId, '3.1', { value: 'Yes', source: 'whatsapp', by: seller.id });
  const ago = (ms) => new Date(Date.now() - ms).toISOString();
  store.db.prepare('UPDATE participants SET last_inbound_at = ?, last_nudge_at = ? WHERE id = ?').run(new Date().toISOString(), ago(3600e3), seller.id);
  await askNext(store, sender, seller.id, { force: true });
  assert.equal(lastAsked(store, seller.id)?.id, '3.1::f');
});

test('SKIP parks a question and moves on', async () => {
  const { store, caseId, sender, seller } = setup();
  await startSession(store, sender, seller.id, { template: 'resume' });
  await handleInbound(store, sender, inbound({ text: 'go' }));
  const asked = lastAsked(store, seller.id);
  await handleInbound(store, sender, inbound({ text: 'SKIP' }));
  assert.equal(store.answers(caseId)[asked.id].status, 'parked');
  assert.notEqual(lastAsked(store, seller.id)?.id, asked.id, 'should have moved on to something else');
});

test('PAUSE stops the nudges for a week', async () => {
  const { store, sender, seller } = setup();
  await handleInbound(store, sender, inbound({ text: 'PAUSE' }));
  const p = store.getParticipant(seller.id);
  assert.ok(new Date(p.cadence.pauseUntil) > new Date());
  assert.match(sender.sent.at(-1).text.body, /Paused for a week/);
});

test('MENU shows the current cadence in plain English', async () => {
  const { store, sender, seller } = setup();
  await handleInbound(store, sender, inbound({ text: 'menu' }));
  assert.match(sender.sent.at(-1).text.body, /3 questions at a time/);
});

test('opting out switches the case to web only and stops messaging', async () => {
  const { store, caseId, sender, seller } = setup();
  await handleInbound(store, sender, inbound({ text: 'UNSUBSCRIBE' }));
  assert.equal(store.getParticipant(seller.id).cadence.channel, 'web_only');
  const results = await tick(store, sender);
  assert.equal(results.filter((r) => r.case === caseId).length, 0, 'no further nudges after opt-out');
});

test('an ambiguous reply asks for clarification rather than storing a guess', async () => {
  const { store, caseId, sender, seller } = setup();
  await startSession(store, sender, seller.id, { template: 'resume' });
  await handleInbound(store, sender, inbound({ text: 'go' }));
  // Force a multi-option question to be the one on the table.
  store.queue(caseId, seller.id, { channel: 'whatsapp', kind: 'question', payload: { itemId: '2.1a' } });
  const row = store.db.prepare('SELECT id FROM outbox ORDER BY id DESC LIMIT 1').get();
  store.markSent(row.id);
  const before = Object.keys(store.answers(caseId)).length;
  const res = await handleInbound(store, sender, inbound({ text: 'the wobbly fence' }));
  assert.equal(res.clarified, true);
  assert.equal(Object.keys(store.answers(caseId)).length, before, 'nothing should be stored from a guess');
});

test('a photo sent to the chat lands on the file', async () => {
  const { store, caseId, sender } = setup();
  await handleInbound(store, sender, { from: PHONE, kind: 'media', mediaId: 'm1', mime: 'image/jpeg' });
  assert.equal(store.attachments(caseId).length, 1);
  assert.match(sender.sent.map((m) => m.text?.body ?? '').join(' '), /Got the photo/);
});

test('messages from an unknown number are ignored', async () => {
  const { store, sender } = setup();
  const res = await handleInbound(store, sender, inbound({ from: '447000000000' }));
  assert.equal(res.ignored, 'unknown_sender');
});

test('answers given on WhatsApp and on the web are the same form', async () => {
  const { store, caseId, sender, seller } = setup();
  store.saveAnswer(caseId, '3.1', { value: 'No', source: 'whatsapp', by: seller.id });
  store.saveAnswer(caseId, '3.2', { value: 'No', source: 'web', by: seller.id });
  const p = store.progress(caseId);
  assert.equal(p.answered, 2);
  const data = buildExport(store, caseId);
  const sources = data.sections.flatMap((s) => s.rows).filter((r) => r.answer).map((r) => r.source);
  assert.deepEqual([...new Set(sources)].sort(), ['web', 'whatsapp']);
});

test('every answer keeps an audit trail, including changes of mind', async () => {
  const { store, caseId, seller } = setup();
  store.saveAnswer(caseId, '3.1', { value: 'No', source: 'whatsapp', by: seller.id, ip: '1.2.3.4' });
  store.saveAnswer(caseId, '3.1', { value: 'Yes', source: 'web', by: seller.id, ip: '5.6.7.8' });
  const history = store.history(caseId, '3.1');
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((h) => JSON.parse(h.value)), ['No', 'Yes']);
  assert.deepEqual(history.map((h) => h.source), ['whatsapp', 'web']);
  assert.equal(store.answers(caseId)['3.1'].value, 'Yes');
});

test('prefilled answers are marked for confirmation, not treated as the seller\'s word', async () => {
  const { store, caseId } = setup();
  const { prefilled } = await applyPrefill(store, caseId);
  assert.ok(prefilled.length > 0);
  for (const id of prefilled) {
    assert.equal(store.answers(caseId)[id].status, 'prefilled');
    assert.match(store.answers(caseId)[id].source, /^prefill:/);
  }
});

test('the form cannot be signed until it is complete, and needs every owner', async () => {
  const { store, caseId, seller } = setup();
  const second = store.addParticipant(caseId, { name: 'Ada Okafor', phone: '447700900124' });
  const answers = () => store.answers(caseId);
  for (let pass = 0; pass < 6; pass++) {
    for (const item of bank.items.filter((i) => (i.track ?? 'form') === 'form')) {
      if (answers()[item.id]) continue;
      const { isApplicable } = await import('../src/questions.js');
      if (!isApplicable(item, answers())) continue;
      store.saveAnswer(caseId, item.id, { value: item.t === 'multi' ? [item.opts.at(-1)] : 'No', by: seller.id });
    }
  }
  assert.equal(store.progress(caseId).percent, 100);

  const first = store.sign(caseId, seller.id);
  assert.equal(first.allSigned, false);
  assert.equal(store.getCase(caseId).status, 'collecting');

  const both = store.sign(caseId, second.id);
  assert.equal(both.allSigned, true);
  assert.equal(store.getCase(caseId).status, 'signed');
});

test('changing an answer after signing un-signs the form', async () => {
  const { store, caseId, seller } = setup();
  store.db.prepare(`UPDATE cases SET status = 'signed', signed_at = ? WHERE id = ?`).run(new Date().toISOString(), caseId);
  store.db.prepare('UPDATE participants SET signed_at = ? WHERE id = ?').run(new Date().toISOString(), seller.id);
  store.saveAnswer(caseId, '3.1', { value: 'Yes', by: seller.id });
  assert.equal(store.getCase(caseId).status, 'collecting');
  assert.equal(store.getParticipant(seller.id).signed_at, null);
  assert.ok(store.events(caseId).some((e) => e.kind === 'unsigned_by_amendment'));
});

test('the export names the gaps instead of hiding them', () => {
  const { store, caseId, seller } = setup();
  store.saveAnswer(caseId, '3.1', { value: 'No', by: seller.id });
  store.park(caseId, '3.2', { by: seller.id });
  const data = buildExport(store, caseId);
  assert.ok(data.outstanding.length > 0);
  assert.ok(data.outstanding.some((o) => o.status === 'parked'));
  const html = toHtml(data);
  assert.match(html, /still outstanding/);
  assert.match(html, /Disputes/);
  assert.ok(!html.includes('<script'), 'export must not carry script tags');
  const chase = toChaseList(data);
  assert.equal(chase.readyToSend, false);
});

test('the export escapes anything a seller typed', () => {
  const { store, caseId, seller } = setup();
  store.saveAnswer(caseId, '15.2', { value: '<script>alert(1)</script>', by: seller.id });
  const html = toHtml(buildExport(store, caseId));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('the worker nudges a quiet seller and then escalates', async () => {
  const { store, caseId, sender, seller } = setup();
  const daysAgo = (d) => new Date(Date.now() - d * 86400e3).toISOString();
  store.db.prepare('UPDATE participants SET last_nudge_at = ?, ignored_streak = 5 WHERE id = ?').run(daysAgo(5), seller.id);
  const results = await tick(store, sender);
  const mine = results.find((r) => r.case === caseId);
  assert.ok(mine, 'expected the worker to act on a silent seller');

  store.db.prepare('UPDATE participants SET last_nudge_at = ?, ignored_streak = 12 WHERE id = ?').run(daysAgo(30), seller.id);
  const escalated = await tick(store, sender);
  assert.equal(escalated.find((r) => r.case === caseId)?.action, 'handoff');
  assert.ok(store.events(caseId).some((e) => e.kind === 'handoff_to_human'));
});

test('the worker leaves a completed form alone', async () => {
  const { store, caseId, sender } = setup();
  store.db.prepare(`UPDATE cases SET status = 'signed' WHERE id = ?`).run(caseId);
  assert.deepEqual((await tick(store, sender)).filter((r) => r.case === caseId), []);
});

test('confirming pre-filled data over WhatsApp turns it into the seller\'s own answer', async () => {
  const { store, caseId, sender, seller } = setup();
  await applyPrefill(store, caseId);
  const before = store.answers(caseId)['1.1'];
  assert.equal(before.status, 'prefilled');
  assert.equal(store.progress(caseId).answered, 0, 'our guess is not their answer');
  assert.ok(store.progress(caseId).toConfirm > 0);

  await startSession(store, sender, seller.id, { template: 'resume' });
  await handleInbound(store, sender, inbound({ text: 'go' }));
  const asked = lastAsked(store, seller.id);
  assert.equal(asked.id, '1.1', 'a confirmation is the easiest possible opener');

  await handleInbound(store, sender, { from: PHONE, kind: 'choice', itemId: '1.1', value: wa.CONFIRM_YES });
  const after = store.answers(caseId)['1.1'];
  assert.equal(after.status, 'answered');
  assert.equal(after.source, 'whatsapp');
  assert.deepEqual(after.value, before.value, 'the confirmed value is the one we showed them');
  assert.equal(store.progress(caseId).answered, 1);
});

test('"not quite" sends them somewhere they can correct it', async () => {
  const { store, caseId, sender, seller } = setup();
  await applyPrefill(store, caseId);
  const res = await handleInbound(store, sender, { from: PHONE, kind: 'choice', itemId: '1.1', value: wa.CONFIRM_NO });
  assert.equal(res.correcting, '1.1');
  assert.match(sender.sent.at(-1).text.body, /put us right here/);
  assert.equal(store.answers(caseId)['1.1'].status, 'prefilled', 'still unconfirmed');
});

test('questions and paperwork are counted separately, and both gate readiness', async () => {
  const { store, caseId, seller } = setup();
  const { isApplicable } = await import('../src/questions.js');
  const answers = () => store.answers(caseId);

  // Answer every question, but send no documents.
  for (let pass = 0; pass < 8; pass++) {
    for (const item of bank.items.filter((i) => (i.track ?? 'form') === 'form')) {
      if (answers()[item.id] && answers()[item.id].status !== 'prefilled') continue;
      if (!isApplicable(item, answers())) continue;
      store.saveAnswer(caseId, item.id, { value: item.t === 'multi' ? [item.opts[0]] : (item.opts?.[0] ?? 'Yes'), by: seller.id });
    }
  }
  const data = buildExport(store, caseId);
  assert.equal(store.progress(caseId).percent, 100);
  assert.equal(data.outstanding.length, 0, 'no questions should be left');
  assert.ok(data.documentsOutstanding.length > 0, 'the answers promised documents that have not arrived');
  assert.equal(data.outstanding.some((o) => o.question === undefined), false);

  // Signed, but the certificates never came: not ready for a buyer.
  store.sign(caseId, seller.id);
  const chase = toChaseList(buildExport(store, caseId));
  assert.equal(chase.signed, true);
  assert.equal(chase.readyToSend, false, 'missing paperwork must block readiness');
  assert.ok(chase.documentsOutstanding > 0);
});

test('a pre-filled answer nobody confirmed still counts as outstanding', async () => {
  const { store, caseId } = setup();
  await applyPrefill(store, caseId);
  const data = buildExport(store, caseId);
  assert.ok(data.outstanding.some((o) => o.status === 'prefilled'), 'our guess is not a finished answer');
});

test('a TA10 checklist reads back as labels, not storage keys', async () => {
  const store = new Store(openDb(), bank).configureLinks({ secret: 's', baseUrl: 'https://app.test' });
  const c = store.createCase({ firm: 'Example & Co', address: '12 Example Street', forms: ['ta6', 'ta10'] });
  const seller = store.addParticipant(c.id, { name: 'Sam', phone: '447700900123' });

  store.saveAnswer(c.id, 'fc.2', {
    value: {
      fridge: { status: "I'm taking it", price: '£150' },
      dishwasher: { status: 'Stays' },
      range: { status: 'Not there' },
    },
    by: seller.id,
  });

  const data = buildExport(store, c.id);
  const row = data.sections.flatMap((s) => s.rows).find((r) => r.id === 'fc.2');
  assert.match(row.answer, /Fridge or fridge-freezer: I'm taking it \(would sell for £150\)/);
  assert.match(row.answer, /Dishwasher: Stays/);
  assert.equal(row.answer.includes('dishwasher:'), false, 'the storage key must not reach the form');
  assert.match(toHtml(data), /Fittings and Contents/);
});

test('adding TA10 to a case adds questions without touching the TA6 answers', () => {
  const store = new Store(openDb(), bank).configureLinks({ secret: 's', baseUrl: 'https://app.test' });
  const c = store.createCase({ firm: 'Example & Co', address: '1 Test Road' });
  const seller = store.addParticipant(c.id, { name: 'Sam', phone: '447700900123' });
  store.saveAnswer(c.id, '3.1', { value: 'No', by: seller.id });

  const before = store.progress(c.id);
  assert.deepEqual(store.formsFor(c.id), ['ta6']);

  store.setForms(c.id, ['ta6', 'ta10']);
  const after = store.progress(c.id);
  assert.ok(after.applicable > before.applicable, 'TA10 should add questions');
  assert.equal(after.answered, before.answered, 'existing TA6 answers must be untouched');
  assert.equal(store.answers(c.id)['3.1'].value, 'No');

  const data = buildExport(store, c.id);
  assert.match(data.form, /TA6 \+ TA10/);
  assert.ok(data.sections.some((s) => s.form === 'ta10'));
});

test('a TA6-only case never sees a TA10 section in its export', () => {
  const store = new Store(openDb(), bank).configureLinks({ secret: 's', baseUrl: 'https://app.test' });
  const c = store.createCase({ firm: 'Example & Co', address: '2 Test Road' });
  const data = buildExport(store, c.id);
  assert.equal(data.sections.some((s) => s.form === 'ta10'), false);
  assert.equal(data.form, 'TA6');
});

test('messaging channels hand a checklist to the web app rather than mangling it', async () => {
  const wa = await import('../src/channels/whatsapp.js');
  const sms = await import('../src/channels/sms.js');
  const checklist = bank.byId.get('fc.2');
  const w = wa.renderQuestion(checklist, { to: '4477', webLink: 'https://app.test/s/tok' });
  assert.equal(w.mode, 'web_handoff');
  assert.match(w.payload.text.body, /faster to tap through on a screen/);
  const m = sms.renderQuestion(checklist, { to: '4477', webLink: 'https://app.test/s/tok' });
  assert.equal(m.mode, 'web_handoff');
});
