// Turns the collected answers back into something a conveyancer recognises: the
// TA6 in order, with the audit trail attached and the gaps stated plainly.
import { isApplicable } from '../questions.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fmt = (v) => (v == null ? '' : Array.isArray(v) ? v.join('; ') : typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k}: ${x}`).join('; ') : String(v));

export function buildExport(store, caseId) {
  const c = store.getCase(caseId);
  const answers = store.answers(caseId);
  const sellers = store.sellers(caseId);
  const attachments = store.attachments(caseId);
  const sections = [];

  for (const section of store.bank.sections) {
    const rows = [];
    for (const item of store.bank.items) {
      if (item.s !== section.id) continue;
      if (!isApplicable(item, answers)) continue;
      const a = answers[item.id];
      rows.push({
        id: item.id,
        number: item.n,
        kind: item.kind,
        question: item.q,
        answer: a ? fmt(a.value) : null,
        status: a?.status ?? 'unanswered',
        source: a?.source ?? null,
        attachments: attachments.filter((f) => f.item_id === item.id).map((f) => f.filename),
      });
    }
    if (rows.length) sections.push({ ...section, rows });
  }

  const outstanding = sections.flatMap((s) => s.rows.filter((r) => r.status === 'unanswered' || r.status === 'parked')
    .map((r) => ({ section: s.title, number: r.number, question: r.question, status: r.status })));

  return {
    form: store.bank.form,
    edition: store.bank.edition,
    case: { ref: c.ref, address: c.address, postcode: c.postcode, uprn: c.uprn, status: c.status, signedAt: c.signed_at },
    sellers: sellers.map((s) => ({ name: s.name, signedAt: s.signed_at })),
    progress: store.progress(caseId),
    sections,
    outstanding,
    attachments: attachments.map((f) => ({ itemId: f.item_id, filename: f.filename, uploadedAt: f.uploaded_at })),
    // The reason this whole thing is defensible: who said what, when, from where.
        auditTrail: store.history(caseId).map((h) => ({
      itemId: h.item_id, value: h.value == null ? null : JSON.parse(h.value),
      status: h.status, source: h.source, at: h.answered_at, by: h.answered_by, ip: h.ip,
    })),
    generatedAt: new Date().toISOString(),
  };
}

/** Print-ready HTML - opens in a browser, prints or saves to PDF, no dependencies. */
export function toHtml(data) {
  const statusBadge = (s) => s === 'unanswered'
    ? '<em class="gap">not yet answered</em>'
    : s === 'parked' ? '<em class="gap">seller checking</em>'
    : s === 'prefilled' ? '<span class="pf">pre-filled, awaiting confirmation</span>' : '';

  return `<!DOCTYPE html>
<html lang="en-GB"><head><meta charset="utf-8">
<title>${esc(data.form)} - ${esc(data.case.address ?? data.case.ref ?? '')}</title>
<style>
  :root { --ink:#16232e; --muted:#5b6b7a; --line:#d8dee5; --gap:#a3391f; --ok:#1c6b4a; }
  body { font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; color:var(--ink); max-width:46rem; margin:2rem auto; padding:0 1.25rem; }
  h1 { font-size:1.35rem; margin:0 0 .25rem; }
  h2 { font-size:1rem; margin:2rem 0 .5rem; padding-bottom:.3rem; border-bottom:2px solid var(--ink); }
  .meta { color:var(--muted); font-size:.85rem; margin-bottom:1.5rem; }
  table { width:100%; border-collapse:collapse; }
  td { border-bottom:1px solid var(--line); padding:.5rem .4rem; vertical-align:top; }
  td.n { width:4.5rem; color:var(--muted); font-variant-numeric:tabular-nums; }
  td.a { width:40%; }
  .q { color:var(--muted); }
  .fu td.n::before { content:"↳ "; }
  .gap { color:var(--gap); font-style:normal; font-weight:600; }
  .pf { color:var(--muted); }
  .summary { background:#f4f7f9; border:1px solid var(--line); border-radius:8px; padding:.9rem 1.1rem; margin-bottom:1.5rem; }
  .files { color:var(--muted); font-size:.85rem; }
  .sig { margin-top:.35rem; }
  footer { margin-top:3rem; color:var(--muted); font-size:.78rem; border-top:1px solid var(--line); padding-top:.75rem; }
  @media print { body { margin:0; max-width:none; } h2 { break-after:avoid; } tr { break-inside:avoid; } }
</style></head><body>
<h1>${esc(data.form)} Property Information</h1>
<div class="meta">${esc(data.edition)} &middot; ${esc(data.case.address ?? '')} ${esc(data.case.postcode ?? '')}${data.case.ref ? ` &middot; ref ${esc(data.case.ref)}` : ''}</div>
<div class="summary">
  <strong>${data.progress.answered} of ${data.progress.applicable}</strong> applicable questions answered (${data.progress.percent}%).
  ${data.outstanding.length ? `<strong class="gap">${data.outstanding.length} still outstanding.</strong>` : '<strong>Nothing outstanding.</strong>'}
  ${data.progress.paperworkOutstanding ? `<br>${data.progress.paperworkOutstanding} of ${data.progress.paperworkTotal} documents still to come.` : ''}
  <div class="sig">${data.sellers.map((s) => `${esc(s.name ?? 'Seller')}: ${s.signedAt ? `signed ${esc(s.signedAt)}` : '<span class="gap">not signed</span>'}`).join(' &middot; ')}</div>
</div>
${data.sections.map((s) => `<h2>${esc(s.n)}. ${esc(s.title)}</h2>
<table>${s.rows.map((r) => `<tr class="${r.kind === 'followup' ? 'fu' : ''}">
  <td class="n">${esc(r.number)}</td>
  <td class="q">${esc(r.question)}</td>
  <td class="a">${r.answer ? esc(r.answer) : statusBadge(r.status)}${r.answer && r.status === 'prefilled' ? `<br>${statusBadge(r.status)}` : ''}${r.attachments.length ? `<div class="files">📎 ${r.attachments.map(esc).join(', ')}</div>` : ''}</td>
</tr>`).join('')}</table>`).join('')}
<footer>
  Generated ${esc(data.generatedAt)} from answers given by the seller across web and messaging channels.
  A full audit trail of every answer, including when and by which channel it was given, accompanies this form.
  Question structure derived from the Law Society TA6 Property Information Form (${esc(data.edition)}).
</footer>
</body></html>`;
}

/** The chase list a conveyancer actually wants in their inbox. */
export function toChaseList(data) {
  return {
    address: data.case.address,
    percent: data.progress.percent,
    blocking: data.outstanding,
    documentsOutstanding: data.progress.paperworkOutstanding,
    readyToSend: data.outstanding.length === 0 && data.sellers.every((s) => s.signedAt),
  };
}
