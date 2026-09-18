// The drip engine. A seller never sees "180 questions" - they see the two or
// three that fit the time they have right now.
import { outstanding, isApplicable, isAnswered, inForms } from './questions.js';

export const DEFAULT_PLAN = {
  mode: 'count',      // 'count' | 'time'
  size: 3,            // 3 questions, or with mode 'time', seconds
  warmUp: true,       // open with quick confirmations to build momentum
};

// Follow-ups are cheap to answer and expensive to lose: a bare "Yes" with no
// detail is worse than no answer at all, because it looks complete.
const OVERFLOW_KINDS = new Set(['followup']);

function score(item, ctx) {
  let s = 0;
  if (item.kind === 'followup') s -= 1000;                       // close open loops first
  if (ctx.parkedUntilPassed.has(item.id)) s -= 500;               // things they asked to revisit
  if (ctx.lastSection && item.s === ctx.lastSection) s -= 40;     // stay in one topic
  // Optional questions are the last thing anyone should be asked; they are the
  // first thing that makes a form feel pointless.
  if (item.optional) s += 400;
  if (ctx.warmUp) {
    if (item.confirmable) s -= 120;                               // one-tap confirmations
    s += Math.min(item.secs ?? 30, 180) / 2;                      // defer the heavy ones
  }
  s += (ctx.sectionOrder.get(item.s) ?? 99) * 10;
  s += (ctx.bankIndex.get(item.id) ?? 0) / 1000;                  // stable tie-break
  return s;
}

function buildContext(bank, answers, opts = {}) {
  const now = opts.now ?? new Date();
  const parkedUntilPassed = new Set();
  for (const [id, a] of Object.entries(answers)) {
    if (a?.status === 'parked' && (!a.revisitAt || new Date(a.revisitAt) <= now)) parkedUntilPassed.add(id);
  }
  return {
    now,
    parkedUntilPassed,
    lastSection: opts.lastSection ?? null,
    warmUp: opts.warmUp ?? false,
    sectionOrder: bank.sectionOrder,
    bankIndex: new Map(bank.items.map((i, idx) => [i.id, idx])),
  };
}

function askable(bank, answers, opts) {
  const ctx = buildContext(bank, answers, opts);
  const pool = outstanding(bank, answers, { track: opts.track ?? 'form', forms: opts.forms ?? null }).filter((i) => {
    const a = answers[i.id];
    if (a?.status === 'parked') return ctx.parkedUntilPassed.has(i.id);
    return true;
  });
  return pool.sort((a, b) => score(a, ctx) - score(b, ctx));
}

// A whole session's worth of questions, for channels that send a block at a
// time (WhatsApp digest, email). Budget is questions or seconds.
export function nextBatch(bank, answers, plan = DEFAULT_PLAN, opts = {}) {
  const sorted = askable(bank, answers, { ...opts, warmUp: plan.warmUp && (opts.sessionNumber ?? 1) === 1 });
  const batch = [];
  let seconds = 0;
  for (const item of sorted) {
    const cost = item.secs ?? 30;
    if (plan.mode === 'count') {
      if (batch.length >= plan.size) break;
    } else if (seconds > 0 && seconds + cost > plan.size) {
      break;
    }
    batch.push(item);
    seconds += cost;
  }
  return { items: batch, estimatedSeconds: seconds };
}

// Turn-by-turn: what to ask next, given what this session has already used.
// Recomputed after every answer, which is how a follow-up appears the instant
// someone says "Yes".
export function nextItem(bank, answers, session = {}) {
  const plan = { ...DEFAULT_PLAN, ...(session.plan ?? {}) };
  const asked = session.asked ?? 0;
  const spent = session.spentSeconds ?? 0;
  const sorted = askable(bank, answers, {
    ...session,
    warmUp: plan.warmUp && (session.sessionNumber ?? 1) === 1 && asked === 0,
  });
  if (sorted.length === 0) return { item: null, sessionDone: true, formDone: true };

  const item = sorted[0];
  const overBudget =
    plan.mode === 'count' ? asked >= plan.size : spent >= plan.size;

  // An open follow-up always gets asked, even past the budget - it is one tap
  // and it stops the form looking answered when it is not.
  if (overBudget && !OVERFLOW_KINDS.has(item.kind)) {
    return { item: null, sessionDone: true, formDone: false, nextUp: item };
  }
  return { item, sessionDone: false, formDone: false };
}

// Honest estimate for the seller: "about 12 sessions left at 3 a day".
export function forecast(bank, answers, plan = DEFAULT_PLAN, cadencePerDay = 1, { forms = null } = {}) {
  const pool = outstanding(bank, answers, { track: 'form', forms });
  const seconds = pool.reduce((a, i) => a + (i.secs ?? 30), 0);
  const perSession = plan.mode === 'count'
    ? pool.slice(0, plan.size).reduce((a, i) => a + (i.secs ?? 30), 0) || 1
    : plan.size;
  const sessions = Math.ceil(seconds / perSession);
  return {
    questionsLeft: pool.length,
    secondsLeft: seconds,
    sessionsLeft: sessions,
    daysLeft: Math.ceil(sessions / Math.max(cadencePerDay, 0.1)),
  };
}

// What the seller still has to dig out of a drawer, as its own to-do list.
export function paperworkList(bank, answers, { forms = null } = {}) {
  return inForms(bank.items, forms)
    .filter((i) => i.track === 'paperwork' && isApplicable(i, answers))
    .map((i) => ({
      id: i.id,
      parent: i.parent,
      label: i.q,
      hint: i.hint,
      section: i.s,
      done: isAnswered(answers[i.id]),
    }));
}
