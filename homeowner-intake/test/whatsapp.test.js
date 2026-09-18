import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBank } from '../src/questions.js';
import * as wa from '../src/channels/whatsapp.js';

const bank = loadBank();
const to = '447700900123';

test('a yes/no question becomes three tappable buttons', () => {
  const { payload, mode } = wa.renderQuestion(bank.byId.get('3.1'), { to, webLink: 'https://x/y' });
  assert.equal(mode, 'interactive');
  assert.equal(payload.interactive.type, 'button');
  const buttons = payload.interactive.action.buttons;
  assert.equal(buttons.length, 3);
  assert.deepEqual(buttons.map((b) => b.reply.title), ['Yes', 'No', wa.PARK_TITLE]);
});

test('every button title stays inside WhatsApp limits', () => {
  for (const item of bank.items) {
    const { payload } = wa.renderQuestion(item, { to, webLink: 'https://x/y' });
    const buttons = payload.interactive?.action?.buttons ?? [];
    assert.ok(buttons.length <= wa.LIMITS.buttons, `${item.id}: too many buttons`);
    for (const b of buttons) assert.ok(b.reply.title.length <= wa.LIMITS.buttonTitle, `${item.id}: button title too long`);
    const rows = payload.interactive?.action?.sections?.[0]?.rows ?? [];
    assert.ok(rows.length <= wa.LIMITS.rows, `${item.id}: too many list rows`);
    for (const r of rows) assert.ok(r.title.length <= wa.LIMITS.rowTitle, `${item.id}: row title too long`);
    const body = payload.interactive?.body?.text ?? payload.text?.body ?? '';
    assert.ok(body.length <= wa.LIMITS.body, `${item.id}: body over 1024 chars (${body.length})`);
  }
});

test('a long option list becomes a list message, not buttons', () => {
  const { payload } = wa.renderQuestion(bank.byId.get('5.1'), { to });
  assert.equal(payload.interactive.type, 'list');
  assert.equal(payload.interactive.action.sections[0].rows.length, wa.LIMITS.rows);
});

test('uploads and multi-field blocks hand over to the web app', () => {
  const upload = wa.renderQuestion(bank.byId.get('2.5::doc'), { to, webLink: 'https://x/y' });
  assert.equal(upload.mode, 'web_handoff');
  assert.match(upload.payload.text.body, /https:\/\/x\/y/);
  const block = wa.renderQuestion(bank.byId.get('12.elec'), { to, webLink: 'https://x/y' });
  assert.equal(block.mode, 'web_handoff');
});

test('free-text questions are sent as plain text', () => {
  const { mode, payload } = wa.renderQuestion(bank.byId.get('15.2'), { to });
  assert.equal(mode, 'text');
  assert.match(payload.text.body, /type your answer/i);
});

test('progress is shown in the footer so the seller can see the end', () => {
  const { payload } = wa.renderQuestion(bank.byId.get('3.1'), { to, progress: { answered: 12, applicable: 60, minutesLeft: 18 } });
  assert.match(payload.interactive.footer.text, /12\/60 done/);
  assert.ok(payload.interactive.footer.text.length <= wa.LIMITS.footer);
});

test('reply ids round-trip, including awkward option text', () => {
  const option = "None of these - it all goes to mains sewer";
  const decoded = wa.decodeReplyId(wa.replyId('11.6', option));
  assert.deepEqual(decoded, { itemId: '11.6', option });
});

test('a webhook button reply is parsed into an answer', () => {
  const body = {
    entry: [{ changes: [{ value: { messages: [{
      from: to, id: 'wamid.1', timestamp: '1780000000', type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: wa.replyId('3.1', 'No'), title: 'No' } },
    }] } }] }],
  };
  const [msg] = wa.parseInbound(body);
  assert.equal(msg.kind, 'choice');
  assert.equal(msg.itemId, '3.1');
  assert.equal(msg.value, 'No');
});

test('photos and documents are parsed as media', () => {
  const body = { entry: [{ changes: [{ value: { messages: [{ from: to, id: 'w2', type: 'image', image: { id: 'media1', mime_type: 'image/jpeg' } }] } }] }] };
  const [msg] = wa.parseInbound(body);
  assert.equal(msg.kind, 'media');
  assert.equal(msg.mediaId, 'media1');
});

test('a webhook with only status callbacks yields no messages', () => {
  const body = { entry: [{ changes: [{ value: { statuses: [{ id: 'w1', status: 'delivered' }] } }] }] };
  assert.deepEqual(wa.parseInbound(body), []);
});

test('natural yes/no replies are understood', () => {
  const q = bank.byId.get('3.1');
  assert.deepEqual(wa.interpretText('yes', q), { action: 'answer', value: 'Yes' });
  assert.deepEqual(wa.interpretText('Nope', q), { action: 'answer', value: 'No' });
  assert.deepEqual(wa.interpretText('  Y ', q), { action: 'answer', value: 'Yes' });
});

test('an ambiguous reply is never guessed into a legal answer', () => {
  const q = bank.byId.get('2.1a');
  const result = wa.interpretText('the one by the shed I think', q);
  assert.equal(result.action, 'clarify');
  assert.ok(result.options.length > 0);
  assert.match(wa.clarifyMessage(result.options), /1\. Me \(the seller\)/);
});

test('replying with a list number picks that option', () => {
  const q = bank.byId.get('2.1a');
  assert.deepEqual(wa.interpretText('2', q), { action: 'answer', value: 'The neighbour' });
});

test('not sure maps to the form\'s own not-known option', () => {
  assert.deepEqual(wa.interpretText('no idea', bank.byId.get('2.1a')), { action: 'answer', value: 'Not known' });
  assert.deepEqual(wa.interpretText('no idea', bank.byId.get('3.1')), { action: 'unknown' });
});

test('keywords are commands, not answers', () => {
  assert.deepEqual(wa.interpretText('PAUSE', bank.byId.get('3.1')), { action: 'pause' });
  assert.deepEqual(wa.interpretText('menu', bank.byId.get('3.1')), { action: 'menu' });
  assert.deepEqual(wa.interpretText('skip', bank.byId.get('3.1')), { action: 'park' });
  assert.deepEqual(wa.interpretText('STOP ALL'.replace(' ', ''), bank.byId.get('3.1')), { action: 'optout' });
});

test('free text is taken verbatim for a text question', () => {
  const q = bank.byId.get('15.2');
  assert.deepEqual(wa.interpretText('The garage roof was redone in 2019.', q), { action: 'answer', value: 'The garage roof was redone in 2019.' });
});

test('templates render with the right parameter count', () => {
  const payload = wa.renderTemplate('invite', ['Sam', 'Catalyst', '12 Example Street'], to);
  assert.equal(payload.template.name, 'ta6_invite');
  assert.equal(payload.template.language.code, 'en_GB');
  assert.equal(payload.template.components[0].parameters.length, 3);
  assert.throws(() => wa.renderTemplate('nope', [], to), /unknown template/);
});

test('the dry-run sender records instead of sending', async () => {
  const sender = wa.createSender({});
  assert.equal(sender.dryRun, true);
  await sender.send({ hello: 'world' });
  assert.equal(sender.sent.length, 1);
});

test('a pre-filled answer becomes a one-tap confirmation, whatever the field type', () => {
  const item = bank.byId.get('1.1');   // an address field
  const { mode, payload } = wa.renderQuestion(item, { to, prefilled: { address: '12 Example Street', postcode: 'LS1 1AA' } });
  assert.equal(mode, 'interactive');
  assert.deepEqual(payload.interactive.action.buttons.map((b) => b.reply.title), [wa.CONFIRM_YES, wa.CONFIRM_NO, wa.PARK_TITLE]);
  assert.match(payload.interactive.body.text, /12 Example Street, LS1 1AA/);
  for (const b of payload.interactive.action.buttons) assert.ok(b.reply.title.length <= wa.LIMITS.buttonTitle);
});

test('typing yes to a confirmation confirms it', () => {
  assert.deepEqual(wa.interpretText('yes', bank.byId.get('1.1')), { action: 'confirm' });
  assert.deepEqual(wa.interpretText("that's right", bank.byId.get('5.7')), { action: 'confirm' });
});

test('where "Yes" is one of the form\'s own options it stays an answer, not a confirmation', () => {
  // 5.7 is confirmable AND has Yes/No/Not known options: "yes" must mean the
  // option, or we would put the opposite of the truth on a legal document.
  assert.deepEqual(wa.interpretText('yes', bank.byId.get('5.7')), { action: 'answer', value: 'Yes' });
});
