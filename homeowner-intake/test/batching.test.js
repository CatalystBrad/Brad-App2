import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBank } from '../src/questions.js';
import { nextBatch, nextItem, forecast, paperworkList, DEFAULT_PLAN } from '../src/batching.js';

const bank = loadBank();

test('a batch respects a question count', () => {
  const { items } = nextBatch(bank, {}, { mode: 'count', size: 3 });
  assert.equal(items.length, 3);
});

test('a batch respects a time budget', () => {
  const { items, estimatedSeconds } = nextBatch(bank, {}, { mode: 'time', size: 120 });
  assert.ok(estimatedSeconds <= 120 + (items.at(-1)?.secs ?? 0), 'should not wildly overrun the budget');
  assert.ok(items.length >= 1);
});

test('the first batch opens with quick one-tap confirmations', () => {
  const { items } = nextBatch(bank, {}, { ...DEFAULT_PLAN, size: 3 }, { sessionNumber: 1 });
  assert.ok(items.some((i) => i.confirmable), 'warm-up should include a confirmable question');
  assert.ok(items.every((i) => (i.secs ?? 0) <= 60), 'warm-up should not lead with a long one');
});

test('answered questions are never asked again', () => {
  const first = nextBatch(bank, {}, { mode: 'count', size: 3 }).items;
  const answers = Object.fromEntries(first.map((i) => [i.id, { value: 'No' }]));
  const second = nextBatch(bank, answers, { mode: 'count', size: 3 }).items;
  assert.equal(second.some((i) => answers[i.id]), false);
});

test('a follow-up is asked immediately, even past the session budget', () => {
  const answers = { '3.1': { value: 'Yes' } };
  const step = nextItem(bank, answers, { plan: { mode: 'count', size: 1 }, asked: 5 });
  assert.equal(step.item?.id, '3.1::f', 'an unanswered follow-up must not be left dangling');
  assert.equal(step.sessionDone, false);
});

test('the session ends when the budget is spent', () => {
  const step = nextItem(bank, {}, { plan: { mode: 'count', size: 3 }, asked: 3 });
  assert.equal(step.sessionDone, true);
  assert.equal(step.formDone, false);
  assert.ok(step.nextUp, 'should say what is queued up next');
});

test('parked questions come back only once their revisit date passes', () => {
  const soon = new Date(Date.now() + 86400000).toISOString();
  const answers = { '3.1': { status: 'parked', revisitAt: soon } };
  const hidden = nextBatch(bank, answers, { mode: 'count', size: 40 }, { now: new Date() }).items;
  assert.equal(hidden.some((i) => i.id === '3.1'), false);

  const later = new Date(Date.now() + 2 * 86400000);
  const back = nextBatch(bank, answers, { mode: 'count', size: 40 }, { now: later }).items;
  assert.equal(back[0].id, '3.1', 'a parked question should come back at the top of the pile');
});

test('questions stay grouped by topic where possible', () => {
  const answers = {};
  const { items } = nextBatch(bank, answers, { mode: 'count', size: 4 }, { lastSection: 'boundaries', sessionNumber: 2 });
  assert.ok(items.filter((i) => i.s === 'boundaries').length >= 3, 'should stay in the section the seller was in');
});

test('the forecast is honest about how long this will take', () => {
  const f = forecast(bank, {}, { mode: 'count', size: 3 }, 1);
  assert.ok(f.sessionsLeft > 5 && f.sessionsLeft < 60, `implausible forecast: ${f.sessionsLeft}`);
  assert.equal(f.daysLeft, f.sessionsLeft);
  const twiceDaily = forecast(bank, {}, { mode: 'count', size: 3 }, 2);
  assert.ok(twiceDaily.daysLeft < f.daysLeft);
});

test('paperwork is a separate to-do list', () => {
  const list = paperworkList(bank, { '2.5': { value: 'Yes' }, '6.1': { value: ['Damp proofing'] } });
  assert.ok(list.length >= 2);
  assert.ok(list.every((i) => i.label && i.parent));
  assert.equal(list.some((i) => i.done), false);
});
