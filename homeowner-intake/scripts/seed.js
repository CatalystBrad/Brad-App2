// Seeds a firm with a spread of realistic files, so the dashboard can be seen
// doing its job. Prints the staff key to sign in with.
//   node --experimental-sqlite scripts/seed.js            just seed
//   node --experimental-sqlite scripts/seed.js --serve    seed, then start the
//                                                         server and print the
//                                                         links to open
import { networkInterfaces } from 'node:os';
import { rmSync } from 'node:fs';
import { openDb } from '../src/db.js';
import { Store } from '../src/store.js';
import { loadBank, isApplicable } from '../src/questions.js';
import { applyPrefill } from '../src/prefill.js';
import { createDispatcher } from '../src/channels/index.js';
import { startSession } from '../src/conversation.js';

const serve = process.argv.includes('--serve');
const port = Number(process.env.PORT ?? 8787);

// The address of this machine on the local network, so a link can be opened
// on a phone on the same wifi. Falls back to localhost.
function lanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}
const lan = lanAddress();
// Links have to carry an address the phone can reach, so decide it before
// seeding - and tell the server the same one, so its links match.
const baseUrl = process.env.BASE_URL ?? (serve ? `http://${lan}:${port}` : `http://localhost:${port}`);
process.env.BASE_URL = baseUrl;

const bank = loadBank();
const dbPath = process.env.DB_PATH ?? 'seed.db';
process.env.DB_PATH = dbPath;
// A demo database starts fresh every run. Otherwise a second run silently
// doubles every file, and the dashboard shows twelve houses instead of six.
if (!process.env.DB_PATH_KEEP) {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });
}
const store = new Store(openDb(dbPath), bank).configureLinks({
  secret: process.env.LINK_SECRET ?? 'dev-secret-change-me',
  baseUrl,
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

// A ready-made seller link for the file that has barely started, so the
// seller's side can be tried straight away.
const firstCase = store.listCases({ firmId: firm.id }).find((c) => c.ref === 'HB/2026/0101');
const firstSeller = firstCase ? store.sellers(firstCase.id)[0] : null;
const sellerLink = firstSeller ? store.issueAnswerLink(firstCase.id, firstSeller.id) : null;

console.log(`\nDatabase: ${dbPath}`);
console.log(`Staff key: ${admin.key}`);

if (!serve) {
  console.log(`\nStart the server against it, then sign in at /staff:`);
  console.log(`  DB_PATH=${dbPath} node --experimental-sqlite src/server.js`);
  console.log(`\nOr do both in one go next time:  node --experimental-sqlite scripts/seed.js --serve`);
} else {
  // The database is closed and re-opened by the server, so both do not hold it.
  store.db.close();
  const { createApp } = await import('../src/server.js');
  const { tick } = await import('../src/conversation.js');
  const app = createApp({ dbPath });
  await new Promise((resolve) => app.server.listen(port, '0.0.0.0', resolve));
  const worker = setInterval(() => tick(app.store, app.sender).catch((e) => console.error('tick failed', e)), 60_000);
  const stop = () => { clearInterval(worker); app.server.close(() => { try { app.db.close(); } catch {} process.exit(0); }); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  const line = '─'.repeat(64);
  console.log(`\n${line}`);
  console.log('Running. Press Ctrl+C to stop.\n');
  console.log('The conveyancer\'s dashboard (paste the staff key above):');
  console.log(`  on this machine   http://localhost:${port}/staff`);
  if (lan !== 'localhost') console.log(`  on your phone     http://${lan}:${port}/staff   (same wifi)`);
  if (sellerLink) {
    console.log('\nThe seller\'s side - open this on your phone:');
    console.log(`  ${sellerLink}`);
  }
  console.log('\nEvery channel is in dry-run: messages are recorded, not sent.');
  console.log(line);
}
