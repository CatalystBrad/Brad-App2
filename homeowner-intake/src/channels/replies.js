// How a seller's reply is understood, independent of which channel it arrived
// on. WhatsApp taps, SMS numbers and typed words all land here.

export const PARK_TITLE = "I'll check";
// A pre-filled answer is a yes/no confirmation whatever the underlying field
// type: the whole point is that it costs one tap.
export const CONFIRM_YES = "That's right";
export const CONFIRM_NO = 'Not quite';

export const HELP_HINT = 'Reply MENU to change how often I ask, PAUSE to stop for a bit, or HELP.';

export const COMMANDS = {
  MENU: 'menu', SETTINGS: 'menu',
  PAUSE: 'pause', SNOOZE: 'pause',
  SKIP: 'park', LATER: 'park', "I'LL CHECK": 'park', 'ILL CHECK': 'park',
  'DONT KNOW': 'unknown', "DON'T KNOW": 'unknown', DK: 'unknown',
  HELP: 'help',
  MORE: 'more', GO: 'more', NEXT: 'more',
  // The regulated opt-out words. STOP must always mean stop, never "skip".
  STOP: 'optout', STOPALL: 'optout', UNSUBSCRIBE: 'optout', END: 'optout', QUIT: 'optout',
};

// The menu offers these in plain English, so they have to actually work. None
// of them is a valid answer to any question on the forms, so they are safe to
// read as commands wherever they appear.
export const CADENCE_WORDS = {
  MORNINGS: { window: { start: '07:30', end: '09:00' } },
  MORNING: { window: { start: '07:30', end: '09:00' } },
  LUNCHTIME: { window: { start: '12:00', end: '14:00' } },
  LUNCH: { window: { start: '12:00', end: '14:00' } },
  EVENINGS: { window: { start: '18:00', end: '21:00' } },
  EVENING: { window: { start: '18:00', end: '21:00' } },
  DAILY: { frequency: 'daily' },
  WEEKLY: { frequency: 'weekly' },
  WEEKDAYS: { frequency: 'weekdays' },
  'EVERY OTHER DAY': { frequency: 'every_other_day' },
  'TWICE A DAY': { frequency: 'twice_daily' },
  'TWICE DAILY': { frequency: 'twice_daily' },
};

export function describeCadence(cadence) {
  const how = String(cadence.frequency).replace(/_/g, ' ');
  return `${how}, between ${cadence.window.start} and ${cadence.window.end}`;
}

export function formatPrefill(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return Object.values(value).filter(Boolean).join(', ');
  return String(value);
}

/** The options a seller can choose from, as the channel should present them. */
export function optionsFor(item, { includePark = true } = {}) {
  if (item.t === 'yesno') return includePark ? ['Yes', 'No', PARK_TITLE] : ['Yes', 'No'];
  if (item.t === 'choice' && item.opts) return item.opts;
  if (item.t === 'multi' && item.opts) return item.opts;
  return [];
}

/**
 * Interprets a free-text reply in the context of the question that was asked.
 * Returns an action the caller applies - never guesses a legal answer from
 * something ambiguous, because a wrong answer on a property form is a claim
 * waiting to happen.
 */
export function interpretText(text, askedItem, { afterMenu = false } = {}) {
  const raw = String(text ?? '').trim();
  const upper = raw.toUpperCase().replace(/\s+/g, ' ');
  if (COMMANDS[upper]) return { action: COMMANDS[upper] };
  if (CADENCE_WORDS[upper]) return { action: 'set_cadence', cadence: CADENCE_WORDS[upper] };

  // Straight after the menu, a bare number means "ask me this many at a time",
  // not an answer to whatever question happened to be open.
  if (afterMenu) {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= 10) return { action: 'set_size', size: n };
  }

  if (!askedItem) return { action: 'unrecognised' };

  const CONFIRM_WORDS = ['CORRECT', 'THATS RIGHT', "THAT'S RIGHT", 'RIGHT', 'CONFIRM', 'CONFIRMED'];
  if (askedItem.confirmable && CONFIRM_WORDS.includes(upper)) return { action: 'confirm' };

  if (askedItem.t === 'yesno' || askedItem.t === 'choice') {
    const opts = askedItem.t === 'yesno' ? ['Yes', 'No'] : askedItem.opts ?? [];
    const exact = opts.find((o) => o.toUpperCase() === upper);
    if (exact) return { action: 'answer', value: exact };
    if (['Y', 'YEAH', 'YEP', 'YES PLEASE'].includes(upper)) return { action: 'answer', value: 'Yes' };
    if (['N', 'NO THANKS', 'NOPE'].includes(upper)) return { action: 'answer', value: 'No' };
    if (['NOT KNOWN', 'NOT SURE', 'NO IDEA', 'UNSURE'].includes(upper)) {
      const nk = opts.find((o) => o.toUpperCase().startsWith('NOT KNOWN'));
      return nk ? { action: 'answer', value: nk } : { action: 'unknown' };
    }
    // A number, if they replied "2" to a numbered list.
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= opts.length) return { action: 'answer', value: opts[n - 1] };
    return { action: 'clarify', options: opts };
  }

  // Only where "Yes" is not one of the form's own options - otherwise it is an
  // answer, not a confirmation, and guessing wrong puts the wrong thing on a
  // legal document.
  if (askedItem.confirmable && ['Y', 'YES'].includes(upper)) return { action: 'confirm' };

  if (['text', 'longtext', 'address', 'year', 'date', 'year_or_unknown', 'date_or_unknown', 'month_year_or_unknown'].includes(askedItem.t)) {
    if (raw.length === 0) return { action: 'clarify' };
    return { action: 'answer', value: raw };
  }
  return { action: 'web_handoff' };
}

export function clarifyMessage(options = []) {
  if (options.length === 0) return 'Sorry, I did not follow that. Could you put it another way? Reply HELP if you want a hand.';
  return `Sorry - I need one of these so it goes on the form correctly:\n${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}\n\nOr reply SKIP and I will come back to it.`;
}

export const menuMessage = (cadence, plan) =>
  `How I am asking at the moment:\n· ${plan.mode === 'count' ? `${plan.size} questions` : `${Math.round(plan.size / 60)} minutes`} at a time\n· ${String(cadence.frequency).replace(/_/g, ' ')}, between ${cadence.window.start} and ${cadence.window.end}\n\nReply with:\n· a number (1-10) to change how many questions\n· MORNINGS, LUNCHTIME or EVENINGS to change the time\n· DAILY, WEEKLY or EVERY OTHER DAY\n· PAUSE to stop for a week\n· MORE to carry on now`;

export const SIGN_OFFS = [
  'That is you done for now - thank you. I will come back with a couple more.',
  'Great, that is another one off the list. Speak soon.',
  'Done for today. Every answer moves the sale forward.',
];
