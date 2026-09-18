// SMS adapter. No buttons, no threads, no 24-hour window - but it reaches a
// phone that has no WhatsApp on it, and it is the first fallback when WhatsApp
// goes unanswered.
//
// Shaped for Twilio/MessageBird-style APIs; the inbound parser takes their
// webhook body.
import { optionsFor, PARK_TITLE, CONFIRM_YES, CONFIRM_NO } from './replies.js';

export { interpretText, clarifyMessage, menuMessage, formatPrefill, COMMANDS, PARK_TITLE, CONFIRM_YES, CONFIRM_NO, HELP_HINT } from './replies.js';

export const name = 'sms';
export const style = 'conversational';

// One segment is 160 GSM-7 characters; anything with an emoji or a curly
// apostrophe drops to 70 per segment. Two segments is a sensible ceiling -
// past that, send the link instead.
export const LIMITS = { segment: 160, maxChars: 306, optionsInline: 5 };

const clip = (s, n) => (String(s).length <= n ? String(s) : `${String(s).slice(0, n - 1)}…`);

// Curly quotes and dashes silently double the cost of a message.
export const toGsm = (s) => String(s ?? '')
  .replace(/[‘’]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/[–—]/g, '-')
  .replace(/[…]/g, '...')
  .replace(/[ ]/g, ' ');

export const segments = (body) => Math.max(1, Math.ceil(toGsm(body).length / LIMITS.segment));

export function renderQuestion(item, { to, webLink, prefilled, stopHint = false } = {}) {
  const tail = stopHint ? '\nReply STOP to opt out.' : '';

  if (prefilled != null) {
    const body = toGsm(`${item.q}\nWe have: ${formatPrefillLocal(prefilled)}\nReply 1 = ${CONFIRM_YES}, 2 = ${CONFIRM_NO}, 3 = ${PARK_TITLE}${tail}`);
    return { mode: 'text', options: [CONFIRM_YES, CONFIRM_NO, PARK_TITLE], payload: { to, body: clip(body, LIMITS.maxChars) } };
  }

  // Free text, uploads and multi-field blocks belong on a screen.
  if (['upload', 'service_block', 'multi', 'checklist'].includes(item.t)) {
    return {
      mode: 'web_handoff',
      payload: { to, body: toGsm(clip(`${item.q}\nEasier on a screen: ${webLink ?? ''}${tail}`, LIMITS.maxChars)) },
    };
  }

  const options = optionsFor(item);
  if (options.length === 0) {
    return { mode: 'text', payload: { to, body: toGsm(clip(`${item.q}\nJust reply with your answer, or SKIP.${tail}`, LIMITS.maxChars)) } };
  }

  const numbered = options.map((o, i) => `${i + 1} ${o}`).join(', ');
  const body = toGsm(`${item.q}\nReply: ${numbered}${tail}`);
  // Too long to be worth two or three segments - send the link instead.
  if (body.length > LIMITS.maxChars || options.length > LIMITS.optionsInline) {
    return {
      mode: 'web_handoff',
      payload: { to, body: toGsm(clip(`${item.q}\nThere are a few options - tap here: ${webLink ?? ''}${tail}`, LIMITS.maxChars)) },
    };
  }
  return { mode: 'text', options, payload: { to, body } };
}

const formatPrefillLocal = (v) => (Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v ? Object.values(v).filter(Boolean).join(', ') : String(v));

export const renderText = (text, { to } = {}) => ({ to, body: toGsm(clip(text, LIMITS.maxChars)) });

/** SMS has no session window, so an opener is just the first message. */
export const needsOpener = () => false;

export function renderOpener(kind, { to, brand, webLink, progress } = {}) {
  const from = brand?.fromName ?? 'your solicitor';
  const bodies = {
    invite: `Hi - ${from} here about your property sale. I can collect the property information a couple of questions at a time by text. Reply GO to start, or use ${webLink ?? ''}`,
    resume: `${progress?.answered ?? 0} of your property questions are done. Reply GO for two more, or ${webLink ?? ''}`,
    paperwork: `One photo would move your sale along. Upload it here: ${webLink ?? ''}`,
    deadline: `Your buyer is waiting on ${progress ? progress.applicable - progress.answered : 'a few'} answers to exchange. Reply GO to finish them.`,
  };
  return { to, body: toGsm(clip(bodies[kind] ?? bodies.resume, LIMITS.maxChars)) };
}

/** Normalises a Twilio-style inbound webhook body. */
export function parseInbound(body) {
  const out = [];
  const entries = Array.isArray(body) ? body : [body];
  for (const msg of entries) {
    if (!msg?.From) continue;
    const from = String(msg.From).replace(/^whatsapp:/, '');
    const common = { from, messageId: msg.MessageSid ?? msg.id ?? null, at: new Date().toISOString(), channel: 'sms' };
    if (Number(msg.NumMedia ?? 0) > 0) {
      out.push({ ...common, kind: 'media', mediaId: msg.MediaUrl0, mime: msg.MediaContentType0 ?? 'image/jpeg', filename: null });
    } else {
      out.push({ ...common, kind: 'text', text: msg.Body ?? '' });
    }
  }
  return out;
}

export function createSender({ accountSid, authToken, from, fetchImpl = globalThis.fetch, dryRun = !authToken } = {}) {
  const sent = [];
  return {
    name: 'sms',
    sent,
    dryRun,
    async send(payload) {
      if (dryRun) { sent.push(payload); return { ok: true, dryRun: true, payload }; }
      const form = new URLSearchParams({ To: payload.to, From: payload.from ?? from, Body: payload.body });
      const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form,
      });
      if (!res.ok) throw new Error(`sms send failed ${res.status}: ${await res.text()}`);
      return { ok: true, body: await res.json().catch(() => ({})) };
    },
  };
}
