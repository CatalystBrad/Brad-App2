// WhatsApp Cloud API adapter.
//
// The platform limits shape the product, so they are encoded here rather than
// discovered in production:
//   * reply buttons: max 3, max 20 characters of title each
//   * list messages: max 10 rows, 24 characters per row title
//   * interactive body: 1024 characters
//   * free-form messages only within 24h of the seller's last message;
//     outside that window an approved template must open the thread
// Anything that does not fit becomes a one-line message with a magic link into
// the web app, which is why both channels share one question bank.
import {
  PARK_TITLE, CONFIRM_YES, CONFIRM_NO, HELP_HINT, COMMANDS,
  formatPrefill, interpretText, clarifyMessage, menuMessage,
} from './replies.js';

export {
  PARK_TITLE, CONFIRM_YES, CONFIRM_NO, HELP_HINT, COMMANDS,
  formatPrefill, interpretText, clarifyMessage, menuMessage,
};

export const name = 'whatsapp';
export const style = 'conversational';

export const LIMITS = {
  buttons: 3,
  buttonTitle: 20,
  rows: 10,
  rowTitle: 24,
  body: 1024,
  footer: 60,
};

const clip = (s, n) => (s == null ? '' : String(s).length <= n ? String(s) : `${String(s).slice(0, n - 1)}…`);


/**
 * Renders one question into a WhatsApp send payload.
 * Returns { payload, mode } where mode is 'interactive' | 'text' | 'web_handoff'.
 */
export function renderQuestion(item, { to, webLink, progress, prefilled } = {}) {
  const footer = progress ? clip(`${progress.answered}/${progress.applicable} done · ${progress.minutesLeft} min left`, LIMITS.footer) : undefined;
  const base = { messaging_product: 'whatsapp', to, recipient_type: 'individual' };

  const bodyText = item.help ? `${item.q}\n\n_${item.help}_` : item.q;
  const body = clip(bodyText, LIMITS.body);

  // Confirming what we already found: one tap, whatever kind of field it is.
  if (prefilled != null) {
    return {
      mode: 'interactive',
      payload: {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: clip(`${item.q}\n\nWe have: *${formatPrefill(prefilled)}*`, LIMITS.body) },
          ...(footer ? { footer: { text: footer } } : {}),
          action: {
            buttons: [CONFIRM_YES, CONFIRM_NO, PARK_TITLE].map((opt) => ({
              type: 'reply',
              reply: { id: replyId(item.id, opt), title: clip(opt, LIMITS.buttonTitle) },
            })),
          },
        },
      },
    };
  }

  // Free text, uploads and anything with a long option list are better in the
  // web app - we hand over rather than degrade.
  const freeText = ['text', 'longtext', 'address', 'service_block', 'checklist'].includes(item.t);
  if (item.t === 'upload' || item.t === 'service_block' || item.t === 'checklist') {
    return {
      mode: 'web_handoff',
      payload: {
        ...base,
        type: 'text',
        text: { preview_url: false, body: clip(`${item.t === 'upload' ? '📎 ' : ''}${item.q}\n\n${item.t === 'upload' ? 'Send a photo straight back to this chat, or open: ' : item.t === 'checklist' ? `A list of ${item.rows?.length ?? 'a few'} - much faster to tap through on a screen: ` : 'Quicker on a screen: '}${webLink}`, LIMITS.body) },
      },
    };
  }

  const options = optionsFor(item);
  if (freeText || options.length === 0) {
    return {
      mode: 'text',
      payload: { ...base, type: 'text', text: { preview_url: false, body: `${body}\n\n(Just type your answer. Or reply SKIP to come back to it.)` } },
    };
  }

  if (options.length <= LIMITS.buttons) {
    return {
      mode: 'interactive',
      payload: {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: body },
          ...(footer ? { footer: { text: footer } } : {}),
          action: {
            buttons: options.slice(0, LIMITS.buttons).map((opt) => ({
              type: 'reply',
              reply: { id: replyId(item.id, opt), title: clip(opt, LIMITS.buttonTitle) },
            })),
          },
        },
      },
    };
  }

  const rows = options.slice(0, LIMITS.rows).map((opt) => ({
    id: replyId(item.id, opt),
    title: clip(opt, LIMITS.rowTitle),
    description: opt.length > LIMITS.rowTitle ? clip(opt, 72) : undefined,
  }));
  return {
    mode: 'interactive',
    payload: {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: body },
        ...(footer ? { footer: { text: footer } } : {}),
        action: { button: 'Choose', sections: [{ title: 'Pick one', rows }] },
      },
    },
  };
}

function optionsFor(item) {
  if (item.t === 'yesno') return ['Yes', 'No', PARK_TITLE];
  if (item.t === 'choice' && item.opts) return item.opts.length < LIMITS.buttons ? [...item.opts, PARK_TITLE] : item.opts;
  if (item.t === 'multi' && item.opts) return item.opts;          // multi needs the web app for more than one tick
  if (['date', 'year', 'date_or_unknown', 'year_or_unknown', 'month_year_or_unknown'].includes(item.t)) return [];
  return [];
}

export const replyId = (itemId, option) => `${itemId}|${Buffer.from(option).toString('base64url')}`;

export function decodeReplyId(id) {
  const [itemId, b64] = String(id ?? '').split('|');
  if (!itemId || !b64) return null;
  try {
    return { itemId, option: Buffer.from(b64, 'base64url').toString('utf8') };
  } catch {
    return null;
  }
}

// Template messages are the only way to reopen a conversation after 24 hours.
// These have to be submitted to Meta for approval before use.
export const TEMPLATES = {
  invite: {
    name: 'ta6_invite',
    example: 'Hi {{1}}, {{2}} here about the sale of {{3}}. I can collect the property information a couple of questions at a time by WhatsApp, so you never have to sit down to a 20-page form. Ready to start?',
  },
  resume: {
    name: 'ta6_resume',
    example: 'Hi {{1}} - {{2}} of your property questions are done. Two more when you have a minute?',
  },
  paperwork: {
    name: 'ta6_paperwork',
    example: 'Hi {{1}}, one photo would move your sale along: {{2}}. Just send it to this chat.',
  },
  deadline: {
    name: 'ta6_deadline',
    example: 'Hi {{1}}, your buyer is waiting on {{2}} answers to exchange. Can we finish them this week?',
  },
};

/** Plain text on the seller's thread. Part of the uniform channel interface. */
export const renderText = (text, { to } = {}) => ({
  messaging_product: 'whatsapp',
  to,
  type: 'text',
  text: { preview_url: true, body: clip(text, LIMITS.body) },
});

/** Outside the 24-hour customer window only an approved template may be sent. */
export const needsOpener = (lastInboundAt, now = new Date()) =>
  !lastInboundAt || (now - new Date(lastInboundAt)) / 3600000 >= 24;

export const renderOpener = (kind, { to, brand, progress, caseRecord } = {}) =>
  renderTemplate(kind, kind === 'invite'
    ? [brand?.sellerName ?? 'there', brand?.fromName ?? 'your solicitor', caseRecord?.address ?? 'your property']
    : [brand?.sellerName ?? 'there', String(progress?.answered ?? 0)], to);

export function renderTemplate(name, params, to) {
  const tpl = TEMPLATES[name];
  if (!tpl) throw new Error(`unknown template: ${name}`);
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: tpl.name,
      language: { code: 'en_GB' },
      components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: String(text) })) }],
    },
  };
}

/** Normalises a Cloud API webhook into something the rest of the app can use. */
export function parseInbound(webhookBody) {
  const out = [];
  for (const entry of webhookBody?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      for (const msg of value.messages ?? []) {
        const from = msg.from;
        const common = { from, messageId: msg.id, at: msg.timestamp ? new Date(+msg.timestamp * 1000).toISOString() : null };
        if (msg.type === 'interactive') {
          const reply = msg.interactive?.button_reply ?? msg.interactive?.list_reply;
          const decoded = decodeReplyId(reply?.id);
          out.push({ ...common, kind: 'choice', itemId: decoded?.itemId ?? null, value: decoded?.option ?? reply?.title ?? null });
        } else if (msg.type === 'text') {
          out.push({ ...common, kind: 'text', text: msg.text?.body ?? '' });
        } else if (['image', 'document'].includes(msg.type)) {
          const media = msg[msg.type];
          out.push({ ...common, kind: 'media', mediaId: media?.id, mime: media?.mime_type, filename: media?.filename ?? null, caption: media?.caption ?? null });
        } else {
          out.push({ ...common, kind: 'unsupported', type: msg.type });
        }
      }
    }
  }
  return out;
}

// An outbound sender. Real credentials go in env; without them it records what
// it would have sent, so the whole flow can be demonstrated and tested.
export function createSender({ token, phoneNumberId, fetchImpl = globalThis.fetch, dryRun = !token } = {}) {
  const sent = [];
  return {
    sent,
    dryRun,
    async send(payload) {
      if (dryRun) {
        sent.push(payload);
        return { ok: true, dryRun: true, payload };
      }
      const res = await fetchImpl(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`whatsapp send failed ${res.status}: ${JSON.stringify(body)}`);
      return { ok: true, body };
    },
  };
}
