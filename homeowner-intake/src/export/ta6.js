// Turns the collected answers back into something a conveyancer recognises: the
// TA6 in order, with the audit trail attached and the gaps stated plainly.
import { isApplicable, inForms } from '../questions.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fmt = (v, item = null) => {
  if (v == null) return '';
  if (Array.isArray(v)) return v.join('; ');
  if (typeof v !== 'object') return String(v);
  // A TA10 checklist: show the label the seller saw, not the storage key.
  if (item?.t === 'checklist') {
    const labels = new Map((item.rows ?? []).map((r) => [r.k, r.label]));
    return Object.entries(v)
      .map(([k, entry]) => {
        const status = entry?.status ?? entry;
        const price = entry?.price ? ` (would sell for ${entry.price})` : '';
        return `${labels.get(k) ?? k}: ${status}${price}`;
      })
      .join('; ');
  }
  return Object.entries(v).map(([k, x]) => `${k}: ${x}`).join('; ');
};

export function buildExport(store, caseId) {
  const c = store.getCase(caseId);
  const answers = store.answers(caseId);
  const sellers = store.sellers(caseId);
  const attachments = store.attachments(caseId);
  const forms = store.formsFor(caseId);
  const scopedItems = inForms(store.bank.items, forms);
  const sections = [];

  for (const section of inForms(store.bank.sections, forms)) {
    const rows = [];
    for (const item of scopedItems) {
      if (item.s !== section.id) continue;
      if (!isApplicable(item, answers)) continue;
      const a = answers[item.id];
      const checklistRows = item.t === 'checklist' && a?.value && typeof a.value === 'object'
        ? (item.rows ?? []).map((r) => {
            const entry = a.value[r.k];
            if (entry == null) return null;
            return { label: r.label, status: entry?.status ?? entry, price: entry?.price ?? null };
          }).filter(Boolean)
        : null;
      rows.push({
        id: item.id,
        number: item.n,
        kind: item.kind,
        track: item.track ?? 'form',
        question: item.q,
        answer: a ? fmt(a.value, item) : null,
        checklistRows,
        status: a?.status ?? 'unanswered',
        source: a?.source ?? null,
        attachments: attachments.filter((f) => f.item_id === item.id).map((f) => f.filename),
      });
    }
    if (rows.length) sections.push({ ...section, rows });
  }

  const isOutstanding = (r) => r.status === 'unanswered' || r.status === 'parked' || r.status === 'prefilled';
  // Questions and paperwork are chased differently, so they are counted
  // differently. Lumping them together makes a form that is fully answered
  // look unanswered, which is how a chase list loses a reader's trust.
  const outstanding = sections.flatMap((s) => s.rows
    .filter((r) => r.track === 'form' && isOutstanding(r))
    .map((r) => ({ section: s.title, number: r.number, question: r.question, status: r.status })));
  const documentsOutstanding = sections.flatMap((s) => s.rows
    .filter((r) => r.track === 'paperwork' && isOutstanding(r))
    .map((r) => ({ section: s.title, number: r.number, document: r.question, status: r.status })));

  const formMeta = store.bank.forms.filter((f) => forms.includes(f.id));
  return {
    forms: formMeta,
    form: formMeta.map((f) => f.form).join(' + '),
    edition: formMeta.map((f) => f.edition).join(' · '),
    case: { ref: c.ref, address: c.address, postcode: c.postcode, uprn: c.uprn, status: c.status, signedAt: c.signed_at },
    sellers: sellers.map((s) => ({ name: s.name, signedAt: s.signed_at })),
    progress: store.progress(caseId),
    sections,
    outstanding,
    documentsOutstanding,
    attachments: attachments.map((f) => ({ itemId: f.item_id, filename: f.filename, uploadedAt: f.uploaded_at })),
    // The reason this whole thing is defensible: who said what, when, from where.
        auditTrail: store.history(caseId).map((h) => ({
      itemId: h.item_id, value: h.value == null ? null : JSON.parse(h.value),
      status: h.status, source: h.source, at: h.answered_at, by: h.answered_by, ip: h.ip,
    })),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * A fittings list is a list. Rendering it as one long semicolon-separated run
 * makes it unreadable for the person who has to check it against the contract.
 */
function renderAnswer(row, statusBadge) {
  if (row.checklistRows?.length) {
    return `<ul class="fittings">${row.checklistRows.map((f) => `<li>
      <span class="ft">${esc(f.label)}</span>
      <span class="fs ${f.status?.toLowerCase().includes('taking') ? 'out' : f.status?.toLowerCase().includes('not there') || f.status?.toLowerCase().includes('no covering') ? 'none' : 'in'}">${esc(f.status)}${f.price ? ` — ${esc(f.price)}` : ''}</span>
    </li>`).join('')}</ul>`;
  }
  if (!row.answer) return statusBadge(row.status);
  return `${esc(row.answer)}${row.status === 'prefilled' ? `<br>${statusBadge(row.status)}` : ''}`;
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
  td.a { width:46%; }
  .q { color:var(--muted); }
  .fu td.n::before { content:"↳ "; }
  .gap { color:var(--gap); font-style:normal; font-weight:600; }
  .pf { color:var(--muted); }
  .summary { background:#f4f7f9; border:1px solid var(--line); border-radius:8px; padding:.9rem 1.1rem; margin-bottom:1.5rem; }
  .files { color:var(--muted); font-size:.85rem; }
  ul.fittings { list-style:none; margin:0; padding:0; }
  ul.fittings li { display:flex; justify-content:space-between; gap:.75rem; padding:.2rem 0; border-bottom:1px dotted var(--line); }
  ul.fittings li:last-child { border-bottom:0; }
  .ft { color:var(--ink); }
  .fs { white-space:nowrap; font-weight:600; }
  .fs.in { color:var(--ok); }
  .fs.out { color:var(--gap); }
  .fs.none { color:var(--muted); font-weight:400; }
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
  <td class="a">${renderAnswer(r, statusBadge)}${r.attachments.length ? `<div class="files">📎 ${r.attachments.map(esc).join(', ')}</div>` : ''}</td>
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
  const signed = data.sellers.length > 0 && data.sellers.every((s) => s.signedAt);
  return {
    address: data.case.address,
    percent: data.progress.percent,
    blocking: data.outstanding,
    documentsOutstanding: data.documentsOutstanding.length,
    signed,
    // A form whose promised certificates never arrived is not ready to go to a
    // buyer, however complete the answers look.
    readyToSend: data.outstanding.length === 0 && data.documentsOutstanding.length === 0 && signed,
  };
}
