// Zero-dependency HTTP server: API for the seller's web app, a solicitor view,
// the WhatsApp webhook, and the worker tick.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';

import { openDb } from './db.js';
import { Store } from './store.js';
import { loadBank, isApplicable } from './questions.js';
import { nextItem, nextBatch, forecast, paperworkList } from './batching.js';
import { applyPrefill } from './prefill.js';
import { redeemLink } from './magiclink.js';
import { buildExport, toHtml, toChaseList } from './export/ta6.js';
import * as wa from './channels/whatsapp.js';
import { handleInbound, askNext, startSession, tick } from './conversation.js';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, '..', 'public');
const UPLOADS = process.env.UPLOAD_DIR ?? join(here, '..', 'uploads');

const SECRET = process.env.LINK_SECRET ?? 'dev-secret-change-me';
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 8787}`;
const WA_VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN ?? 'dev-verify';
const WA_APP_SECRET = process.env.WA_APP_SECRET ?? null;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

export function createApp({ dbPath = process.env.DB_PATH ?? ':memory:', sender } = {}) {
  const db = openDb(dbPath);
  const bank = loadBank();
  const store = new Store(db, bank).configureLinks({ secret: SECRET, baseUrl: BASE_URL });
  const waSender = sender ?? wa.createSender({ token: process.env.WA_TOKEN, phoneNumberId: process.env.WA_PHONE_ID });

  const json = (res, code, body) => {
    const payload = JSON.stringify(body);
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store' });
    res.end(payload);
  };

  const readBody = (req, limit = 25 * 1024 * 1024) => new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

  const readJson = async (req) => {
    const raw = await readBody(req);
    if (raw.length === 0) return {};
    return JSON.parse(raw.toString('utf8'));
  };

  // Session cookie = the redeemed magic link, signed so it cannot be forged.
  const signSession = (caseId, participantId, purpose) => {
    const body = `${caseId}.${participantId}.${purpose}`;
    return `${body}.${createHmac('sha256', SECRET).update(body).digest('base64url').slice(0, 27)}`;
  };
  const readSession = (req) => {
    const cookie = /(?:^|;\s*)hi_session=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    if (!cookie) return null;
    const parts = decodeURIComponent(cookie).split('.');
    if (parts.length !== 4) return null;
    const [caseId, participantId, purpose, sig] = parts;
    const expect = createHmac('sha256', SECRET).update(`${caseId}.${participantId}.${purpose}`).digest('base64url').slice(0, 27);
    const a = Buffer.from(sig); const b = Buffer.from(expect);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return { caseId, participantId, purpose };
  };

  const session = (req, res) => {
    const s = readSession(req);
    if (!s) { json(res, 401, { error: 'not_signed_in', hint: 'open your magic link again' }); return null; }
    return s;
  };

  async function serveStatic(res, urlPath) {
    const rel = normalize(urlPath === '/' ? '/index.html' : urlPath).replace(/^(\.\.[/\\])+/, '');
    const file = join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC) || !existsSync(file)) { json(res, 404, { error: 'not_found' }); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  }

  const handler = async (req, res) => {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;

    try {
      // ---- magic link ----------------------------------------------------
      if (req.method === 'GET' && path.startsWith('/s/')) {
        const result = redeemLink(db, SECRET, path.slice(3));
        if (!result.ok) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          return res.end(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><body style="font:16px/1.5 system-ui;max-width:26rem;margin:15vh auto;padding:0 1.5rem;color:#16232e">
<h1 style="font-size:1.2rem">This link has expired</h1><p>Links last 30 days for your security. Reply to the last message you had from us and we will send a fresh one straight away.</p>
<p style="color:#5b6b7a;font-size:.85rem">Reason: ${result.reason}</p>`);
        }
        store.event(result.caseId, 'link_redeemed', { participantId: result.participantId, purpose: result.purpose });
        res.writeHead(302, {
          'set-cookie': `hi_session=${encodeURIComponent(signSession(result.caseId, result.participantId, result.purpose))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${BASE_URL.startsWith('https') ? '; Secure' : ''}`,
          location: result.purpose === 'review_and_sign' ? '/#review' : '/#start',
        });
        return res.end();
      }

      // ---- seller API ----------------------------------------------------
      if (path === '/api/me' && req.method === 'GET') {
        const s = session(req, res); if (!s) return;
        const p = store.getParticipant(s.participantId);
        const c = store.getCase(s.caseId);
        return json(res, 200, {
          name: p?.name, role: p?.role, purpose: s.purpose,
          property: { address: c.address, postcode: c.postcode, ref: c.ref, firm: c.firm, deadline: c.deadline },
          plan: p?.plan, cadence: p?.cadence,
          progress: store.progress(s.caseId),
          forecast: forecast(bank, store.answers(s.caseId), p?.plan, p?.cadence?.frequency === 'twice_daily' ? 2 : 1),
          sections: bank.sections,
        });
      }

      if (path === '/api/next' && req.method === 'GET') {
        const s = session(req, res); if (!s) return;
        const p = store.getParticipant(s.participantId);
        const answers = store.answers(s.caseId);
        const plan = {
          ...p.plan,
          ...(url.searchParams.get('size') ? { size: Number(url.searchParams.get('size')) } : {}),
          ...(url.searchParams.get('mode') ? { mode: url.searchParams.get('mode') } : {}),
        };
        const asked = Number(url.searchParams.get('asked') ?? 0);
        const spent = Number(url.searchParams.get('spent') ?? 0);
        const step = nextItem(bank, answers, { plan, asked, spentSeconds: spent, lastSection: url.searchParams.get('last') });
        const item = step.item;
        return json(res, 200 , {
          item: item ? {
            id: item.id, n: item.n, s: item.s, t: item.t, q: item.q, help: item.help, hint: item.hint,
            opts: item.opts, fields: item.fields, kind: item.kind, secs: item.secs,
            optional: !!item.optional, confirmable: !!item.confirmable, multiOk: !!item.multiOk,
            prefilled: answers[item.id]?.status === 'prefilled' ? answers[item.id].value : null,
          } : null,
          sessionDone: step.sessionDone, formDone: step.formDone,
          progress: store.progress(s.caseId),
        });
      }

      if (path === '/api/answer' && req.method === 'POST') {
        const s = session(req, res); if (!s) return;
        const { itemId, value, status } = await readJson(req);
        if (!bank.byId.has(itemId)) return json(res, 400, { error: 'unknown_item' });
        store.saveAnswer(s.caseId, itemId, {
          value, status: status ?? 'answered', source: 'web', by: s.participantId,
          ip: req.socket.remoteAddress, userAgent: req.headers['user-agent'],
        });
        return json(res, 200, { ok: true, progress: store.progress(s.caseId) });
      }

      if (path === '/api/park' && req.method === 'POST') {
        const s = session(req, res); if (!s) return;
        const { itemId, days } = await readJson(req);
        store.park(s.caseId, itemId, { by: s.participantId, days: days ?? 3, source: 'web' });
        return json(res, 200, { ok: true });
      }

      if (path === '/api/preferences' && req.method === 'POST') {
        const s = session(req, res); if (!s) return;
        const { cadence, plan } = await readJson(req);
        const p = store.setPreferences(s.participantId, { cadence, plan });
        store.event(s.caseId, 'preferences_changed', { cadence, plan });
        return json(res, 200, { plan: p.plan, cadence: p.cadence });
      }

      if (path === '/api/paperwork' && req.method === 'GET') {
        const s = session(req, res); if (!s) return;
        return json(res, 200, { items: paperworkList(bank, store.answers(s.caseId)) });
      }

      if (path === '/api/upload' && req.method === 'POST') {
        const s = session(req, res); if (!s) return;
        const itemId = url.searchParams.get('itemId');
        const filename = (url.searchParams.get('filename') ?? 'upload.jpg').replace(/[^\w.\- ]/g, '_');
        const raw = await readBody(req);
        await mkdir(UPLOADS, { recursive: true });
        const stored = join(UPLOADS, `${randomUUID()}-${filename}`);
        await writeFile(stored, raw);
        const id = store.addAttachment(s.caseId, {
          itemId, filename, mime: req.headers['content-type'] ?? 'application/octet-stream',
          bytes: raw.length, path: stored, by: s.participantId,
        });
        return json(res, 200, { ok: true, id, bytes: raw.length });
      }

      if (path === '/api/review' && req.method === 'GET') {
        const s = session(req, res); if (!s) return;
        return json(res, 200, buildExport(store, s.caseId));
      }

      if (path === '/api/sign' && req.method === 'POST') {
        const s = session(req, res); if (!s) return;
        const { confirmed } = await readJson(req);
        if (!confirmed) return json(res, 400, { error: 'confirmation_required' });
        const progress = store.progress(s.caseId);
        if (progress.percent < 100) return json(res, 409, { error: 'incomplete', progress });
        const result = store.sign(s.caseId, s.participantId);
        return json(res, 200, result);
      }

      // ---- conveyancer API (protect behind your own staff auth) ----------
      if (path === '/api/cases' && req.method === 'POST') {
        const { ref, address, postcode, firm, deadline, seller, cadence, plan } = await readJson(req);
        const c = store.createCase({ ref, address, postcode, firm, deadline });
        const p = store.addParticipant(c.id, { role: 'seller', ...seller, cadence, plan });
        await applyPrefill(store, c.id);
        const link = store.issueAnswerLink(c.id, p.id);
        return json(res, 201, { caseId: c.id, participantId: p.id, link, progress: store.progress(c.id) });
      }

      if (path === '/api/cases' && req.method === 'GET') {
        return json(res, 200, {
          cases: store.listCases().map((c) => ({
            id: c.id, ref: c.ref, address: c.address, status: c.status,
            ...toChaseList(buildExport(store, c.id)),
          })),
        });
      }

      const inviteMatch = /^\/api\/cases\/([\w-]+)\/invite$/.exec(path);
      if (inviteMatch && req.method === 'POST') {
        const caseId = inviteMatch[1];
        const [seller] = store.sellers(caseId);
        if (!seller) return json(res, 404, { error: 'no_seller' });
        const result = await startSession(store, waSender, seller.id, { template: 'invite', ignoreWindow: true });
        return json(res, 200, { ...result, link: store.issueAnswerLink(caseId, seller.id) });
      }

      const exportMatch = /^\/api\/cases\/([\w-]+)\/export\.(json|html)$/.exec(path);
      if (exportMatch && req.method === 'GET') {
        const data = buildExport(store, exportMatch[1]);
        if (exportMatch[2] === 'json') return json(res, 200, data);
        const html = toHtml(data);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(html);
      }

      if (path === '/api/tick' && req.method === 'POST') {
        return json(res, 200, { results: await tick(store, waSender) });
      }

      // ---- WhatsApp webhook ---------------------------------------------
      if (path === '/webhooks/whatsapp' && req.method === 'GET') {
        if (url.searchParams.get('hub.verify_token') === WA_VERIFY_TOKEN) {
          res.writeHead(200, { 'content-type': 'text/plain' });
          return res.end(url.searchParams.get('hub.challenge') ?? '');
        }
        return json(res, 403, { error: 'bad_verify_token' });
      }

      if (path === '/webhooks/whatsapp' && req.method === 'POST') {
        const raw = await readBody(req);
        if (WA_APP_SECRET) {
          const expected = `sha256=${createHmac('sha256', WA_APP_SECRET).update(raw).digest('hex')}`;
          const given = req.headers['x-hub-signature-256'] ?? '';
          const a = Buffer.from(expected); const b = Buffer.from(String(given));
          if (a.length !== b.length || !timingSafeEqual(a, b)) return json(res, 401, { error: 'bad_signature' });
        }
        // Meta retries anything slower than 20 seconds, so acknowledge first and
        // process after.
        json(res, 200, { received: true });
        const body = JSON.parse(raw.toString('utf8') || '{}');
        for (const msg of wa.parseInbound(body)) {
          try {
            await handleInbound(store, waSender, msg);
          } catch (err) {
            store.event(null, 'inbound_failed', { error: String(err), msg });
          }
        }
        return;
      }

      if (path === '/healthz') return json(res, 200, { ok: true, questions: bank.items.length });

      if (req.method === 'GET') return await serveStatic(res, path);
      return json(res, 404, { error: 'not_found' });
    } catch (err) {
      return json(res, 500, { error: 'server_error', detail: String(err?.message ?? err) });
    }
  };

  return { store, db, bank, sender: waSender, handler, server: createServer(handler), askNext, tick };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 8787);
  const app = createApp();
  app.server.listen(port, () => {
    console.log(`homeowner-intake listening on ${BASE_URL}`);
    if (app.sender.dryRun) console.log('WhatsApp sender is in dry-run mode (no WA_TOKEN set) - messages are logged, not sent.');
  });
  // The worker: in production run this as a separate scheduled process.
  setInterval(() => tick(app.store, app.sender).catch((e) => console.error('tick failed', e)), 60_000).unref?.();
}
