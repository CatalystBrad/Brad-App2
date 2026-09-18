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
import * as smsChannel from './channels/sms.js';
import { createDispatcher } from './channels/index.js';
import { handleInbound, askNext, startSession, tick } from './conversation.js';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, '..', 'public');
const UPLOADS = process.env.UPLOAD_DIR ?? join(here, '..', 'uploads');

const SECRET = process.env.LINK_SECRET ?? 'dev-secret-change-me';
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 8787}`;
const WA_VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN ?? 'dev-verify';
const WA_APP_SECRET = process.env.WA_APP_SECRET ?? null;
// Bootstrap key for creating firms. Every other staff action uses a firm key.
const ADMIN_KEY = process.env.ADMIN_KEY ?? 'dev-admin-key';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

export function createApp({ dbPath = process.env.DB_PATH ?? ':memory:', sender } = {}) {
  const db = openDb(dbPath);
  const bank = loadBank();
  const store = new Store(db, bank).configureLinks({ secret: SECRET, baseUrl: BASE_URL });
  const waSender = sender ?? createDispatcher({
    whatsapp: { token: process.env.WA_TOKEN, phoneNumberId: process.env.WA_PHONE_ID },
    sms: { accountSid: process.env.SMS_ACCOUNT_SID, authToken: process.env.SMS_AUTH_TOKEN, from: process.env.SMS_FROM },
    email: { apiKey: process.env.EMAIL_API_KEY, from: process.env.EMAIL_FROM },
  });

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

  const bearer = (req, url = null) =>
    /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1]?.trim()
    // A link opened in a new tab cannot carry a header. Only the export route
    // passes a url here, and only for a GET.
    ?? (url ? url.searchParams.get('key') : null)
    ?? null;

  /** Staff session for the conveyancer side. Always scopes to one firm. */
  const staff = (req, res, url = null) => {
    const who = store.staffByKey(bearer(req, url));
    if (!who) {
      json(res, 401, { error: 'not_authorised', hint: 'send Authorization: Bearer <staff key>' });
      return null;
    }
    return who;
  };

  /** Loads a case only if it belongs to the caller's firm. */
  const ownedCase = (req, res, caseId, url = null) => {
    const who = staff(req, res, url);
    if (!who) return null;
    if (!store.caseBelongsTo(caseId, who.firm_id)) {
      // Deliberately the same answer whether the case is missing or another
      // firm's: a 403 here would confirm the reference exists.
      json(res, 404, { error: 'not_found' });
      return null;
    }
    return who;
  };

  const session = (req, res) => {
    const s = readSession(req);
    if (!s) { json(res, 401, { error: 'not_signed_in', hint: 'open your magic link again' }); return null; }
    return s;
  };

  async function serveStatic(res, urlPath) {
    const withIndex = urlPath === '/' ? '/index.html' : urlPath === '/staff' || urlPath === '/staff/' ? '/staff/index.html' : urlPath;
    const rel = normalize(withIndex).replace(/^(\.\.[/\\])+/, '');
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
          forecast: forecast(bank, store.answers(s.caseId), p?.plan, p?.cadence?.frequency === 'twice_daily' ? 2 : 1, { forms: store.formsFor(s.caseId) }),
          forms: store.formsFor(s.caseId),
          sections: bank.sections.filter((sec) => store.formsFor(s.caseId).includes(sec.form)),
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
        const step = nextItem(bank, answers, {
          plan, asked, spentSeconds: spent,
          forms: store.formsFor(s.caseId),
          lastSection: url.searchParams.get('last'),
        });
        const item = step.item;
        return json(res, 200 , {
          item: item ? {
            id: item.id, n: item.n, s: item.s, t: item.t, q: item.q, help: item.help, hint: item.hint,
            opts: item.opts, fields: item.fields, rows: item.rows, kind: item.kind, secs: item.secs, form: item.form,
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
        return json(res, 200, { items: paperworkList(bank, store.answers(s.caseId), { forms: store.formsFor(s.caseId) }) });
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

      // ---- firm onboarding ------------------------------------------------
      if (path === '/api/firms' && req.method === 'POST') {
        if (bearer(req) !== ADMIN_KEY) return json(res, 401, { error: 'not_authorised' });
        const { name, brand, waPhoneId, smsSender, emailFrom, admin } = await readJson(req);
        if (!name) return json(res, 400, { error: 'name_required' });
        const firm = store.createFirm({ name, brand, waPhoneId, smsSender, emailFrom });
        const first = store.addStaff(firm.id, { email: admin?.email ?? `admin@${firm.slug}`, name: admin?.name, role: 'admin' });
        // The key is shown once and only ever stored as a hash.
        return json(res, 201, { firm: { id: firm.id, name: firm.name, slug: firm.slug }, staff: first });
      }

      if (path === '/api/staff' && req.method === 'POST') {
        const who = staff(req, res); if (!who) return;
        if (who.role !== 'admin') return json(res, 403, { error: 'admin_only' });
        const { email, name, role } = await readJson(req);
        return json(res, 201, { staff: store.addStaff(who.firm_id, { email, name, role }) });
      }

      if (path === '/api/firm' && req.method === 'GET') {
        const who = staff(req, res); if (!who) return;
        const firm = store.getFirm(who.firm_id);
        return json(res, 200, { firm: { id: firm.id, name: firm.name, slug: firm.slug, brand: firm.brand }, you: { name: who.name, email: who.email, role: who.role } });
      }

      // ---- conveyancer API ------------------------------------------------
      if (path === '/api/cases' && req.method === 'POST') {
        const who = staff(req, res); if (!who) return;
        const { ref, address, postcode, deadline, seller, cadence, plan, forms } = await readJson(req);
        const c = store.createCase({ ref, address, postcode, deadline, forms, firmId: who.firm_id, ownerId: who.id });
        const p = store.addParticipant(c.id, { role: 'seller', ...seller, cadence, plan });
        await applyPrefill(store, c.id);
        const link = store.issueAnswerLink(c.id, p.id);
        return json(res, 201, { caseId: c.id, participantId: p.id, link, progress: store.progress(c.id) });
      }

      if (path === '/api/cases' && req.method === 'GET') {
        const who = staff(req, res); if (!who) return;
        return json(res, 200, { cases: store.listCases({ firmId: who.firm_id }).map((c) => caseSummary(store, c)) });
      }

      const caseMatch = /^\/api\/cases\/([\w-]+)$/.exec(path);
      if (caseMatch && req.method === 'GET') {
        const who = ownedCase(req, res, caseMatch[1]); if (!who) return;
        return json(res, 200, caseDetail(store, caseMatch[1]));
      }

      const inviteMatch = /^\/api\/cases\/([\w-]+)\/invite$/.exec(path);
      if (inviteMatch && req.method === 'POST') {
        const caseId = inviteMatch[1];
        const who = ownedCase(req, res, caseId); if (!who) return;
        const [seller] = store.sellers(caseId);
        if (!seller) return json(res, 404, { error: 'no_seller' });
        const result = await startSession(store, waSender, seller.id, { template: 'invite', ignoreWindow: true });
        return json(res, 200, { ...result, link: store.issueAnswerLink(caseId, seller.id) });
      }

      const nudgeMatch = /^\/api\/cases\/([\w-]+)\/nudge$/.exec(path);
      if (nudgeMatch && req.method === 'POST') {
        const caseId = nudgeMatch[1];
        const who = ownedCase(req, res, caseId); if (!who) return;
        const [seller] = store.sellers(caseId);
        if (!seller) return json(res, 404, { error: 'no_seller' });
        const result = await startSession(store, waSender, seller.id, { ignoreWindow: true });
        store.event(caseId, 'nudged_by_staff', { by: who.email });
        return json(res, 200, result);
      }

      const exportMatch = /^\/api\/cases\/([\w-]+)\/export\.(json|html)$/.exec(path);
      if (exportMatch && req.method === 'GET') {
        const who = ownedCase(req, res, exportMatch[1], url); if (!who) return;
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

      // ---- SMS webhook ----------------------------------------------------
      if (path === '/webhooks/sms' && req.method === 'POST') {
        const raw = await readBody(req);
        const contentType = req.headers['content-type'] ?? '';
        const body = contentType.includes('json')
          ? JSON.parse(raw.toString('utf8') || '{}')
          : Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
        json(res, 200, { received: true });
        for (const msg of smsChannel.parseInbound(body)) {
          try {
            await handleInbound(store, waSender, msg);
          } catch (err) {
            store.event(null, 'inbound_failed', { channel: 'sms', error: String(err), msg });
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

/** One row of the chase list: enough to decide what to do about a file. */
export function caseSummary(store, c) {
  const data = buildExport(store, c.id);
  const chase = toChaseList(data);
  const sellers = store.sellers(c.id);
  const lastActivity = sellers.map((s) => s.last_activity_at).filter(Boolean).sort().at(-1) ?? null;
  const daysQuiet = lastActivity ? Math.floor((Date.now() - new Date(lastActivity)) / 86400000) : null;
  return {
    id: c.id,
    ref: c.ref,
    address: c.address,
    status: c.status,
    deadline: c.deadline,
    forms: store.formsFor(c.id),
    percent: data.progress.percent,
    answered: data.progress.answered,
    applicable: data.progress.applicable,
    minutesLeft: data.progress.minutesLeft,
    parked: data.progress.parked,
    toConfirm: data.progress.toConfirm,
    documentsOutstanding: data.documentsOutstanding.length,
    documentsTotal: data.progress.paperworkTotal,
    blocking: chase.blocking.length,
    readyToSend: chase.readyToSend,
    sellers: sellers.map((s) => ({
      name: s.name, channel: s.cadence.channel, signed: !!s.signed_at,
      ignoredStreak: s.ignored_streak, lastActivityAt: s.last_activity_at,
    })),
    daysQuiet,
    // What the fee earner should actually do about this file today.
    attention: attentionFor(c, data, sellers, daysQuiet),
  };
}

function attentionFor(c, data, sellers, daysQuiet) {
  const docsLeft = data.documentsOutstanding.length;
  if (c.status === 'signed') {
    return docsLeft > 0
      ? { level: 'watch', label: `Signed - ${docsLeft} document${docsLeft === 1 ? '' : 's'} still to come` }
      : { level: 'done', label: 'Signed and ready' };
  }
  if (data.progress.percent === 100 && !sellers.every((s) => s.signed_at)) {
    return { level: 'action', label: 'Complete - waiting on signatures' };
  }
  if (sellers.some((s) => s.ignored_streak >= 3)) return { level: 'action', label: 'Not responding - try ringing' };
  if (c.deadline) {
    const daysLeft = Math.ceil((new Date(c.deadline) - Date.now()) / 86400000);
    const sessionsLeft = Math.ceil(data.progress.secondsLeft / 90);
    if (daysLeft > 0 && sessionsLeft > daysLeft) return { level: 'action', label: `Behind for exchange in ${daysLeft} days` };
  }
  if (daysQuiet != null && daysQuiet >= 7) return { level: 'watch', label: `Quiet for ${daysQuiet} days` };
  if (docsLeft > 0 && data.progress.percent > 60) {
    return { level: 'watch', label: `${docsLeft} document${docsLeft === 1 ? '' : 's'} outstanding` };
  }
  return { level: 'ok', label: 'Progressing' };
}

export function caseDetail(store, caseId) {
  const c = store.getCase(caseId);
  const data = buildExport(store, caseId);
  return {
    ...caseSummary(store, c),
    firm: store.brandFor(caseId),
    outstanding: data.outstanding,
    documentsOutstandingList: data.documentsOutstanding,
    sections: data.sections,
    attachments: data.attachments,
    events: store.events(caseId).slice(-40),
    auditTrailLength: data.auditTrail.length,
  };
}
