// Builds a single-file, browser-only version of the seller app: the real
// question bank, the real drip engine, the real UI - with the server replaced
// by a shim that keeps answers in the browser. For trying it on a phone
// without deploying anything. Not for real sellers: nothing leaves the device.
//   node scripts/build-static.mjs > out/seller-preview.html
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// Strip ESM syntax and the fenced node-only blocks, leaving plain functions.
const browserify = (src) => src
  .replace(/\/\/ @node-only-start[\s\S]*?\/\/ @node-only-end/g, '')
  .replace(/^import .*$/gm, '')
  .replace(/^export (const|function|class) /gm, '$1 ')
  .replace(/^export \{[^}]*\};?$/gm, '');

const ta6 = read('data/ta6-questions.json');
const ta10 = read('data/ta10-questions.json');
const questions = browserify(read('src/questions.js'));
const batching = browserify(read('src/batching.js'));
const css = read('public/styles.css')
  // The artifact host pads the page by the phone's safe area; a sticky header
  // has to start below it, not at 0.
  .replace('position: sticky; top: 0;', 'position: sticky; top: env(safe-area-inset-top, 0px);');
const app = read('public/app.js');
const html = read('public/index.html');

// Everything between <body> and the app's own script tag is the markup.
const markup = html.slice(html.indexOf('<body>') + '<body>'.length, html.lastIndexOf('<script'));

const shim = `
// ---- the server, in the browser ---------------------------------------
(() => {
  const FORMS_LOADED = [
    { id: 'ta6', ...${ta6.trim()} },
    { id: 'ta10', ...${ta10.trim()} },
  ];
  const bank = buildBank(FORMS_LOADED, ['ta6', 'ta10']);
  const forms = ['ta6', 'ta10'];
  const STORE = 'homeowner_intake_preview_v1';
  const CASE = { address: '12 Example Street, Leeds', postcode: 'LS1 1AA', ref: 'HB/2026/0101', firm: 'Hardcastle & Byrne' };
  const DEFAULT_CADENCE = { frequency: 'daily', window: { start: '18:00', end: '21:00' }, tz: 'Europe/London', channel: 'whatsapp', pauseUntil: null };

  const load = () => { try { return JSON.parse(localStorage.getItem(STORE)) ?? null; } catch { return null; } };
  const persist = () => { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch { /* private window */ } };
  const fresh = () => ({
    answers: {
      // What prefill would have found from public data: confirm with one tap.
      '1.1': { value: { address: CASE.address, postcode: CASE.postcode }, status: 'prefilled', source: 'prefill:hmlr' },
      '5.7': { value: 'No', status: 'prefilled', source: 'prefill:historic_england' },
      '5.8': { value: 'No', status: 'prefilled', source: 'prefill:conservation_area' },
      '5.9': { value: 'Not known', status: 'prefilled', source: 'prefill:tpo' },
    },
    attachments: [],
    plan: { ...DEFAULT_PLAN },
    cadence: { ...DEFAULT_CADENCE },
    signed: false,
  });
  let st = load() ?? fresh();
  if (location.search.includes('reset')) { st = fresh(); persist(); history.replaceState(null, '', location.pathname); }

  const prog = () => progress(bank, st.answers, { forms });
  const respond = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const shape = (item) => ({
    id: item.id, n: item.n, s: item.s, t: item.t, q: item.q, help: item.help, hint: item.hint,
    opts: item.opts, fields: item.fields, rows: item.rows, kind: item.kind, secs: item.secs, form: item.form,
    optional: !!item.optional, confirmable: !!item.confirmable, multiOk: !!item.multiOk,
    prefilled: st.answers[item.id]?.status === 'prefilled' ? st.answers[item.id].value : null,
  });
  const fmt = (v, item) => {
    if (v == null) return '';
    if (Array.isArray(v)) return v.join('; ');
    if (typeof v !== 'object') return String(v);
    if (item?.t === 'checklist') {
      const labels = new Map((item.rows ?? []).map((r) => [r.k, r.label]));
      return Object.entries(v).map(([k, e]) => labels.get(k) + ': ' + (e?.status ?? e) + (e?.price ? ' (would sell for ' + e.price + ')' : '')).join('; ');
    }
    return Object.values(v).filter(Boolean).join(', ');
  };
  const write = (itemId, patch) => {
    st.answers[itemId] = { ...(st.answers[itemId] ?? {}), ...patch };
    if (st.signed && patch.status !== 'prefilled') st.signed = false;   // amending un-signs
    persist();
  };

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(String(input), location.origin);
    if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    const q = url.searchParams;

    switch (url.pathname) {
      case '/api/me': {
        const p = prog();
        return respond({
          name: 'Sam Okafor', role: 'seller', purpose: 'answer', signed: st.signed,
          caseStatus: st.signed ? 'signed' : 'collecting',
          sellers: [{ name: 'Sam Okafor', signed: st.signed }],
          property: CASE, plan: st.plan, cadence: st.cadence, progress: p,
          forecast: forecast(bank, st.answers, st.plan, st.cadence.frequency === 'twice_daily' ? 2 : 1, { forms }),
          forms, sections: bank.sections,
        });
      }
      case '/api/next': {
        const plan = { ...st.plan, ...(q.get('size') ? { size: Number(q.get('size')) } : {}), ...(q.get('mode') ? { mode: q.get('mode') } : {}) };
        const step = nextItem(bank, st.answers, { plan, asked: Number(q.get('asked') ?? 0), spentSeconds: Number(q.get('spent') ?? 0), forms, lastSection: q.get('last') });
        return respond({ item: step.item ? shape(step.item) : null, sessionDone: step.sessionDone, formDone: step.formDone, paperwork: !!step.paperwork, paperworkDone: !!step.paperworkDone, progress: prog() });
      }
      case '/api/item': {
        const item = bank.byId.get(q.get('id'));
        if (!item) return respond({ error: 'unknown_item' }, 404);
        const current = st.answers[item.id];
        return respond({ item: shape(item), current: current ? { value: current.value, status: current.status } : null });
      }
      case '/api/answer':
        if (!bank.byId.has(body?.itemId)) return respond({ error: 'unknown_item' }, 400);
        write(body.itemId, { value: body.value, status: body.status ?? 'answered', source: 'web', at: new Date().toISOString() });
        return respond({ ok: true, progress: prog() });
      case '/api/park':
        write(body.itemId, { value: null, status: 'parked', source: 'web', revisitAt: new Date(Date.now() + (body.days ?? 3) * 86400000).toISOString() });
        return respond({ ok: true });
      case '/api/preferences':
        st.plan = { ...st.plan, ...(body?.plan ?? {}) };
        st.cadence = { ...st.cadence, ...(body?.cadence ?? {}) };
        persist();
        return respond({ plan: st.plan, cadence: st.cadence });
      case '/api/paperwork':
        return respond({ items: paperworkList(bank, st.answers, { forms }) });
      case '/api/upload': {
        const itemId = q.get('itemId'); const filename = q.get('filename') ?? 'photo.jpg';
        const id = 'att-' + Math.random().toString(36).slice(2, 10);
        st.attachments.push({ id, itemId, filename, at: new Date().toISOString() });
        if (itemId && bank.byId.has(itemId)) write(itemId, { value: { attachmentId: id, filename }, status: 'answered', source: 'upload' });
        persist();
        return respond({ ok: true, id, bytes: 0, note: 'preview: the file stays on this device' });
      }
      case '/api/review': {
        const sections = [];
        for (const section of inForms(bank.sections, forms)) {
          const rows = inForms(bank.items, forms).filter((i) => i.s === section.id && isApplicable(i, st.answers)).map((i) => {
            const a = st.answers[i.id];
            return { id: i.id, number: i.n, kind: i.kind, track: i.track ?? 'form', question: i.q, answer: a && a.status !== 'parked' ? fmt(a.value, i) : null, status: a?.status ?? 'unanswered', source: a?.source ?? null, attachments: [] };
          });
          if (rows.length) sections.push({ ...section, rows });
        }
        const p = prog();
        return respond({ sections, progress: p, sellers: [{ name: 'Sam Okafor', signedAt: st.signed ? new Date().toISOString() : null }], outstanding: [] });
      }
      case '/api/sign': {
        if (!body?.confirmed) return respond({ error: 'confirmation_required' }, 400);
        const p = prog();
        if (p.percent < 100) return respond({ error: 'incomplete', progress: p }, 409);
        st.signed = true; persist();
        return respond({ allSigned: true, signed: 1, of: 1 });
      }
      default:
        return respond({ error: 'not_found' }, 404);
    }
  };
})();
`;

const page = `<title>Seller App Preview</title>
<style>
${css}
.preview-note { max-width: 34rem; margin: 0 auto; padding: 0 16px 24px; font-size: .78rem; color: var(--muted); text-align: center; }
.preview-note a { color: var(--accent); }
</style>
${markup}
<p class="preview-note">Preview: runs entirely in this browser. Answers stay on this device and nothing is sent anywhere. <a href="?reset">Start again</a></p>
<script>
${questions}
${batching}
${shim}
${app}
</script>
`;

mkdirSync(join(root, 'out'), { recursive: true });
const outPath = join(root, 'out', 'seller-preview.html');
writeFileSync(outPath, page);
console.log('wrote', outPath, Math.round(page.length / 1024) + 'KB');
