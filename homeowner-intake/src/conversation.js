// Channel-agnostic conversation orchestration. The same logic drives WhatsApp,
// SMS and the web app, so an answer given in one place shows up in the others.
import { nextItem } from './batching.js';
import { whatsAppSendMode, planNextNudge, isWithinWindow } from './scheduler.js';
import * as wa from './channels/whatsapp.js';

const SIGN_OFFS = [
  'That is you done for now - thank you. I will come back with a couple more.',
  'Great, that is another one off the list. Speak soon.',
  'Done for today. Every answer moves the sale forward.',
];

export function lastAsked(store, participantId) {
  const row = store.db.prepare(
    `SELECT payload FROM outbox WHERE participant_id = ? AND kind = 'question' AND sent_at IS NOT NULL
     ORDER BY id DESC LIMIT 1`
  ).get(participantId);
  if (!row) return null;
  const payload = JSON.parse(row.payload);
  return payload.itemId ? store.bank.byId.get(payload.itemId) ?? null : null;
}

function answersSinceNudge(store, caseId, participant) {
  if (!participant.last_nudge_at) return 0;
  const row = store.db.prepare(
    `SELECT count(*) AS n FROM answers WHERE case_id = ? AND answered_at > ? AND status != 'prefilled'`
  ).get(caseId, participant.last_nudge_at);
  return row?.n ?? 0;
}

/** Sends the next question on the seller's channel, or closes the session. */
export async function askNext(store, sender, participantId, { force = false } = {}) {
  const p = store.getParticipant(participantId);
  const c = store.getCase(p.case_id);
  const answers = store.answers(p.case_id);
  const progress = store.progress(p.case_id);

  const session = {
    plan: p.plan,
    asked: answersSinceNudge(store, p.case_id, p),
    lastSection: lastAsked(store, participantId)?.s ?? null,
    sessionNumber: Math.max(1, store.events(p.case_id).filter((e) => e.kind === 'session_started').length),
  };
  const { item, sessionDone, formDone } = nextItem(store.bank, answers, force ? { ...session, asked: 0 } : session);

  if (formDone) {
    const link = store.issueAnswerLink?.(p.case_id, participantId, 'review_and_sign');
    const body = `That is every question answered - thank you, genuinely.\n\nLast step: have a read through and sign it off${link ? `: ${link}` : ''}. Your solicitor cannot send it to the buyer until you do.`;
    await send(store, sender, p, { kind: 'review', text: body });
    store.event(p.case_id, 'collection_complete', {});
    return { done: 'form' };
  }
  if (sessionDone) {
    await send(store, sender, p, { kind: 'nudge', text: SIGN_OFFS[progress.answered % SIGN_OFFS.length] });
    return { done: 'session' };
  }

  const webLink = store.issueAnswerLink?.(p.case_id, participantId) ?? null;
  const existing = answers[item.id];
  const rendered = wa.renderQuestion(item, {
    to: p.phone, webLink, progress,
    prefilled: existing?.status === 'prefilled' ? existing.value : undefined,
  });
  store.queue(p.case_id, participantId, { channel: p.cadence.channel, kind: 'question', payload: { itemId: item.id, ...rendered.payload } });
  const res = await sender.send(rendered.payload);
  const row = store.db.prepare(`SELECT id FROM outbox WHERE participant_id = ? ORDER BY id DESC LIMIT 1`).get(participantId);
  store.markSent(row.id, res?.ok === false ? 'send_failed' : null);
  return { asked: item.id, mode: rendered.mode };
}

async function send(store, sender, participant, { kind, text }) {
  store.queue(participant.case_id, participant.id, {
    channel: participant.cadence.channel,
    kind,
    payload: { messaging_product: 'whatsapp', to: participant.phone, type: 'text', text: { preview_url: true, body: text } },
  });
  const row = store.db.prepare(`SELECT id, payload FROM outbox WHERE participant_id = ? ORDER BY id DESC LIMIT 1`).get(participant.id);
  await sender.send(JSON.parse(row.payload));
  store.markSent(row.id);
}

/** Opens a session, respecting the 24-hour window and the seller's quiet hours. */
export async function startSession(store, sender, participantId, { template = 'resume', now = new Date(), ignoreWindow = false } = {}) {
  const p = store.getParticipant(participantId);
  if (!ignoreWindow && !isWithinWindow(now, p.cadence)) {
    const plan = planNextNudge(p.cadence, { now, lastActivityAt: p.last_activity_at, lastNudgeAt: p.last_nudge_at });
    return { deferred: true, until: plan.at };
  }
  const mode = whatsAppSendMode(p.last_inbound_at, now);
  store.event(p.case_id, 'session_started', { mode, template: mode === 'template' ? template : null });
  store.recordNudge(participantId);

  if (mode === 'template') {
    const progress = store.progress(p.case_id);
    const params = template === 'invite'
      ? [p.name ?? 'there', store.getCase(p.case_id).firm ?? 'your solicitor', store.getCase(p.case_id).address ?? 'your property']
      : [p.name ?? 'there', String(progress.answered)];
    const payload = wa.renderTemplate(template, params, p.phone);
    store.queue(p.case_id, participantId, { channel: p.cadence.channel, kind: 'nudge', payload });
    const row = store.db.prepare(`SELECT id FROM outbox WHERE participant_id = ? ORDER BY id DESC LIMIT 1`).get(participantId);
    await sender.send(payload);
    store.markSent(row.id);
    return { opened: 'template', template };
  }
  return { opened: 'free_form', ...(await askNext(store, sender, participantId, { force: true })) };
}

/**
 * Handles one inbound message end to end: work out what it means, save it,
 * then ask the next thing.
 */
export async function handleInbound(store, sender, msg, { now = new Date() } = {}) {
  const participant = store.participantByPhone(msg.from);
  if (!participant) return { ignored: 'unknown_sender' };
  store.recordInbound(participant.case_id, participant.id, 'whatsapp', msg);

  const asked = lastAsked(store, participant.id);
  const caseId = participant.case_id;

  if (msg.kind === 'media') {
    const itemId = asked?.track === 'paperwork' ? asked.id : `unsorted::${msg.mediaId}`;
    store.addAttachment(caseId, {
      itemId: asked?.track === 'paperwork' ? itemId : null,
      filename: msg.filename ?? `whatsapp-${msg.mediaId}.jpg`,
      mime: msg.mime, bytes: 0, path: `whatsapp://${msg.mediaId}`, by: participant.id,
    });
    await send(store, sender, participant, { kind: 'nudge', text: 'Got the photo, thank you - I have put it on your file.' });
    return { saved: 'attachment', then: await askNext(store, sender, participant.id) };
  }

  if (msg.kind === 'choice' && msg.itemId) {
    if (msg.value === wa.CONFIRM_YES) {
      const current = store.answers(caseId)[msg.itemId];
      store.saveAnswer(caseId, msg.itemId, { value: current?.value ?? 'Confirmed', source: 'whatsapp', by: participant.id });
      return { confirmed: msg.itemId, then: await askNext(store, sender, participant.id) };
    }
    if (msg.value === wa.CONFIRM_NO) {
      const link = store.issueAnswerLink?.(caseId, participant.id);
      await send(store, sender, participant, { kind: 'question', text: `No problem - put us right here and it goes straight onto the form${link ? `: ${link}` : ''}` });
      return { correcting: msg.itemId };
    }
    if (msg.value === wa.PARK_TITLE) {
      store.park(caseId, msg.itemId, { by: participant.id, source: 'whatsapp' });
      await send(store, sender, participant, { kind: 'nudge', text: 'No problem - I will ask again in a few days.' });
      return { parked: msg.itemId, then: await askNext(store, sender, participant.id) };
    }
    store.saveAnswer(caseId, msg.itemId, { value: msg.value, source: 'whatsapp', by: participant.id });
    return { saved: msg.itemId, then: await askNext(store, sender, participant.id) };
  }

  const intent = wa.interpretText(msg.text, asked);

  // Replying to an invite, or messaging out of the blue, is a request to get
  // on with it - not something to answer with a link.
  if (intent.action === 'unrecognised' && !asked) {
    return { then: await askNext(store, sender, participant.id, { force: true }) };
  }

  switch (intent.action) {
    case 'confirm': {
      const current = store.answers(caseId)[asked.id];
      store.saveAnswer(caseId, asked.id, { value: current?.value ?? 'Confirmed', source: 'whatsapp', by: participant.id });
      return { confirmed: asked.id, then: await askNext(store, sender, participant.id) };
    }
    case 'answer':
      store.saveAnswer(caseId, asked.id, { value: intent.value, source: 'whatsapp', by: participant.id });
      return { saved: asked.id, then: await askNext(store, sender, participant.id) };
    case 'park':
      if (asked) store.park(caseId, asked.id, { by: participant.id, source: 'whatsapp' });
      return { parked: asked?.id ?? null, then: await askNext(store, sender, participant.id) };
    case 'unknown':
      if (asked) store.saveAnswer(caseId, asked.id, { value: 'Not known', status: 'unknown', source: 'whatsapp', by: participant.id });
      await send(store, sender, participant, { kind: 'nudge', text: 'Noted as not known - that is a perfectly proper answer on this form.' });
      return { saved: asked?.id ?? null, then: await askNext(store, sender, participant.id) };
    case 'more':
      return { then: await askNext(store, sender, participant.id, { force: true }) };
    case 'pause': {
      store.setPreferences(participant.id, { cadence: { pauseUntil: new Date(now.getTime() + 7 * 86400000).toISOString() } });
      await send(store, sender, participant, { kind: 'nudge', text: 'Paused for a week. Message me any time and we will pick it up - or reply MORE to carry on now.' });
      return { paused: true };
    }
    case 'menu':
      await send(store, sender, participant, { kind: 'nudge', text: wa.menuMessage(participant.cadence, participant.plan) });
      return { menu: true };
    case 'optout': {
      store.setPreferences(participant.id, { cadence: { channel: 'web_only' } });
      store.event(caseId, 'whatsapp_opt_out', { participantId: participant.id });
      await send(store, sender, participant, { kind: 'nudge', text: 'You will not hear from me on WhatsApp again. Your solicitor will be in touch another way.' });
      return { optedOut: true };
    }
    case 'help':
      await send(store, sender, participant, { kind: 'nudge', text: `These questions come from the standard property information form your buyer's solicitor will see.\n\n${wa.HELP_HINT}\n\nIf you would rather talk to a person, reply CALL ME.` });
      return { help: true };
    case 'clarify':
      await send(store, sender, participant, { kind: 'question', text: wa.clarifyMessage(intent.options ?? []) });
      return { clarified: true };
    case 'web_handoff':
    default: {
      const link = store.issueAnswerLink?.(caseId, participant.id);
      await send(store, sender, participant, { kind: 'question', text: `This one is easier on a screen${link ? `: ${link}` : ''}` });
      return { handedOff: true };
    }
  }
}

/** Processes everything due: the worker tick. */
export async function tick(store, sender, { now = new Date() } = {}) {
  const results = [];
  for (const c of store.listCases()) {
    if (c.status !== 'collecting') continue;
    for (const p of store.sellers(c.id)) {
      if (p.cadence.channel === 'web_only') continue;
      const progress = store.progress(c.id);
      const plan = planNextNudge(p.cadence, {
        now,
        lastActivityAt: p.last_activity_at,
        lastNudgeAt: p.last_nudge_at,
        ignoredStreak: p.ignored_streak,
        formComplete: progress.percent === 100,
        deadline: c.deadline,
        sessionsLeft: Math.ceil(progress.secondsLeft / Math.max(p.plan.mode === 'time' ? p.plan.size : 90, 30)),
      });
      if (!plan.send || plan.at > now) continue;
      if (plan.handOffToHuman) {
        store.event(c.id, 'handoff_to_human', { participantId: p.id, ignoredStreak: p.ignored_streak });
        store.queue(c.id, p.id, { channel: 'task', kind: 'handoff', payload: { reason: 'no response on any digital channel - please ring the seller' } });
        results.push({ case: c.id, action: 'handoff' });
        continue;
      }
      results.push({ case: c.id, action: 'nudge', ...(await startSession(store, sender, p.id, { now })) });
    }
  }
  return results;
}
