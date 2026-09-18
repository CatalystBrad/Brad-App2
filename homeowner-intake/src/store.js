import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { loadBank, progress, DEFAULT_FORMS } from './questions.js';
import { issueLink } from './magiclink.js';
import { DEFAULT_CADENCE } from './scheduler.js';
import { DEFAULT_PLAN } from './batching.js';

const json = (v) => (v === undefined ? null : JSON.stringify(v));
const unjson = (v) => (v == null ? null : JSON.parse(v));
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

export const DEFAULT_BRAND = {
  colour: '#1f5f8b',
  fromName: null,        // falls back to the firm name
  replyTo: null,
  signOff: null,         // e.g. "Rachel at Example & Co"
};

const hashKey = (key) => createHash('sha256').update(key).digest('hex');

export class Store {
  constructor(db, bank = loadBank()) {
    this.db = db;
    this.bank = bank;
  }

  // ---- firms and staff ---------------------------------------------------

  createFirm({ name, brand, waPhoneId, smsSender, emailFrom } = {}) {
    const id = randomUUID();
    let slug = slugify(name);
    if (this.db.prepare('SELECT 1 FROM firms WHERE slug = ?').get(slug)) slug = `${slug}-${id.slice(0, 4)}`;
    this.db.prepare(
      `INSERT INTO firms (id, name, slug, brand, wa_phone_id, sms_sender, email_from) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, name, slug, json({ ...DEFAULT_BRAND, ...(brand ?? {}) }), waPhoneId ?? null, smsSender ?? null, emailFrom ?? null);
    return this.getFirm(id);
  }

  getFirm(id) {
    const row = this.db.prepare('SELECT * FROM firms WHERE id = ?').get(id);
    return row ? { ...row, brand: unjson(row.brand) } : null;
  }

  firmByName(name) {
    const row = this.db.prepare('SELECT id FROM firms WHERE name = ? OR slug = ?').get(name, slugify(name));
    return row ? this.getFirm(row.id) : null;
  }

  /** Convenience for the API and tests: name a firm and get it, creating on first use. */
  ensureFirm(name, extra = {}) {
    return this.firmByName(name) ?? this.createFirm({ name, ...extra });
  }

  /** The firm whose name and voice the seller sees on every message. */
  brandFor(caseId) {
    const c = this.getCase(caseId);
    const firm = c?.firm_id ? this.getFirm(c.firm_id) : null;
    const name = firm?.name ?? c?.firm ?? 'your solicitor';
    return {
      firmName: name,
      fromName: firm?.brand?.fromName ?? name,
      signOff: firm?.brand?.signOff ?? name,
      colour: firm?.brand?.colour ?? DEFAULT_BRAND.colour,
      replyTo: firm?.brand?.replyTo ?? null,
      waPhoneId: firm?.wa_phone_id ?? null,
      smsSender: firm?.sms_sender ?? null,
      emailFrom: firm?.email_from ?? null,
    };
  }

  /** Staff keys are hashed like passwords; the plaintext is shown exactly once. */
  addStaff(firmId, { email, name, role = 'fee_earner' } = {}) {
    const id = randomUUID();
    const key = `hi_${randomBytes(24).toString('base64url')}`;
    this.db.prepare(
      `INSERT INTO staff (id, firm_id, email, name, role, key_hash) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, firmId, email, name ?? null, role, hashKey(key));
    return { id, firmId, email, name, role, key };
  }

  staffByKey(key) {
    if (!key) return null;
    const row = this.db.prepare('SELECT * FROM staff WHERE key_hash = ?').get(hashKey(key));
    if (!row) return null;
    this.db.prepare(`UPDATE staff SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(row.id);
    return row;
  }

  // ---- cases -------------------------------------------------------------

  createCase({ ref, address, postcode, uprn, firm, firmId, ownerId, deadline, forms } = {}) {
    const id = randomUUID();
    const resolvedFirmId = firmId ?? (firm ? this.ensureFirm(firm).id : null);
    const firmName = resolvedFirmId ? this.getFirm(resolvedFirmId).name : (firm ?? null);
    this.db.prepare(
      `INSERT INTO cases (id, firm_id, owner_id, ref, address, postcode, uprn, firm, deadline, forms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, resolvedFirmId, ownerId ?? null, ref ?? null, address ?? null, postcode ?? null, uprn ?? null, firmName, deadline ?? null,
      json(forms?.length ? forms : DEFAULT_FORMS));
    this.event(id, 'case_created', { ref, address, firmId: resolvedFirmId });
    return this.getCase(id);
  }

  getCase(id) {
    return this.db.prepare('SELECT * FROM cases WHERE id = ?').get(id);
  }

  /**
   * Always pass firmId from a staff session. Omitting it returns every case,
   * which is only ever correct for the background worker.
   */
  listCases({ firmId = null, status = null } = {}) {
    const where = [];
    const args = [];
    if (firmId) { where.push('firm_id = ?'); args.push(firmId); }
    if (status) { where.push('status = ?'); args.push(status); }
    const sql = `SELECT * FROM cases ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC`;
    return this.db.prepare(sql).all(...args);
  }

  /** Guards a case against the firm of whoever is asking. */
  caseBelongsTo(caseId, firmId) {
    const c = this.getCase(caseId);
    return !!c && !!firmId && c.firm_id === firmId;
  }

  addParticipant(caseId, { role = 'seller', name, email, phone, whatsappOptIn = false, cadence, plan } = {}) {
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO participants (id, case_id, role, name, email, phone, whatsapp_opt_in, cadence, plan)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, caseId, role, name ?? null, email ?? null, phone ?? null, whatsappOptIn ? 1 : 0,
      json({ ...DEFAULT_CADENCE, ...(cadence ?? {}) }), json({ ...DEFAULT_PLAN, ...(plan ?? {}) }));
    return this.getParticipant(id);
  }

  getParticipant(id) {
    const row = this.db.prepare('SELECT * FROM participants WHERE id = ?').get(id);
    if (!row) return null;
    return { ...row, cadence: unjson(row.cadence), plan: unjson(row.plan) };
  }

  sellers(caseId) {
    return this.db.prepare(`SELECT id FROM participants WHERE case_id = ? AND role = 'seller'`)
      .all(caseId).map((r) => this.getParticipant(r.id));
  }

  setPreferences(participantId, { cadence, plan } = {}) {
    const p = this.getParticipant(participantId);
    if (!p) return null;
    this.db.prepare('UPDATE participants SET cadence = ?, plan = ? WHERE id = ?').run(
      json({ ...p.cadence, ...(cadence ?? {}) }),
      json({ ...p.plan, ...(plan ?? {}) }),
      participantId,
    );
    return this.getParticipant(participantId);
  }

  /** Answers as the engines want them: { itemId: { value, status, revisitAt } }. */
  answers(caseId) {
    const rows = this.db.prepare('SELECT * FROM answers WHERE case_id = ?').all(caseId);
    const out = {};
    for (const r of rows) {
      out[r.item_id] = { value: unjson(r.value), status: r.status, revisitAt: r.revisit_at, source: r.source };
    }
    return out;
  }

  saveAnswer(caseId, itemId, { value, status = 'answered', revisitAt = null, source = 'web', by = null, ip = null, userAgent = null } = {}) {
    this.db.prepare(
      `INSERT INTO answers (case_id, item_id, value, status, revisit_at, source, answered_by, answered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(case_id, item_id) DO UPDATE SET
         value = excluded.value, status = excluded.status, revisit_at = excluded.revisit_at,
         source = excluded.source, answered_by = excluded.answered_by, answered_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
    ).run(caseId, itemId, json(value), status, revisitAt, source, by);

    this.db.prepare(
      `INSERT INTO answer_history (case_id, item_id, value, status, source, answered_by, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(caseId, itemId, json(value), status, source, by, ip, userAgent);

    if (by) {
      this.db.prepare(`UPDATE participants SET last_activity_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), ignored_streak = 0 WHERE id = ?`).run(by);
    }
    // Changing an answer after the form was reviewed un-signs it: the buyer
    // must be given the version the seller actually stands behind.
    const c = this.getCase(caseId);
    if (c && (c.status === 'in_review' || c.status === 'signed')) {
      this.db.prepare(`UPDATE cases SET status = 'collecting', signed_at = NULL WHERE id = ?`).run(caseId);
      this.db.prepare('UPDATE participants SET signed_at = NULL WHERE case_id = ?').run(caseId);
      this.event(caseId, 'unsigned_by_amendment', { itemId });
    }
    return this.answers(caseId)[itemId];
  }

  park(caseId, itemId, { days = 3, by = null, source = 'web' } = {}) {
    return this.saveAnswer(caseId, itemId, {
      value: null, status: 'parked', source, by,
      revisitAt: new Date(Date.now() + days * 86400000).toISOString(),
    });
  }

  history(caseId, itemId = null) {
    return itemId
      ? this.db.prepare('SELECT * FROM answer_history WHERE case_id = ? AND item_id = ? ORDER BY id').all(caseId, itemId)
      : this.db.prepare('SELECT * FROM answer_history WHERE case_id = ? ORDER BY id').all(caseId);
  }

  addAttachment(caseId, { itemId, filename, mime, bytes, path, by }) {
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO attachments (id, case_id, item_id, filename, mime, bytes, path, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, caseId, itemId ?? null, filename, mime, bytes, path, by ?? null);
    if (itemId) this.saveAnswer(caseId, itemId, { value: { attachmentId: id, filename }, source: 'upload', by });
    return id;
  }

  attachments(caseId) {
    return this.db.prepare('SELECT * FROM attachments WHERE case_id = ? ORDER BY uploaded_at').all(caseId);
  }

  /** Which forms this case is collecting - TA6 always, TA10 when asked for. */
  formsFor(caseId) {
    const c = this.getCase(caseId);
    return unjson(c?.forms) ?? DEFAULT_FORMS;
  }

  setForms(caseId, forms) {
    this.db.prepare('UPDATE cases SET forms = ? WHERE id = ?').run(json(forms), caseId);
    this.event(caseId, 'forms_changed', { forms });
    return this.formsFor(caseId);
  }

  progress(caseId) {
    return progress(this.bank, this.answers(caseId), { forms: this.formsFor(caseId) });
  }

  queue(caseId, participantId, { channel, kind, payload, sendAfter = new Date() }) {
    this.db.prepare(
      `INSERT INTO outbox (case_id, participant_id, channel, kind, payload, send_after) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(caseId, participantId, channel, kind, json(payload), new Date(sendAfter).toISOString());
  }

  due(now = new Date()) {
    return this.db.prepare('SELECT * FROM outbox WHERE sent_at IS NULL AND send_after <= ? ORDER BY id')
      .all(now.toISOString())
      .map((r) => ({ ...r, payload: unjson(r.payload) }));
  }

  markSent(id, error = null) {
    this.db.prepare('UPDATE outbox SET sent_at = ?, attempts = attempts + 1, error = ? WHERE id = ?')
      .run(error ? null : new Date().toISOString(), error, id);
  }

  recordNudge(participantId) {
    this.db.prepare(
      `UPDATE participants SET last_nudge_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), ignored_streak = ignored_streak + 1 WHERE id = ?`
    ).run(participantId);
  }

  recordInbound(caseId, participantId, channel, raw) {
    this.db.prepare('INSERT INTO inbound (case_id, participant_id, channel, raw) VALUES (?, ?, ?, ?)')
      .run(caseId ?? null, participantId ?? null, channel, json(raw));
    if (participantId) {
      this.db.prepare(
        `UPDATE participants SET last_inbound_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), last_activity_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), ignored_streak = 0 WHERE id = ?`
      ).run(participantId);
    }
  }

  participantByPhone(phone) {
    const digits = String(phone ?? '').replace(/\D/g, '').slice(-10);
    if (!digits) return null;
    const row = this.db.prepare(
      `SELECT id FROM participants WHERE replace(replace(replace(phone,' ',''),'+',''),'-','') LIKE ?
       ORDER BY last_activity_at DESC LIMIT 1`
    ).get(`%${digits}`);
    return row ? this.getParticipant(row.id) : null;
  }

  participantByEmail(email) {
    if (!email) return null;
    const row = this.db.prepare(
      'SELECT id FROM participants WHERE lower(email) = lower(?) ORDER BY last_activity_at DESC LIMIT 1'
    ).get(String(email).trim());
    return row ? this.getParticipant(row.id) : null;
  }

  /** Every seller on the title has to sign. The form is only done when all have. */
  sign(caseId, participantId) {
    this.db.prepare(`UPDATE participants SET signed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(participantId);
    const sellers = this.sellers(caseId);
    const all = sellers.length > 0 && sellers.every((s) => s.signed_at);
    if (all) {
      this.db.prepare(`UPDATE cases SET status = 'signed', signed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(caseId);
    }
    this.event(caseId, all ? 'form_signed' : 'partially_signed', { participantId });
    return { allSigned: all, signed: sellers.filter((s) => s.signed_at).length, of: sellers.length };
  }

  /**
   * Gives the store the ability to mint magic links, so every channel can drop
   * a "carry on here" link into a message without knowing about crypto.
   */
  configureLinks({ secret, baseUrl = '' }) {
    this.linkConfig = { secret, baseUrl };
    return this;
  }

  issueAnswerLink(caseId, participantId, purpose = 'answer') {
    if (!this.linkConfig) return null;
    const { token } = issueLink(this.db, this.linkConfig.secret, {
      caseId, participantId, purpose,
      // A sign-off link is single use and short lived; an answering link has to
      // survive being scrolled past for three weeks.
      ttlDays: purpose === 'review_and_sign' ? 7 : 30,
      singleUse: purpose === 'review_and_sign',
    });
    return `${this.linkConfig.baseUrl}/s/${token}`;
  }

  event(caseId, kind, detail) {
    this.db.prepare('INSERT INTO events (case_id, kind, detail) VALUES (?, ?, ?)').run(caseId, kind, json(detail));
  }

  events(caseId) {
    return this.db.prepare('SELECT * FROM events WHERE case_id = ? ORDER BY id').all(caseId)
      .map((e) => ({ ...e, detail: unjson(e.detail) }));
  }
}
