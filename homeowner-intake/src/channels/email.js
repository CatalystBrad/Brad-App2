// Email adapter. Email is not a conversation - a seller will not reply to an
// email with "2". So email works as a digest: here are the three questions
// waiting for you, one tap to answer them.
export { interpretText, clarifyMessage, menuMessage, COMMANDS } from './replies.js';

export const name = 'email';
export const style = 'digest';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Email always opens its own thread; there is no window to stay inside. */
export const needsOpener = () => true;

const SUBJECTS = {
  invite: (b, c) => `${b.firmName}: your property information for ${c?.address ?? 'your sale'}`,
  resume: (b, c, p) => `${p.applicable - p.answered} questions left on ${c?.address ?? 'your sale'}`,
  paperwork: (b) => `One document would move your sale along`,
  deadline: (b, c, p) => `Your buyer is waiting on ${p.applicable - p.answered} answers`,
};

const INTROS = {
  invite: (b) => `${b.fromName} needs the standard property information for your sale. It is normally a 20-page form in one sitting - we have split it into short goes you can do on your phone.`,
  resume: () => `Here is your next short go. It should take a couple of minutes.`,
  paperwork: () => `Nothing to type this time - we just need a photo of some paperwork.`,
  deadline: () => `Your buyer's solicitor is waiting on these before exchange can happen.`,
};

/**
 * A digest: the questions coming up, and one button that opens them.
 * The questions are shown but not answerable inline - they are there so the
 * seller knows what they are walking into before they tap.
 */
export function renderDigest(kind, { to, brand, webLink, progress, items = [], caseRecord } = {}) {
  const b = brand ?? { firmName: 'Your solicitor', fromName: 'Your solicitor', colour: '#1f5f8b', signOff: 'Your solicitor' };
  const subject = (SUBJECTS[kind] ?? SUBJECTS.resume)(b, caseRecord, progress ?? { answered: 0, applicable: 0 });
  const intro = (INTROS[kind] ?? INTROS.resume)(b);
  const preview = items.slice(0, 5);

  const text = [
    `Hello,`,
    '',
    intro,
    '',
    caseRecord?.address ? `Property: ${caseRecord.address}` : '',
    caseRecord?.address ? '' : null,
    ...(preview.length ? ['Coming up:', ...preview.map((i) => `  - ${i.q}`), ''] : []),
    `Answer them here: ${webLink}`,
    '',
    progress ? `${progress.answered} of ${progress.applicable} answered so far - about ${progress.minutesLeft} minutes left in total.` : '',
    '',
    b.signOff,
    '',
    'If you would rather not receive these, reply to this email and we will call you instead.',
  ].filter((l) => l !== null).join('\n');

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f6f8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#16232e;">
  <tr><td style="height:4px;background:${esc(b.colour)};"></td></tr>
  <tr><td style="padding:24px 24px 8px;">
    <div style="font-size:13px;color:#5f7080;margin-bottom:14px;">${esc(b.firmName)}</div>
    <div style="font-size:16px;line-height:1.55;">${esc(intro)}</div>
    ${caseRecord?.address ? `<div style="font-size:14px;color:#5f7080;margin-top:12px;padding-top:12px;border-top:1px solid #e6ebf0;">${esc(caseRecord.address)}</div>` : ''}
  </td></tr>
  ${preview.length ? `<tr><td style="padding:8px 24px 0;">
    <div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#5f7080;margin-bottom:8px;">Coming up</div>
    ${preview.map((i) => `<div style="font-size:15px;line-height:1.45;padding:9px 0;border-bottom:1px solid #e6ebf0;">${esc(i.q)}</div>`).join('')}
  </td></tr>` : ''}
  <tr><td style="padding:22px 24px 6px;">
    <a href="${esc(webLink)}" style="display:block;background:${esc(b.colour)};color:#ffffff;text-decoration:none;text-align:center;padding:15px 20px;border-radius:9px;font-weight:600;font-size:16px;">Answer these now</a>
  </td></tr>
  ${progress ? `<tr><td style="padding:14px 24px 0;font-size:13px;color:#5f7080;">
    ${progress.answered} of ${progress.applicable} answered - about ${progress.minutesLeft} minutes left in total.
  </td></tr>` : ''}
  <tr><td style="padding:18px 24px 26px;font-size:13px;color:#5f7080;">
    ${esc(b.signOff)}<br><br>
    The link is personal to you and works for 30 days. If you would rather not receive these,
    reply to this email and we will call you instead.
  </td></tr>
</table>
</td></tr></table></body></html>`;

  return { to, from: b.emailFrom ?? undefined, replyTo: b.replyTo ?? undefined, subject, text, html };
}

// Kept so the channel interface is uniform; email never asks one at a time.
export const renderQuestion = (item, ctx) => ({ mode: 'web_handoff', payload: renderDigest('resume', { ...ctx, items: [item] }) });
export const renderText = (text, { to, brand } = {}) => ({
  to, subject: `${brand?.firmName ?? 'Your solicitor'}: your property sale`, text, html: `<p>${esc(text)}</p>`,
});
export const renderOpener = (kind, ctx) => renderDigest(kind, ctx);
export const parseInbound = () => [];   // inbound email is not a channel we drive

export function createSender({ apiKey, endpoint = 'https://api.postmarkapp.com/email', from, fetchImpl = globalThis.fetch, dryRun = !apiKey } = {}) {
  const sent = [];
  return {
    name: 'email',
    sent,
    dryRun,
    async send(payload) {
      if (dryRun) { sent.push(payload); return { ok: true, dryRun: true, payload }; }
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'X-Postmark-Server-Token': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          From: payload.from ?? from, To: payload.to, ReplyTo: payload.replyTo,
          Subject: payload.subject, HtmlBody: payload.html, TextBody: payload.text,
          MessageStream: 'outbound',
        }),
      });
      if (!res.ok) throw new Error(`email send failed ${res.status}: ${await res.text()}`);
      return { ok: true, body: await res.json().catch(() => ({})) };
    },
  };
}
