import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBank, isApplicable, outstanding, progress } from '../src/questions.js';

const bank = loadBank();

test('bank is internally consistent', () => {
  const ids = bank.items.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate item ids');
  for (const item of bank.items) {
    assert.ok(item.q, `${item.id} has no question text`);
    assert.ok(bank.sectionOrder.has(item.s), `${item.id} references unknown section ${item.s}`);
    for (const clause of [item.showIf, item.showIf?.and, item.showIf?.or].filter(Boolean)) {
      assert.ok(bank.byId.has(clause.q), `${item.id} depends on unknown question ${clause.q}`);
    }
  }
});

test('every section has at least one question', () => {
  for (const s of bank.sections) {
    assert.ok(bank.items.some((i) => i.s === s.id), `section ${s.id} is empty`);
  }
});

test('conditional questions are hidden until their parent is answered', () => {
  const solar = bank.byId.get('5.6b');
  assert.equal(isApplicable(solar, {}), false);
  assert.equal(isApplicable(solar, { '5.6': { value: 'No' } }), false);
  assert.equal(isApplicable(solar, { '5.6': { value: 'Yes' } }), true);
});

test('a seller with no alterations is asked far less', () => {
  const none = outstanding(bank, { '5.1': { value: ['None of these'] } }).length;
  const some = outstanding(bank, { '5.1': { value: ['Extension', 'Loft conversion'] } }).length;
  assert.ok(some > none, 'ticking work should add questions, not remove them');
});

test('notOnly ignores the negative option', () => {
  const detail = bank.byId.get('5.2a');
  assert.equal(isApplicable(detail, { '5.1': { value: ['None of these'] } }), false);
  assert.equal(isApplicable(detail, { '5.1': { value: ['Extension'] } }), true);
});

test('or clauses widen applicability', () => {
  const q = bank.byId.get('9.9');
  assert.equal(isApplicable(q, { '9.7': { value: 'No' }, '9.8': { value: 'No' } }), false);
  assert.equal(isApplicable(q, { '9.7': { value: 'No' }, '9.8': { value: 'Yes' } }), true);
  assert.equal(isApplicable(q, { '9.7': { value: 'Not known' }, '9.8': { value: 'No' } }), true);
});

test('follow-ups appear only when the trigger answer is given', () => {
  const fu = bank.byId.get('3.1::f');
  assert.ok(fu, 'expected a generated follow-up for 3.1');
  assert.equal(isApplicable(fu, { '3.1': { value: 'No' } }), false);
  assert.equal(isApplicable(fu, { '3.1': { value: 'Yes' } }), true);
});

test('evidence requests sit on a separate paperwork track', () => {
  const doc = bank.byId.get('2.5::doc');
  assert.equal(doc.track, 'paperwork');
  assert.equal(outstanding(bank, { '2.5': { value: 'Yes' } }, { track: 'form' }).some((i) => i.id === doc.id), false);
  assert.equal(outstanding(bank, { '2.5': { value: 'Yes' } }, { track: 'paperwork' }).some((i) => i.id === doc.id), true);
});

test('progress only counts questions that actually apply', () => {
  const answers = { '5.1': { value: ['None of these'] } };
  const p = progress(bank, answers);
  assert.equal(p.answered, 1);
  assert.ok(p.applicable < bank.items.length);
  assert.ok(p.percent > 0 && p.percent < 100);
  assert.ok(p.minutesLeft > 0);
});

test('a fully answered form reports 100 per cent', () => {
  const answers = {};
  for (let pass = 0; pass < 6; pass++) {
    for (const item of outstanding(bank, answers)) {
      answers[item.id] = { value: item.t === 'multi' ? [item.opts?.at(-1) ?? 'No'] : 'No' };
    }
  }
  const p = progress(bank, answers);
  assert.equal(p.percent, 100, `still outstanding: ${outstanding(bank, answers).map((i) => i.id).join(', ')}`);
});

test('forms can be loaded separately or together', () => {
  const ta6 = loadBank(['ta6']);
  const ta10 = loadBank(['ta10']);
  const both = loadBank(['ta6', 'ta10']);
  assert.equal(both.items.length, ta6.items.length + ta10.items.length);
  assert.ok(ta10.items.every((i) => i.form === 'ta10'));
  assert.equal(ta6.items.some((i) => i.form === 'ta10'), false);
  assert.throws(() => loadBank(['ta99']), /unknown form/);
});

test('a question id used by two forms is rejected at load, not discovered later', () => {
  // TA6 numbers its parking section 10.x; TA10 is numbered 10.x too. If the
  // ids were not namespaced, one form's answers would overwrite the other's.
  const both = loadBank(['ta6', 'ta10']);
  const ids = both.items.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(both.byId.get('10.1').form === 'ta6', 'TA6 keeps the bare 10.1');
  assert.ok(both.byId.get('fc.1').form === 'ta10', 'TA10 is namespaced');
});

test('a case collecting only TA6 is never asked a TA10 question', () => {
  const bank = loadBank(['ta6', 'ta10']);
  const ta6Only = outstanding(bank, {}, { forms: ['ta6'] });
  assert.equal(ta6Only.some((i) => i.form === 'ta10'), false);
  const both = outstanding(bank, {}, { forms: ['ta6', 'ta10'] });
  assert.ok(both.length > ta6Only.length);
});

test('every TA10 checklist row has a key and a label', () => {
  const bank = loadBank(['ta10']);
  for (const q of bank.questions.filter((x) => x.t === 'checklist')) {
    assert.ok(q.rows?.length, `${q.id} has no rows`);
    assert.equal(q.opts?.length, 3, `${q.id} should offer stays / taking / not there`);
    const keys = q.rows.map((r) => r.k);
    assert.equal(new Set(keys).size, keys.length, `${q.id} has duplicate row keys`);
    for (const r of q.rows) assert.ok(r.label, `${q.id} row ${r.k} has no label`);
  }
});
