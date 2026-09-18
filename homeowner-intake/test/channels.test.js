import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { Store } from '../src/store.js';
import { loadBank } from '../src/questions.js';
import { getChannel, createDispatcher, CHANNEL_NAMES, isSendable } from '../src/channels/index.js';
import * as sms from '../src/channels/sms.js';
import * as email from '../src/channels/email.js';
import { startSession, handleInbound, lastAsked, tick } from '../src/conversation.js';

const bank = loadBank();

function setup({ channel = 'sms', plan, cadence } = {}) {
  const store = new Store(openDb(), bank).configureLinks({ secret: 's', baseUrl: 'https://app.test' });
  const firm = store.createFirm({ name: 'Example & Co', brand: { colour: '#0F6E5C', fromName: 'Rachel at Example & Co', signOff: 'Rachel' } });
  const c = store.createCase({ firmId: firm.id, ref: 'EX/1', address: '12 Example Street, Leeds', postcode: 'LS1 1AA' });
  const seller = store.addParticipant(c.id, {
    name: 'Sam Okafor', phone: '447700900123', email: 'sam@example.com',
    cadence: { channel, window: { start: '00:00', end: '23:59' }, ...(cadence ?? {}) },
    plan: { mode: 'count', size: 3, ...(plan ?? {}) },
  });
  return { store, firm, caseId: c.id, seller, dispatcher: createDispatcher() };
}

test('every channel implements the same interface', () => {
  for (const name of CHANNEL_NAMES) {
    const ch = getChannel(name);
    for (const fn of ['renderQuestion', 'renderText', 'renderOpener', 'needsOpener', 'parseInbound', 'createSender']) {
      assert.equal(typeof ch[fn], 'function', `${name} is missing ${fn}`);
    }
    assert.ok(['conversational', 'digest'].includes(ch.style), `${name} has no style`);
  }
});

test('web_only and the human handoff are not sendable channels', () => {
  assert.equal(isSendable('web_only'), false);
  assert.equal(isSendable('call_from_solicitor'), false);
  assert.equal(isSendable('sms'), true);
});

// ---- SMS -------------------------------------------------------------------

test('SMS renders choices as numbered options inside one segment', () => {
  const { mode, payload } = sms.renderQuestion(bank.byId.get('3.1'), { to: '447700900123' });
  assert.equal(mode, 'text');
  assert.match(payload.body, /1 Yes, 2 No, 3 I'll check/);
  assert.equal(sms.segments(payload.body), 1, 'a yes/no question should cost one segment');
});

test('SMS strips characters that double the cost of a message', () => {
  const body = sms.toGsm('It’s “fine” — really…');
  assert.equal(body, `It's "fine" - really...`);
  assert.equal(/[‘’“”–—…]/.test(body), false);
});

test('SMS hands long option lists and uploads to the web app', () => {
  const long = sms.renderQuestion(bank.byId.get('5.1'), { to: '4477', webLink: 'https://app.test/s/tok' });
  assert.equal(long.mode, 'web_handoff');
  assert.match(long.payload.body, /https:\/\/app\.test\/s\/tok/);
  const upload = sms.renderQuestion(bank.byId.get('2.5::doc'), { to: '4477', webLink: 'https://app.test/s/tok' });
  assert.equal(upload.mode, 'web_handoff');
});

test('no SMS we send exceeds two segments', () => {
  for (const item of bank.items) {
    const { payload } = sms.renderQuestion(item, { to: '4477', webLink: 'https://app.test/s/abcdefghijklmnop' });
    assert.ok(sms.segments(payload.body) <= 2, `${item.id} would cost ${sms.segments(payload.body)} segments`);
  }
});

test('a pre-filled value is a numbered confirmation over SMS too', () => {
  const { payload, options } = sms.renderQuestion(bank.byId.get('1.1'), { to: '4477', prefilled: { address: '12 Example Street' } });
  assert.match(payload.body, /We have: 12 Example Street/);
  assert.deepEqual(options, ["That's right", 'Not quite', "I'll check"]);
});

test('a Twilio webhook becomes a normalised message', () => {
  const [msg] = sms.parseInbound({ From: '+447700900123', Body: '2', MessageSid: 'SM1', NumMedia: '0' });
  assert.equal(msg.kind, 'text');
  assert.equal(msg.channel, 'sms');
  assert.equal(msg.text, '2');
  const [pic] = sms.parseInbound({ From: '+447700900123', NumMedia: '1', MediaUrl0: 'https://api/x.jpg', MediaContentType0: 'image/jpeg' });
  assert.equal(pic.kind, 'media');
});

test('SMS drives a whole session', async () => {
  const { store, caseId, seller, dispatcher } = setup({ channel: 'sms' });
  await startSession(store, dispatcher, seller.id, { ignoreWindow: true });
  assert.ok(dispatcher.lastTo('sms'), 'should have sent over SMS');

  const asked = lastAsked(store, seller.id);
  assert.ok(asked, 'a question should be on the table');
  await handleInbound(store, dispatcher, { from: '+447700900123', channel: 'sms', kind: 'text', text: '1' });
  assert.ok(store.answers(caseId)[asked.id], 'the numbered reply should be stored');
  assert.equal(store.answers(caseId)[asked.id].source, 'sms');
});

test('STOP over SMS always means opt out, never skip', async () => {
  const { store, seller, dispatcher } = setup({ channel: 'sms' });
  await startSession(store, dispatcher, seller.id, { ignoreWindow: true });
  const res = await handleInbound(store, dispatcher, { from: '+447700900123', channel: 'sms', kind: 'text', text: 'STOP' });
  assert.equal(res.optedOut, true);
  assert.equal(store.getParticipant(seller.id).cadence.channel, 'web_only');
  assert.match(dispatcher.lastTo('sms').body, /not hear from me on sms again/i);
});

// ---- email -----------------------------------------------------------------

test('email sends a digest with the questions coming up and one link', async () => {
  const { store, seller, dispatcher } = setup({ channel: 'email' });
  const res = await startSession(store, dispatcher, seller.id, { template: 'invite', ignoreWindow: true });
  assert.equal(res.opened, 'digest');
  assert.ok(res.questions >= 1);

  const sent = dispatcher.lastTo('email');
  assert.equal(sent.to, 'sam@example.com');
  assert.match(sent.subject, /Example & Co/);
  assert.match(sent.html, /https:\/\/app\.test\/s\//);
  assert.match(sent.html, /#0F6E5C/, 'the firm\'s colour should reach the email');
  assert.match(sent.text, /Rachel/, 'the sign-off should be the firm\'s, not ours');
  assert.ok(sent.html.includes('Answer these now'));
});

test('email escapes anything that came from a firm or a question', () => {
  const msg = email.renderDigest('resume', {
    to: 'x@y.z',
    brand: { firmName: '<script>alert(1)</script>', fromName: 'A', colour: '#000', signOff: 'B' },
    webLink: 'https://app.test/s/t',
    items: [{ q: '<img onerror=alert(1)>' }],
  });
  assert.ok(!msg.html.includes('<script>alert(1)</script>'));
  assert.ok(!msg.html.includes('<img onerror'));
  assert.match(msg.html, /&lt;script&gt;/);
});

test('email never tries to hold a conversation', () => {
  assert.deepEqual(email.parseInbound({ anything: true }), []);
  assert.equal(email.style, 'digest');
});

// ---- escalation across channels --------------------------------------------

test('a seller ignoring WhatsApp is moved to SMS, and the move is on the file', async () => {
  const { store, caseId, seller, dispatcher } = setup({ channel: 'whatsapp' });
  store.db.prepare('UPDATE participants SET last_nudge_at = ?, ignored_streak = 4 WHERE id = ?')
    .run(new Date(Date.now() - 6 * 86400000).toISOString(), seller.id);

  const results = await tick(store, dispatcher, {});
  const mine = results.find((r) => r.case === caseId);
  assert.ok(mine, 'the worker should have acted');
  assert.equal(store.getParticipant(seller.id).cadence.channel, 'sms', 'should have switched channel');
  assert.ok(store.events(caseId).some((e) => e.kind === 'channel_escalated'), 'the switch should be recorded');
  assert.ok(dispatcher.sent.some((s) => s.channel === 'sms'));
});

test('escalation never invents a contact route the seller has not given', async () => {
  const store = new Store(openDb(), bank).configureLinks({ secret: 's', baseUrl: 'https://app.test' });
  const firm = store.createFirm({ name: 'Example & Co' });
  const c = store.createCase({ firmId: firm.id, address: '1 Test Road' });
  const seller = store.addParticipant(c.id, {
    name: 'No Email', phone: '447700900555',   // no email address on file
    cadence: { channel: 'whatsapp', window: { start: '00:00', end: '23:59' } },
  });
  store.db.prepare('UPDATE participants SET last_nudge_at = ?, ignored_streak = 7 WHERE id = ?')
    .run(new Date(Date.now() - 30 * 86400000).toISOString(), seller.id);
  const dispatcher = createDispatcher();
  await tick(store, dispatcher, {});
  assert.notEqual(store.getParticipant(seller.id).cadence.channel, 'email', 'must not switch to a channel with no address');
});
