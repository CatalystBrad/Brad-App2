// Walks a seller through the process end to end and prints the WhatsApp
// conversation as it would appear on their phone.
//   node --experimental-sqlite scripts/demo.js
import { writeFileSync, mkdirSync } from 'node:fs';
import { openDb } from '../src/db.js';
import { Store } from '../src/store.js';
import { loadBank } from '../src/questions.js';
import * as wa from '../src/channels/whatsapp.js';
import { startSession, handleInbound, lastAsked } from '../src/conversation.js';
import { applyPrefill } from '../src/prefill.js';
import { forecast, paperworkList } from '../src/batching.js';
import { buildExport, toHtml, toChaseList } from '../src/export/ta6.js';

const bank = loadBank();
const store = new Store(openDb(), bank).configureLinks({ secret: 'demo', baseUrl: 'https://info.catalyst.example' });

const c = store.createCase({
  ref: 'CAT/2026/0417', address: '12 Example Street, Leeds', postcode: 'LS1 1AA',
  firm: 'Catalyst Services', deadline: new Date(Date.now() + 28 * 86400000).toISOString(),
});
const seller = store.addParticipant(c.id, {
  name: 'Sam Okafor', phone: '447700900123', whatsappOptIn: true,
  cadence: { frequency: 'daily', window: { start: '00:00', end: '23:59' }, channel: 'whatsapp' },
  plan: { mode: 'count', size: 3 },
});

const sender = wa.createSender({});
const W = 62;

// Every line also goes into a transcript, so `--html <path>` can render the
// same conversation as the seller's phone shows it. One source of truth: the
// transcript is built from the payloads actually sent, never hand-written.
const transcript = [];
const htmlOut = process.argv.includes('--html') ? process.argv[process.argv.indexOf('--html') + 1] : null;

const rule = (label = '') => {
  console.log(`\n${label ? `── ${label} ` : ''}${'─'.repeat(Math.max(0, W - label.length - 4))}`);
  if (label) transcript.push({ kind: 'divider', label });
};

function printOut(payload) {
  const i = payload.interactive;
  const isTemplate = payload.type === 'template';
  const templateText = isTemplate
    ? wa.TEMPLATES[Object.keys(wa.TEMPLATES).find((k) => wa.TEMPLATES[k].name === payload.template.name)]
        .example.replace(/\{\{(\d)\}\}/g, (_, n) => payload.template.components[0].parameters[n - 1]?.text ?? '')
    : null;
  const body = i?.body?.text ?? payload.text?.body ?? (isTemplate ? `[template: ${payload.template.name}]\n${templateText}` : '');
  for (const line of String(body).split('\n')) console.log(`   │ ${line}`);
  const buttons = i?.action?.buttons?.map((b) => b.reply.title);
  const rows = i?.action?.sections?.[0]?.rows?.map((r) => r.title);
  if (buttons) console.log(`   │ [ ${buttons.join(' ] [ ')} ]`);
  if (rows) console.log(`   │ ▾ ${i.action.button}: ${rows.slice(0, 4).join(' / ')}${rows.length > 4 ? ` … ${rows.length} options` : ''}`);
  if (i?.footer) console.log(`   │ ${i.footer.text}`);
  console.log('   ╰──');

  transcript.push({
    kind: 'out',
    template: isTemplate ? payload.template.name : null,
    body: isTemplate ? templateText : String(body),
    buttons: buttons ?? null,
    list: rows ? { label: i.action.button, rows } : null,
    footer: i?.footer?.text ?? null,
  });
}

let shown = 0;
const drain = () => { for (const p of sender.sent.slice(shown)) printOut(p); shown = sender.sent.length; };
async function seller_says(text, kind = 'text', extra = {}) {
  console.log(`\n   Sam ▸ ${text}`);
  transcript.push({ kind: 'in', body: text, tapped: false, media: kind === 'media' });
  await handleInbound(store, sender, { from: '447700900123', kind, text, ...extra });
  drain();
}

rule('BEFORE ANY QUESTION IS ASKED');
const { prefilled, notes } = await applyPrefill(store, c.id);
console.log(`   ${prefilled.length} answers pre-filled from public data - the seller only confirms these.`);
for (const [id, note] of Object.entries(notes).slice(0, 6)) console.log(`     ${id.padEnd(9)} ${note}`);
const f0 = forecast(bank, store.answers(c.id), seller.plan, 1);
console.log(`\n   Cold TA6: ${bank.questions.length} fields, ~${Math.round(bank.questions.reduce((a, q) => a + q.secs + (q.followUp?.secs ?? 0), 0) / 60)} minutes in one sitting.`);
console.log(`   This seller: ${f0.questionsLeft} applicable items, ~${Math.ceil(f0.secondsLeft / 60)} minutes, split into ${f0.sessionsLeft} goes of 3.`);

rule('DAY 1 - THE INVITE');
await startSession(store, sender, seller.id, { template: 'invite', ignoreWindow: true });
drain();
await seller_says('yes go on then');

const answersFor = { '1.4': 'Owner (seller)', '5.9': 'Not known', '3.2': 'No' };
async function answerWhateverIsAsked(override) {
  const asked = lastAsked(store, seller.id);
  if (!asked) return null;
  const current = store.answers(c.id)[asked.id];
  if (current?.status === 'prefilled') {
    console.log(`\n   Sam ▸ [taps ${wa.CONFIRM_YES}]`);
    transcript.push({ kind: 'in', body: wa.CONFIRM_YES, tapped: true });
    await handleInbound(store, sender, { from: '447700900123', kind: 'choice', itemId: asked.id, value: wa.CONFIRM_YES });
    drain();
    return asked.id;
  }
  const value = override ?? answersFor[asked.id] ?? (asked.t === 'yesno' ? 'No' : asked.opts?.[0] ?? 'Not known');
  if (asked.opts || asked.t === 'yesno') {
    console.log(`\n   Sam ▸ [taps ${value}]`);
    transcript.push({ kind: 'in', body: value, tapped: true });
    await handleInbound(store, sender, { from: '447700900123', kind: 'choice', itemId: asked.id, value });
  } else {
    console.log(`\n   Sam ▸ ${value}`);
    transcript.push({ kind: 'in', body: String(value), tapped: false });
    await handleInbound(store, sender, { from: '447700900123', kind: 'text', text: String(value) });
  }
  drain();
  return asked.id;
}
for (let i = 0; i < 3; i++) await answerWhateverIsAsked();

rule('DAY 2 - THREE MORE, AND A CHANGE OF MIND ABOUT CADENCE');
await startSession(store, sender, seller.id, { ignoreWindow: true });
drain();
await seller_says('menu');
await seller_says('5');
await seller_says('EVENINGS');
for (let i = 0; i < 2; i++) await answerWhateverIsAsked();

rule('A QUESTION SAM CANNOT ANSWER YET');
await seller_says('SKIP');

rule('AN AMBIGUOUS ANSWER IS NOT GUESSED AT');
store.queue(c.id, seller.id, { channel: 'whatsapp', kind: 'question', payload: { itemId: '2.1a' } });
store.markSent(store.db.prepare('SELECT id FROM outbox ORDER BY id DESC LIMIT 1').get().id);
console.log('   (Sam is on boundaries: who maintains the left-hand fence?)');
await seller_says('the wobbly one next to the shed');
await seller_says('2');

rule('SAM DECLARES A DISPUTE - THE FOLLOW-UP COMES STRAIGHT BACK');
store.saveAnswer(c.id, '3.1', { value: 'Yes', source: 'whatsapp', by: seller.id });
await seller_says('MORE');
await seller_says('Next door complained about our extension in 2019. Council looked at it, no action taken, nothing since.');

rule('PAPERWORK COMES BACK AS A PHOTO, NOT A FORM');
await seller_says('[photo of FENSA certificate]', 'media', { mediaId: 'media-fensa-1', mime: 'image/jpeg' });

rule('GOING ON HOLIDAY');
await seller_says('PAUSE');

rule('WHERE THE FILE STANDS');
const p = store.progress(c.id);
const f = forecast(bank, store.answers(c.id), store.getParticipant(seller.id).plan, 1);
console.log(`   ${p.answered} of ${p.applicable} answered (${p.percent}%) · ${p.parked} parked · ~${p.minutesLeft} min of questions left`);
console.log(`   Forecast: ${f.sessionsLeft} more sittings, ~${f.daysLeft} days at one a day`);
const paper = paperworkList(bank, store.answers(c.id));
console.log(`   Paperwork: ${paper.filter((x) => x.done).length} of ${paper.length} documents in`);
for (const doc of paper.filter((x) => !x.done).slice(0, 4)) console.log(`     ○ ${doc.label}`);

rule('WHAT THE CONVEYANCER SEES');
const data = buildExport(store, c.id);
const chase = toChaseList(data);
console.log(`   ${chase.address} · ${chase.percent}% · ready to send: ${chase.readyToSend}`);
console.log(`   Blocking (${chase.blocking.length}):`);
for (const b of chase.blocking.slice(0, 5)) console.log(`     ${String(b.number).padEnd(8)} ${b.status.padEnd(11)} ${b.question.slice(0, 48)}`);
console.log(`   Audit trail: ${data.auditTrail.length} entries (every answer, when, and which channel)`);
mkdirSync('out', { recursive: true });
writeFileSync('out/ta6-export.html', toHtml(data));
writeFileSync('out/ta6-export.json', JSON.stringify(data, null, 2));
console.log('\n   Wrote out/ta6-export.html and out/ta6-export.json');

if (htmlOut) {
  writeFileSync(htmlOut, renderTranscript(transcript, store.brandFor(c.id)));
  console.log(`   Wrote ${htmlOut}`);
}

function renderTranscript(entries, brand) {
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  // WhatsApp renders _underscores_ as italics; show that rather than the marks.
  const fmt = (t) => esc(t).replace(/_([^_]+)_/g, '<i>$1</i>');

  const bubbles = entries.map((e) => {
    if (e.kind === 'divider') return `<div class="divider"><span>${esc(e.label)}</span></div>`;
    if (e.kind === 'in') {
      return `<div class="row me"><div class="bubble me">${e.tapped ? `<span class="tap">tapped</span> ` : ''}${fmt(e.body)}</div></div>`;
    }
    return `<div class="row them"><div class="bubble them">
      ${e.template ? `<div class="tpl">approved template · ${esc(e.template)}</div>` : ''}
      <div class="body">${fmt(e.body)}</div>
      ${e.footer ? `<div class="foot">${esc(e.footer)}</div>` : ''}
      ${e.buttons ? `<div class="btns">${e.buttons.map((b) => `<span>${esc(b)}</span>`).join('')}</div>` : ''}
      ${e.list ? `<div class="listbtn">${esc(e.list.label)} · ${e.list.rows.length} options</div>` : ''}
    </div></div>`;
  }).join('\n');

  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>What the seller sees</title>
<style>
  :root { --bg:#e9e2db; --them:#ffffff; --me:#d6f5c7; --ink:#101b1a; --muted:#61706e; --bar:${brand.colour ?? '#0F6E5C'}; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#0d1513; --them:#1f2c2a; --me:#134d3a; --ink:#e7eee9; --muted:#93a5a1; } }
  :root[data-theme="dark"] { --bg:#0d1513; --them:#1f2c2a; --me:#134d3a; --ink:#e7eee9; --muted:#93a5a1; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .phone { max-width: 26rem; margin: 0 auto; padding: 0 16px 40px; }
  .topbar { position: sticky; top: 0; background: var(--bar); color: #fff; padding: 14px 16px; margin: 0 -16px 14px; display:flex; align-items:center; gap:.7rem; }
  .avatar { width: 34px; height: 34px; border-radius: 99px; background: rgba(255,255,255,.22); display:grid; place-items:center; font-weight:700; font-size:.82rem; }
  .who { font-weight: 600; font-size: .95rem; }
  .sub { font-size: .72rem; opacity: .85; }
  .divider { text-align:center; margin: 20px 0 12px; }
  .divider span { background: rgba(0,0,0,.09); color: var(--muted); font-size:.68rem; letter-spacing:.09em; text-transform:uppercase; padding:.3rem .7rem; border-radius:99px; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .divider span { background: rgba(255,255,255,.08); } }
  .row { display:flex; margin-bottom:8px; }
  .row.me { justify-content:flex-end; }
  .bubble { max-width: 84%; padding: 9px 12px; border-radius: 12px; box-shadow: 0 1px 1px rgba(0,0,0,.08); }
  .bubble.them { background: var(--them); border-top-left-radius: 3px; }
  .bubble.me { background: var(--me); border-top-right-radius: 3px; }
  .bubble i { color: var(--muted); font-style: italic; }
  .body { white-space: pre-wrap; }
  .tpl { font-size:.66rem; letter-spacing:.07em; text-transform:uppercase; color:var(--muted); margin-bottom:.4rem; }
  .foot { font-size:.72rem; color:var(--muted); margin-top:.5rem; }
  .btns { display:grid; gap:4px; margin:.6rem -12px -9px; }
  .btns span { text-align:center; padding:9px; border-top:1px solid rgba(0,0,0,.08); color:#128c7e; font-weight:600; font-size:.88rem; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .btns span { border-top-color: rgba(255,255,255,.1); color:#6fd6bf; } }
  .listbtn { text-align:center; margin:.6rem -12px -9px; padding:9px; border-top:1px solid rgba(0,0,0,.08); color:#128c7e; font-weight:600; font-size:.88rem; }
  .tap { font-size:.66rem; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
  footer { max-width:26rem; margin:0 auto; padding:0 16px 40px; color:var(--muted); font-size:.78rem; }
</style></head><body>
<div class="phone">
  <div class="topbar">
    <div class="avatar">${esc((brand.firmName ?? 'HB').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase())}</div>
    <div><div class="who">${esc(brand.firmName ?? 'Your solicitor')}</div><div class="sub">Business account</div></div>
  </div>
  ${bubbles}
</div>
<footer>Generated by <code>scripts/demo.js --html</code> from the messages the system actually sent. Nothing here is mocked up.</footer>
</body></html>`;
}
