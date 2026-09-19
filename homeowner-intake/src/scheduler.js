// When to ask. The seller sets this once and can change it from any message;
// nothing is ever sent outside the window they chose.
export const DEFAULT_CADENCE = {
  frequency: 'daily',                     // twice_daily | daily | weekdays | every_other_day | weekly
  window: { start: '18:00', end: '21:00' },
  tz: 'Europe/London',
  channel: 'whatsapp',                    // whatsapp | sms | email | web_only
  pauseUntil: null,                       // "on holiday, leave me alone until..."
};

const FREQUENCY_HOURS = {
  twice_daily: 8,
  daily: 22,
  weekdays: 22,
  every_other_day: 46,
  weekly: 166,
};

// Escalation ladder: a channel that is being ignored is swapped, not spammed.
export const ESCALATION = ['whatsapp', 'sms', 'email', 'call_from_solicitor'];

function zonedParts(date, tz) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour % 24, minute: +p.minute, second: +p.second,
    weekday: p.weekday,
  };
}

function tzOffsetMs(date, tz) {
  const p = zonedParts(date, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime();
}

// "18:00 on 4 May, London time" -> a real instant, DST included.
function zonedToUtc(y, m, d, hh, mm, tz) {
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  let ts = naive;
  for (let i = 0; i < 2; i++) ts = naive - tzOffsetMs(new Date(ts), tz);
  return new Date(ts);
}

const parseHm = (s) => { const [h, m] = s.split(':').map(Number); return { h, m }; };

export function isWithinWindow(now, cadence = DEFAULT_CADENCE) {
  const { window, tz } = { ...DEFAULT_CADENCE, ...cadence };
  const p = zonedParts(now, tz);
  const start = parseHm(window.start);
  const end = parseHm(window.end);
  const mins = p.hour * 60 + p.minute;
  const s = start.h * 60 + start.m;
  const e = end.h * 60 + end.m;
  return s <= e ? mins >= s && mins <= e : mins >= s || mins <= e; // handles a window over midnight
}

// The next moment inside the seller's chosen window, at or after `from`.
export function nextWindowOpening(from, cadence = DEFAULT_CADENCE) {
  const c = { ...DEFAULT_CADENCE, ...cadence };
  const start = parseHm(c.window.start);
  // Already inside the window: now is the moment, not tomorrow's opening.
  if (isWithinWindow(from, c) && !(c.frequency === 'weekdays' && ['Sat', 'Sun'].includes(zonedParts(from, c.tz).weekday))) {
    return from;
  }
  for (let dayOffset = 0; dayOffset <= 14; dayOffset++) {
    const probe = new Date(from.getTime() + dayOffset * 86400000);
    const p = zonedParts(probe, c.tz);
    const opening = zonedToUtc(p.year, p.month, p.day, start.h, start.m, c.tz);
    if (opening < from) continue;
    if (c.frequency === 'weekdays') {
      const wd = zonedParts(opening, c.tz).weekday;
      if (wd === 'Sat' || wd === 'Sun') continue;
    }
    return opening;
  }
  return new Date(from.getTime() + 86400000);
}

/**
 * Decide when to next reach out, and how.
 * Ignoring nudges slows the drip and changes channel rather than repeating it.
 */
export function planNextNudge(cadence, state = {}) {
  const c = { ...DEFAULT_CADENCE, ...cadence };
  const now = state.now ?? new Date();
  const ignoredStreak = state.ignoredStreak ?? 0;

  if (state.formComplete) return { send: false, reason: 'form_complete' };

  if (c.pauseUntil && new Date(c.pauseUntil) > now) {
    return { send: true, at: nextWindowOpening(new Date(c.pauseUntil), c), channel: c.channel, reason: 'paused_by_seller' };
  }

  const baseHours = FREQUENCY_HOURS[c.frequency] ?? 22;
  // Back off, but never past a week - and ignore the backoff entirely if the
  // exchange deadline is close.
  const backoff = Math.min(1 + ignoredStreak * 0.6, 3.5);
  const anchor = new Date(Math.max(
    new Date(state.lastActivityAt ?? 0).getTime(),
    new Date(state.lastNudgeAt ?? 0).getTime(),
  ) || now.getTime());

  let hours = baseHours * backoff;
  let reason = ignoredStreak > 0 ? `backoff_x${backoff.toFixed(1)}` : 'cadence';

  if (state.deadline) {
    const daysLeft = (new Date(state.deadline) - now) / 86400000;
    const sessionsLeft = state.sessionsLeft ?? 1;
    if (daysLeft > 0 && sessionsLeft > daysLeft) {
      hours = Math.max(6, (daysLeft * 24) / sessionsLeft); // compress to fit
      reason = 'deadline_compression';
    }
  }

  const earliest = new Date(anchor.getTime() + hours * 3600000);
  const at = nextWindowOpening(earliest > now ? earliest : now, c);

  const channel = ignoredStreak >= 3
    ? ESCALATION[Math.min(ESCALATION.indexOf(c.channel) + Math.floor(ignoredStreak / 3), ESCALATION.length - 1)]
    : c.channel;

  return {
    send: true,
    at,
    channel,
    escalated: channel !== c.channel,
    handOffToHuman: channel === 'call_from_solicitor',
    reason,
  };
}

// WhatsApp only allows free-form messages for 24 hours after the customer's
// last message. Outside that, an approved template has to open the thread.
export function whatsAppSendMode(lastInboundAt, now = new Date()) {
  if (!lastInboundAt) return 'template';
  const hours = (now - new Date(lastInboundAt)) / 3600000;
  return hours < 24 ? 'free_form' : 'template';
}
