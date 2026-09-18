// Seeds a firm with a spread of realistic files, so the dashboard can be seen
// doing its job. Prints the staff key to sign in with.
//   node --experimental-sqlite scripts/seed.js
import { openDb } from '../src/db.js';
import { Store } from '../src/store.js';
import { loadBank, isApplicable } from '../src/questions.js';
import { applyPrefill } from '../src/prefill.js';
import { createDispatcher } from '../src/channels/index.js';
import { startSession } from '../src/conversation.js';

const bank = loadBank();
const dbPath = process.env.DB_PATH ?? 'seed.db';
const store = new Store(openDb(dbPath), bank).configureLinks({
  secret: process.env.LINK_SECRET ?? 'dev-secret-change-me',
  baseUrl: process.env.BASE_URL ?? 'http://localhost:8787',
});
const dispatcher = createDispatcher();

const firm = store.ensureFirm('Hardcastle & Byrne', {
  brand: { colour: '#0F6E5C', fromName: 'Rachel at Hardcastle & Byrne', signOff: 'Rachel Byrne' },
});
const admin = store.addStaff(firm.id, { email: 'rachel@hardcastle.test', name: 'Rachel Byrne', role: 'admin' });

const FILES = [
  { ref: 'HB/2026/0101', address: '12 Example Street, Leeds', postcode: 'LS1 1AA', seller: 'Sam Okafor', channel: 'whatsapp', answer: 0.15, quietDays: 0, ignored: 0 },
  { ref: 'HB/2026/0102', address: '4 Mill Lane, Otley', postcode: 'LS21 3AB', seller: 'Priya Raman', channel: 'whatsapp', answer: 0.62, quietDays: 1, ignored: 0 },
  { ref: 'HB/2026/0103', address: 'Flat 2, 19 Cardigan Road', postcode: 'LS6 1BB', seller: 'Tom Whitfield', channel: 'sms', answer: 0.31, quietDays: 9, ignored: 4 },
  { ref: 'HB/2026/0104', address: 'The Old Forge, Bramhope', postcode: 'LS16 9AA', seller: 'Eleanor Hyde', channel: 'email', answer: 0.88, quietDays: 3, ignored: 0, deadlineDays: 5 },
  { ref: 'HB/2026/0105', address: '77 Harrogate Road', postcode: 'LS7 4LA', seller: 'Marcus Bell', channel: 'whatsapp', answer: 1, quietDays: 2, ignored: 0, sign: false },
  { ref: 'HB/2026/0106', address: '3 Kirkstall View', postcode: 'LS5 3EF', seller: 'Nadia Farouk', channel: 'whatsapp', answer: 1, quietDays: 6, ignored: 0, sign: true },
];

for (const f of FILES) {
  const c = store.createCase({
    firmId: firm.id, ownerId: admin.id, ref: f.ref, address: f.address, postcode: f.postcode,
    deadline: f.deadlineDays ? new Date(Date.now() + f.deadlineDays * 86400000).toISOString() : null,
  });
  const seller = store.addParticipant(c.id, {
    name: f.seller,
    phone: `4477009${String(Math.floor(Math.random() * 90000) + 10000)}`,
    email: `${f.seller.split(' ')[0].toLowerCase()}@example.test`,
    whatsappOptIn: f.channel === 'whatsapp',
    cadence: { channel: f.channel, frequency: 'daily', window: { start: '00:00', end: '23:59' } },
    plan: { mode: 'count', size: 3 },
  });
  await applyPrefill(store, c.id);

  // Answer up to a realistic share of the form. The target has to be measured
  // against what actually applies to this house, which grows and shrinks as
  // answers come in - not against the full bank.
  const targetPercent = Math.round(f.answer * 100);
  for (let pass = 0; pass < 10 && store.progress(c.id).percent < targetPercent; pass++) {
    for (const item of bank.items) {
      if (store.progress(c.id).percent >= targetPercent) break;
      if ((item.track ?? 'form') !== 'form') continue;
      const answers = store.answers(c.id);
      if (answers[item.id] && answers[item.id].status !== 'prefilled') continue;
      if (!isApplicable(item, answers)) continue;
      const value = item.t === 'multi'
        ? [item.opts.at(-1)]
        : item.opts ? item.opts[0] : item.t === 'yesno' ? 'No' : 'Not known';
      store.saveAnswer(c.id, item.id, { value, source: f.channel, by: seller.id });
    }
  }

  // A couple of files have the seller mid-thought on something.
  if (f.answer < 1) {
    const parkable = bank.items.find((i) => (i.track ?? 'form') === 'form' && !store.answers(c.id)[i.id] && isApplicable(i, store.answers(c.id)));
    if (parkable) store.park(c.id, parkable.id, { by: seller.id, source: f.channel });
  }

  if (f.sign) store.sign(c.id, seller.id);

  const activity = new Date(Date.now() - f.quietDays * 86400000).toISOString();
  store.db.prepare('UPDATE participants SET last_activity_at = ?, last_nudge_at = ?, ignored_streak = ? WHERE id = ?')
    .run(activity, activity, f.ignored, seller.id);

  if (f.channel === 'whatsapp') await startSession(store, dispatcher, seller.id, { template: 'invite', ignoreWindow: true });
  console.log(`${f.ref.padEnd(14)} ${String(store.progress(c.id).percent).padStart(3)}%  ${f.address}`);
}

console.log(`\nDatabase: ${dbPath}`);
console.log(`Staff key: ${admin.key}`);
console.log(`\nStart the server against it, then sign in at /staff:`);
console.log(`  DB_PATH=${dbPath} node --experimental-sqlite src/server.js`);
