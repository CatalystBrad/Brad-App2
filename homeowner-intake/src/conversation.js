// Channel-agnostic conversation orchestration. The same logic drives WhatsApp,
// SMS, email and the web app, so an answer given in one place shows up in the
// others. Channel differences live in src/channels/*, never here.
import { nextItem, nextBatch } from './batching.js';
import { outstanding } from './questions.js';
import { whatsAppSendMode, planNextNudge, isWithinWindow } from './scheduler.js';
import { getChannel, isSendable } from './channels/index.js';
import * as replies from './channels/replies.js';

const { SIGN_OFFS, PARK_TITLE, CONFIRM_YES, CONFIRM_NO } = replies;

export function lastAsked(store, participantId) {
  const row = store.db.prepare(
    `SELECT payload FROM outbox WHERE participant_id = ? AND kind = 'question' AND sent_at IS NOT NULL
     ORDER BY id DESC LIMIT 1`
  ).get(participantId);
  if (!row) return null;
  const payload = JSON.parse(row.payload);
  return payload.itemId ? store.bank.byId.get(payload.itemId) ?? null : null;
}

/** What kind of message we sent last - so a reply can be read in context. */
function lastOutboundKind(store, participantId) {
  return store.db.prepare(
    'SELECT kind FROM outbox WHERE participant_id = ? AND sent_at IS NOT NULL ORDER BY id DESC LIMIT 1'
  ).get(participantId)?.kind ?? null;
}

function answersSinceNudge(store, caseId, participant) {
  if (!participant.last_nudge_at) return 0;
  const row = store.db.prepare(
    `SELECT count(*) AS n FROM answers WHERE case_id = ? AND answered_at > ? AND status != 'prefilled'`
  ).get(caseId, participant.last_nudge_at);
  return row?.n ?? 0;
}

const deliver = (sender, payload, channel) =>
  sender.send(payload, { channel });      // single-channel senders ignore the second argument

/** Queues, sends and records one outbound message. */
async function dispatch(store, sender, participant, { kind, payload, channel, itemId = null }) {
  store.queue(participant.case_id, participant.id, {
    channel, kind, payload: itemId ? { itemId, ...payload } : payload,
  });
  const row = store.db.prepare('SELECT id FROM outbox WHERE participant_id = ? ORDER BY id DESC LIMIT 1').get(participant.id);
  try {
    const result = await deliver(sender, payload, channel);
    store.markSent(row.id, result?.ok === false ? 'send_failed' : null);
    return result;
  } catch (err) {
    store.markSent(row.id, String(err?.message ?? err));
    store.event(participant.case_id, 'send_failed', { channel, kind, error: String(err?.message ?? err) });
    throw err;
  }
}

function contextFor(store, participant, { progress, items } = {}) {
  const channelName = participant.cadence.channel;
  return {
    to: channelName === 'email' ? participant.email : participant.phone,
    brand: store.brandFor(participant.case_id),
    webLink: store.issueAnswerLink?.(participant.case_id, participant.id) ?? null,
    caseRecord: store.getCase(participant.case_id),
    progress,
    items,
  };
}

async function say(store, sender, participant, kind, text) {
  const channelName = participant.cadence.channel;
  const channel = getChannel(channelName);
  const payload = channel.renderText(text, contextFor(store, participant));
  return dispatch(store, sender, participant, { kind, payload, channel: channelName });
}

/** Sends the next question on the seller's channel, or closes the session. */
export async function askNext(store, sender, participantId, { force = false } = {}) {
  const p = store.getParticipant(participantId);
  const channelName = p.cadence.channel;
  if (!isSendable(channelName)) return { skipped: channelName };

  const answers = store.answers(p.case_id);
  const progress = store.progress(p.case_id);
  const channel = getChannel(channelName);

  const session = {
    plan: p.plan,
    forms: store.formsFor(p.case_id),
    asked: answersSinceNudge(store, p.case_id, p),
    lastSection: lastAsked(store, participantId)?.s ?? null,
    sessionNumber: Math.max(1, store.events(p.case_id).filter((e) => e.kind === 'session_started').length),
  };
  const step = nextItem(store.bank, answers, force ? { ...session, asked: 0 } : session);
  const { item, sessionDone, formDone } = step;

  // The moment the last question is answered, say so and send the sign-off
  // link - once. Outstanding documents carry on separately after that.
  if (formDone && !store.events(p.case_id).some((e) => e.kind === 'collection_complete')) {
    const link = store.issueAnswerLink?.(p.case_id, participantId, 'review_and_sign');
    const docsLeft = outstanding(store.bank, answers, { track: 'paperwork', forms: session.forms }).length;
    await say(store, sender, p, 'review',
      `That is every question answered - thank you, genuinely.\n\nLast step: have a read through and sign it off${link ? `: ${link}` : ''}. Your solicitor cannot send it to the buyer until you do.`
      + (docsLeft ? `\n\nThere ${docsLeft === 1 ? 'is still 1 document' : `are still ${docsLeft} documents`} to send over too - I will ask for those one at a time.` : ''));
    store.event(p.case_id, 'collection_complete', { documentsOutstanding: docsLeft });
    return { done: 'form', documentsOutstanding: docsLeft };
  }

  if (!item) {
    if (formDone && step.paperworkDone) return { done: 'everything' };
    await say(store, sender, p, 'nudge', SIGN_OFFS[progress.answered % SIGN_OFFS.length]);
    return { done: 'session' };
  }

  const existing = answers[item.id];
  const rendered = channel.renderQuestion(item, {
    ...contextFor(store, p, { progress }),
    prefilled: existing?.status === 'prefilled' ? existing.value : undefined,
    // Asking the same thing twice in a row reads as a glitch unless we say why.
    repeat: lastAsked(store, participantId)?.id === item.id,
  });
  await dispatch(store, sender, p, { kind: 'question', payload: rendered.payload, channel: channelName, itemId: item.id });
  return { asked: item.id, mode: rendered.mode, channel: channelName };
}

/**
 * Opens a session, respecting the seller's quiet hours and whatever rule the
 * channel has about starting a conversation.
 */
export async function startSession(store, sender, participantId, { template = 'resume', now = new Date(), ignoreWindow = false } = {}) {
  const p = store.getParticipant(participantId);
  const channelName = p.cadence.channel;
  if (!isSendable(channelName)) return { skipped: channelName };

  if (!ignoreWindow && !isWithinWindow(now, p.cadence)) {
    const plan = planNextNudge(p.cadence, { now, lastActivityAt: p.last_activity_at, lastNudgeAt: p.last_nudge_at });
    return { deferred: true, until: plan.at };
  }

  const channel = getChannel(channelName);
  const progress = store.progress(p.case_id);

  // Email is a digest, not a conversation: send the questions coming up, with
  // one link that opens them.
  if (channel.style === 'digest') {
    const { items } = nextBatch(store.bank, store.answers(p.case_id), p.plan, { forms: store.formsFor(p.case_id) });
    store.event(p.case_id, 'session_started', { mode: 'digest', channel: channelName });
    store.recordNudge(participantId);
    const payload = channel.renderOpener(template, contextFor(store, p, { progress, items }));
    await dispatch(store, sender, p, { kind: 'nudge', payload, channel: channelName });
    return { opened: 'digest', questions: items.length };
  }

  // WhatsApp only allows free-form messages for 24 hours after the seller's
  // last message; outside that an approved template has to open the thread.
  const needsOpener = channelName === 'whatsapp'
    ? whatsAppSendMode(p.last_inbound_at, now) === 'template'
    : channel.needsOpener(p.last_inbound_at, now);

  store.event(p.case_id, 'session_started', { mode: needsOpener ? 'opener' : 'free_form', channel: channelName, template: needsOpener ? template : null });
  store.recordNudge(participantId);

  if (needsOpener) {
    const brand = store.brandFor(p.case_id);
    const ctx = contextFor(store, p, { progress });
    const payload = channelName === 'whatsapp'
      ? channel.renderTemplate(template, template === 'invite'
          ? [p.name ?? 'there', brand.fromName, ctx.caseRecord?.address ?? 'your property']
          : [p.name ?? 'there', String(progress.answered)], p.phone)
      : channel.renderOpener(template, ctx);
    await dispatch(store, sender, p, { kind: 'nudge', payload, channel: channelName });
    return { opened: 'template', template };
  }
  return { opened: 'free_form', ...(await askNext(store, sender, participantId, { force: true })) };
}

/**
 * Handles one inbound message end to end: work out what it means, save it,
 * then ask the next thing.
 */
export async function handleInbound(store, sender, msg, { now = new Date() } = {}) {
  const firm = msg.receivedOn ? store.firmBySender(msg.channel ?? 'whatsapp', msg.receivedOn) : null;
  const participant = msg.channel === 'email' && msg.email
    ? store.participantByEmail(msg.email)
    : store.participantByPhone(msg.from, { firmId: firm?.id ?? null });
  if (!participant) return { ignored: 'unknown_sender' };

  const inboundChannel = msg.channel ?? participant.cadence.channel;
  store.recordInbound(participant.case_id, participant.id, inboundChannel, msg);

  const asked = lastAsked(store, participant.id);
  const caseId = participant.case_id;

  if (msg.kind === 'media') {
    store.addAttachment(caseId, {
      itemId: asked?.track === 'paperwork' ? asked.id : null,
      filename: msg.filename ?? `${inboundChannel}-${msg.mediaId}.jpg`,
      mime: msg.mime, bytes: 0, path: `${inboundChannel}://${msg.mediaId}`, by: participant.id,
    });
    await say(store, sender, participant, 'nudge', 'Got the photo, thank you - I have put it on your file.');
    return { saved: 'attachment', then: await askNext(store, sender, participant.id) };
  }

  if (msg.kind === 'choice' && msg.itemId) {
    // A button reply names the item it answers, but the client is not trusted
    // to choose: it must be the question we actually asked this person. A
    // forged id would otherwise write any value to any question on the form.
    if (!store.bank.byId.has(msg.itemId) || asked?.id !== msg.itemId) {
      store.event(caseId, 'reply_rejected', { itemId: msg.itemId, asked: asked?.id ?? null, channel: inboundChannel });
      return { ignored: 'unexpected_item', then: await askNext(store, sender, participant.id, { force: true }) };
    }
    if (msg.value === CONFIRM_YES) {
      const current = store.answers(caseId)[msg.itemId];
      store.saveAnswer(caseId, msg.itemId, { value: current?.value ?? 'Confirmed', source: inboundChannel, by: participant.id });
      return { confirmed: msg.itemId, then: await askNext(store, sender, participant.id) };
    }
    if (msg.value === CONFIRM_NO) {
      const link = store.issueAnswerLink?.(caseId, participant.id);
      await say(store, sender, participant, 'question', `No problem - put us right here and it goes straight onto the form${link ? `: ${link}` : ''}`);
      return { correcting: msg.itemId };
    }
    if (msg.value === PARK_TITLE) {
      store.park(caseId, msg.itemId, { by: participant.id, source: inboundChannel });
      await say(store, sender, participant, 'nudge', 'No problem - I will ask again in a few days.');
      return { parked: msg.itemId, then: await askNext(store, sender, participant.id) };
    }
    store.saveAnswer(caseId, msg.itemId, { value: msg.value, source: inboundChannel, by: participant.id });
    return { saved: msg.itemId, then: await askNext(store, sender, participant.id) };
  }

  const intent = replies.interpretText(msg.text, asked, {
    afterMenu: lastOutboundKind(store, participant.id) === 'menu',
  });

  // Replying to an invite, or messaging out of the blue, is a request to get on
  // with it - not something to answer with a link.
  if (intent.action === 'unrecognised' && !asked) {
    return { then: await askNext(store, sender, participant.id, { force: true }) };
  }

  switch (intent.action) {
    case 'confirm': {
      const current = store.answers(caseId)[asked.id];
      store.saveAnswer(caseId, asked.id, { value: current?.value ?? 'Confirmed', source: inboundChannel, by: participant.id });
      return { confirmed: asked.id, then: await askNext(store, sender, participant.id) };
    }
    case 'answer':
      store.saveAnswer(caseId, asked.id, { value: intent.value, source: inboundChannel, by: participant.id });
      return { saved: asked.id, then: await askNext(store, sender, participant.id) };
    case 'park':
      if (asked) store.park(caseId, asked.id, { by: participant.id, source: inboundChannel });
      return { parked: asked?.id ?? null, then: await askNext(store, sender, participant.id) };
    case 'unknown':
      if (asked) store.saveAnswer(caseId, asked.id, { value: 'Not known', status: 'unknown', source: inboundChannel, by: participant.id });
      await say(store, sender, participant, 'nudge', 'Noted as not known - that is a perfectly proper answer on this form.');
      return { saved: asked?.id ?? null, then: await askNext(store, sender, participant.id) };
    case 'more':
      return { then: await askNext(store, sender, participant.id, { force: true }) };
    case 'pause':
      store.setPreferences(participant.id, { cadence: { pauseUntil: new Date(now.getTime() + 7 * 86400000).toISOString() } });
      await say(store, sender, participant, 'nudge', 'Paused for a week. Message me any time and we will pick it up - or reply MORE to carry on now.');
      return { paused: true };
    case 'menu':
      await say(store, sender, participant, 'menu', replies.menuMessage(participant.cadence, participant.plan));
      return { menu: true };
    case 'set_cadence': {
      const updated = store.setPreferences(participant.id, { cadence: intent.cadence });
      store.event(caseId, 'preferences_changed', { via: inboundChannel, cadence: intent.cadence });
      await say(store, sender, participant, 'nudge', `Done - ${replies.describeCadence(updated.cadence)} from now on. Reply MORE if you want to carry on right now.`);
      return { cadence: updated.cadence };
    }
    case 'set_size': {
      const updated = store.setPreferences(participant.id, { plan: { mode: 'count', size: intent.size } });
      store.event(caseId, 'preferences_changed', { via: inboundChannel, size: intent.size });
      await say(store, sender, participant, 'nudge', `Right - ${intent.size} question${intent.size === 1 ? '' : 's'} at a time from now on.`);
      return { then: await askNext(store, sender, participant.id, { force: true }) };
    }
    case 'optout': {
      // Say goodbye first, then stop: after this the channel is closed.
      await say(store, sender, participant, 'nudge', `You will not hear from me on ${inboundChannel} again. Your solicitor will be in touch another way.`);
      store.setPreferences(participant.id, { cadence: { channel: 'web_only' } });
      store.event(caseId, 'opted_out', { participantId: participant.id, channel: inboundChannel });
      return { optedOut: true };
    }
    case 'help':
      await say(store, sender, participant, 'nudge',
        `These questions come from the standard property information form your buyer's solicitor will see.\n\n${replies.HELP_HINT}\n\nIf you would rather talk to a person, reply CALL ME.`);
      return { help: true };
    case 'clarify':
      await say(store, sender, participant, 'question', replies.clarifyMessage(intent.options ?? []));
      return { clarified: true };
    case 'web_handoff':
    default: {
      const link = store.issueAnswerLink?.(caseId, participant.id);
      await say(store, sender, participant, 'question', `This one is easier on a screen${link ? `: ${link}` : ''}`);
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
      if (!isSendable(p.cadence.channel)) continue;
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

      // The escalation ladder moved them to another channel: switch, and say so
      // on the file, rather than shouting louder on the one being ignored.
      if (plan.escalated && isSendable(plan.channel)) {
        const reachable = plan.channel === 'email' ? p.email : p.phone;
        if (reachable) {
          store.setPreferences(p.id, { cadence: { channel: plan.channel } });
          store.event(c.id, 'channel_escalated', { participantId: p.id, from: p.cadence.channel, to: plan.channel });
        }
      }
      results.push({ case: c.id, action: 'nudge', channel: store.getParticipant(p.id).cadence.channel, ...(await startSession(store, sender, p.id, { now })) });
    }
  }
  return results;
}
