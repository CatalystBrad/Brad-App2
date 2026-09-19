// Builds a single-file, browser-only version of the conveyancer's dashboard:
// the real seeded firm, the real chase-list logic, the real UI - with the
// server replaced by a shim that serves a baked snapshot. For showing a firm
// what they would live in, from a link, before anything is deployed.
//   node --experimental-sqlite scripts/build-static-dashboard.mjs [seller-preview-url]
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from '../src/db.js';
import { Store } from '../src/store.js';
import { loadBank } from '../src/questions.js';
import { createDispatcher } from '../src/channels/index.js';
import { seedFirm } from './seed.js';
import { caseSummary, caseDetail } from '../src/server.js';
import { buildExport, toHtml } from '../src/export/ta6.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const sellerPreviewUrl = process.argv[2] ?? '#';

// Seed into memory with the same code the demo uses.
const store = new Store(openDb(':memory:'), loadBank()).configureLinks({ secret: 'preview', baseUrl: 'https://preview.invalid' });
const { firm, admin, cases } = await seedFirm(store, createDispatcher());

const snapshot = {
  firm: { id: firm.id, name: firm.name, slug: firm.slug, brand: firm.brand },
  you: { name: admin.name, email: admin.email, role: admin.role },
  cases: cases.map((c) => caseSummary(store, store.getCase(c.id))),
  details: Object.fromEntries(cases.map((c) => [c.id, caseDetail(store, c.id)])),
  exports: Object.fromEntries(cases.map((c) => [c.id, toHtml(buildExport(store, c.id))])),
  takenAt: new Date().toISOString(),
};

const html = read('public/staff/index.html');
const markup = html.slice(html.indexOf('<body>') + '<body>'.length, html.lastIndexOf('<script'));
const css = read('public/staff/staff.css');
const js = read('public/staff/staff.js');

const shim = `
// ---- the server, in the browser: a snapshot of one firm's files ----------
(() => {
  const SNAP = ${JSON.stringify(snapshot)};
  const SELLER_PREVIEW = ${JSON.stringify(sellerPreviewUrl)};
  // Land on the chase list, not a sign-in box. Any key works in the preview.
  try { if (!localStorage.getItem('hi_staff_key')) localStorage.setItem('hi_staff_key', 'preview'); } catch {}

  const respond = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(String(input), location.origin);
    const p = url.pathname;
    if (!p.startsWith('/api/')) return realFetch(input, init);
    const auth = (init.headers ?? {}).authorization ?? '';
    if (!/^Bearer \\S+/.test(auth)) return respond({ error: 'not_authorised' }, 401);

    if (p === '/api/firm') return respond({ firm: SNAP.firm, you: SNAP.you });
    if (p === '/api/cases') return respond({ cases: SNAP.cases });
    let m;
    if ((m = /^\\/api\\/cases\\/([\\w-]+)$/.exec(p))) return SNAP.details[m[1]] ? respond(SNAP.details[m[1]]) : respond({ error: 'not_found' }, 404);
    if ((m = /^\\/api\\/cases\\/([\\w-]+)\\/nudge$/.exec(p))) return respond({ opened: 'template', template: 'resume', preview: true });
    if ((m = /^\\/api\\/cases\\/([\\w-]+)\\/invite$/.exec(p))) return respond({ opened: 'template', link: SELLER_PREVIEW });
    if ((m = /^\\/api\\/cases\\/([\\w-]+)\\/export-token$/.exec(p))) return respond({ token: 'preview:' + m[1], expiresInSeconds: 600 });
    return respond({ error: 'not_found' }, 404);
  };

  // "Open the form" opens a new tab on the real server. Here it opens the
  // baked export in an overlay instead.
  const overlay = document.createElement('dialog');
  overlay.id = 'exportView';
  overlay.innerHTML = '<div class="detailHead"><div><div class="muted small">The printable form</div><h2 id="exportTitle"></h2></div><button class="ghost" id="closeExport" type="button">Close</button></div><iframe id="exportFrame" title="Exported form" style="width:100%;height:70vh;border:0;background:#fff"></iframe>';
  document.body.append(overlay);
  overlay.querySelector('#closeExport').addEventListener('click', () => overlay.close());
  const realOpen = window.open.bind(window);
  window.open = (url, ...rest) => {
    const m = /^\\/api\\/cases\\/([\\w-]+)\\/export\\.html/.exec(String(url));
    if (!m) return realOpen(url, ...rest);
    const c = SNAP.cases.find((x) => x.id === m[1]);
    overlay.querySelector('#exportTitle').textContent = c?.address ?? '';
    overlay.querySelector('#exportFrame').srcdoc = SNAP.exports[m[1]] ?? '<p>Not found</p>';
    overlay.showModal();
    return null;
  };
})();
`;

const page = `<title>Dashboard Preview</title>
<style>
${css}
#exportView { width: min(56rem, calc(100vw - 32px)); }
.preview-note { max-width: 62rem; margin: 0 auto; padding: 0 16px 24px; font-size: .78rem; color: var(--muted); }
</style>
${markup}
<p class="preview-note">Preview: a snapshot of one firm's six files, taken ${snapshot.takenAt.slice(0, 10)}. Runs entirely in this browser; nothing is sent anywhere. "Nudge" and "Copy the seller's link" do what they say on the real thing - here they just confirm.</p>
<script>
${shim}
${js}
</script>
`;

mkdirSync(join(root, 'out'), { recursive: true });
const outPath = join(root, 'out', 'dashboard-preview.html');
writeFileSync(outPath, page);
console.log('wrote', outPath, Math.round(page.length / 1024) + 'KB,', snapshot.cases.length, 'cases');
