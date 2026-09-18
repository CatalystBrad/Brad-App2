// Loads the TA6 question bank and answers the only two questions that matter
// when you are drip-feeding a form: which questions apply right now, and in
// what order should they be asked.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const BANK_PATH = join(here, '..', 'data', 'ta6-questions.json');

export const NEGATIVE_OPTIONS = new Set([
  'None of these',
  'None that I know of',
  'No, never',
  'None of these - it all goes to mains sewer',
  'No parking',
]);

export function loadBank(path = BANK_PATH) {
  const bank = JSON.parse(readFileSync(path, 'utf8'));
  const items = [];
  for (const q of bank.questions) {
    items.push({ ...q, kind: 'question' });
    if (q.followUp) {
      items.push({
        id: `${q.id}::f`,
        parent: q.id,
        kind: 'followup',
        n: q.n,
        s: q.s,
        t: q.followUp.t,
        q: q.followUp.q,
        opts: q.followUp.opts,
        secs: q.followUp.secs ?? 60,
        help: q.followUp.help,
        showIf: { q: q.id, matches: q.followUp.when },
      });
    }
    if (q.evidence) {
      items.push({
        id: `${q.id}::doc`,
        parent: q.id,
        kind: 'evidence',
        n: q.n,
        s: q.s,
        t: 'upload',
        q: q.evidence.label,
        hint: q.evidence.hint,
        // Paperwork is a separate track: chasing a certificate should never
        // block the next question.
        track: 'paperwork',
        secs: 120,
        showIf: q.evidence.when === 'always' ? { q: q.id, answered: true } : { q: q.id, matches: q.evidence.when },
      });
    }
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  const sectionOrder = new Map(bank.sections.map((s, i) => [s.id, i]));
  return { ...bank, items, byId, sectionOrder };
}

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

function matchesWhen(answer, when) {
  if (answer == null) return false;
  const given = asArray(answer.value ?? answer);
  if (when === 'always') return true;
  if (when === 'any') return given.some((v) => !NEGATIVE_OPTIONS.has(v));
  return asArray(when).some((w) => given.includes(w));
}

// Evaluates a showIf clause. Clauses are deliberately small and declarative so
// a non-developer can read the question bank and see why something was asked.
export function isApplicable(item, answers) {
  const clause = item.showIf;
  if (!clause) return true;
  return evalClause(clause, answers);
}

function evalClause(clause, answers) {
  const answer = answers[clause.q];
  const given = answer == null ? [] : asArray(answer.value ?? answer);
  let result;

  if ('answered' in clause) result = clause.answered === (given.length > 0);
  else if ('matches' in clause) result = matchesWhen(answer, clause.matches);
  else if ('is' in clause) result = given.includes(clause.is);
  else if ('isNot' in clause) result = given.length > 0 && !given.includes(clause.isNot);
  else if ('includes' in clause) result = given.includes(clause.includes);
  else if ('includesAny' in clause) result = clause.includesAny.some((o) => given.includes(o));
  else if ('notOnly' in clause) result = given.length > 0 && given.some((v) => v !== clause.notOnly);
  else result = true;

  if (clause.and) result = result && evalClause(clause.and, answers);
  if (clause.or) result = result || evalClause(clause.or, answers);
  return result;
}

// Questions that cannot be asked yet because the answer they depend on is
// still missing. Used to avoid reporting a form as "stuck" when it is simply
// waiting on a parent answer.
export function isBlocked(item, answers) {
  const clause = item.showIf;
  if (!clause) return false;
  for (const c of [clause, clause.and, clause.or].filter(Boolean)) {
    if (answers[c.q] == null) return true;
  }
  return false;
}

// "I'll check that one" is a promise to come back, not an answer: a parked
// question is still outstanding, and still counts against the form being done.
export function isAnswered(answer) {
  if (answer == null) return false;
  // 'parked' is a promise to come back; 'prefilled' is our guess from public
  // data. Neither is something the seller has stood behind.
  return answer.status !== 'parked' && answer.status !== 'prefilled';
}

export function outstanding(bank, answers, { track = 'form' } = {}) {
  return bank.items.filter((i) => {
    if ((i.track ?? 'form') !== track) return false;
    if (isAnswered(answers[i.id])) return false;
    return isApplicable(i, answers);
  });
}

export function progress(bank, answers) {
  const applicable = bank.items.filter((i) => isApplicable(i, answers) && (i.track ?? 'form') === 'form');
  const answered = applicable.filter((i) => isAnswered(answers[i.id]));
  const paperwork = bank.items.filter((i) => i.track === 'paperwork' && isApplicable(i, answers));
  const secondsLeft = applicable
    .filter((i) => !isAnswered(answers[i.id]))
    .reduce((a, i) => a + (i.secs ?? 30), 0);
  return {
    answered: answered.length,
    applicable: applicable.length,
    percent: applicable.length === 0 ? 0 : Math.round((answered.length / applicable.length) * 100),
    secondsLeft,
    minutesLeft: Math.ceil(secondsLeft / 60),
    parked: applicable.filter((i) => answers[i.id]?.status === 'parked').length,
    toConfirm: applicable.filter((i) => answers[i.id]?.status === 'prefilled').length,
    paperworkOutstanding: paperwork.filter((i) => !isAnswered(answers[i.id])).length,
    paperworkTotal: paperwork.length,
  };
}

// Questions a seller has explicitly parked ("I'll check that one") come back
// round rather than being lost.
export function isParked(answer) {
  return answer != null && answer.status === 'parked';
}
