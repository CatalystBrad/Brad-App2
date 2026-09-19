// Loads the TA6 question bank and answers the only two questions that matter
// when you are drip-feeding a form: which questions apply right now, and in
// what order should they be asked.
// @node-only-start
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(here, '..', 'data');
// @node-only-end

// The forms this system knows. A case says which of them it is collecting.
export const FORMS = {
  ta6: { file: 'ta6-questions.json', title: 'Property Information (TA6)' },
  ta10: { file: 'ta10-questions.json', title: 'Fittings and Contents (TA10)' },
};
export const DEFAULT_FORMS = ['ta6'];

export const NEGATIVE_OPTIONS = new Set([
  'None of these',
  'None that I know of',
  'No, never',
  'None of these - it all goes to mains sewer',
  'No parking',
]);

/**
 * Loads one or more forms into a single bank. Question ids are unique across
 * forms, so the drip engine can hold a seller's whole pack at once.
 */
// @node-only-start
export function loadBank(forms = Object.keys(FORMS)) {
  const ids = Array.isArray(forms) ? forms : [forms];
  const loaded = ids.map((id) => {
    const spec = FORMS[id];
    if (!spec) throw new Error(`unknown form: ${id}`);
    return { id, ...JSON.parse(readFileSync(join(DATA_DIR, spec.file), 'utf8')) };
  });
  return buildBank(loaded, ids);
}
// @node-only-end

/** Builds a bank from already-loaded form JSON. Pure: runs in a browser too. */
export function buildBank(loaded, ids = loaded.map((f) => f.id)) {
  const sections = loaded.flatMap((f) => f.sections.map((s) => ({ ...s, form: f.id })));
  const questions = loaded.flatMap((f) => f.questions.map((q) => ({ ...q, form: f.id })));
  const bank = {
    forms: loaded.map((f) => ({ id: f.id, form: f.form, edition: f.edition, copyright: f.copyright })),
    form: loaded[0]?.form,
    edition: loaded[0]?.edition,
    sections,
    questions,
  };

  const items = [];
  for (const q of bank.questions) {
    items.push({ ...q, kind: 'question' });
    if (q.followUp) {
      items.push({
        id: `${q.id}::f`,
        parent: q.id,
        kind: 'followup',
        form: q.form,
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
        form: q.form,
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
  // Two forms sharing a question id would silently overwrite each other's
  // answers, so fail loudly at load rather than quietly at export.
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new Error(`duplicate question id "${item.id}" across forms ${ids.join(', ')} - ids must be unique bank-wide`);
    }
    seen.add(item.id);
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

/** Items belonging to the forms this case is actually collecting. */
export function inForms(items, forms) {
  if (!forms) return items;
  const wanted = new Set(Array.isArray(forms) ? forms : [forms]);
  return items.filter((i) => wanted.has(i.form));
}

export function outstanding(bank, answers, { track = 'form', forms = null } = {}) {
  return inForms(bank.items, forms).filter((i) => {
    if ((i.track ?? 'form') !== track) return false;
    if (isAnswered(answers[i.id])) return false;
    return isApplicable(i, answers);
  });
}

export function progress(bank, answers, { forms = null } = {}) {
  const scope = inForms(bank.items, forms);
  const applicable = scope.filter((i) => isApplicable(i, answers) && (i.track ?? 'form') === 'form');
  const answered = applicable.filter((i) => isAnswered(answers[i.id]));
  const paperwork = scope.filter((i) => i.track === 'paperwork' && isApplicable(i, answers));
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
