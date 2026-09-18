import test from 'node:test';
import assert from 'node:assert/strict';
import { planNextNudge, isWithinWindow, nextWindowOpening, whatsAppSendMode, DEFAULT_CADENCE } from '../src/scheduler.js';

const evenings = { ...DEFAULT_CADENCE, window: { start: '18:00', end: '21:00' }, tz: 'Europe/London' };

test('quiet hours are respected', () => {
  assert.equal(isWithinWindow(new Date('2026-06-10T19:00:00Z'), evenings), true);   // 20:00 BST
  assert.equal(isWithinWindow(new Date('2026-06-10T08:00:00Z'), evenings), false);  // 09:00 BST
  assert.equal(isWithinWindow(new Date('2026-06-10T22:30:00Z'), evenings), false);  // 23:30 BST
});

test('British Summer Time is handled, not fudged', () => {
  const summer = nextWindowOpening(new Date('2026-06-10T06:00:00Z'), evenings);
  assert.equal(summer.toISOString(), '2026-06-10T17:00:00.000Z', 'BST is UTC+1, so 18:00 local is 17:00Z');
  const winter = nextWindowOpening(new Date('2026-01-10T06:00:00Z'), evenings);
  assert.equal(winter.toISOString(), '2026-01-10T18:00:00.000Z', 'GMT is UTC, so 18:00 local is 18:00Z');
});

test('a window that has closed rolls to tomorrow', () => {
  const at = nextWindowOpening(new Date('2026-06-10T21:00:00Z'), evenings); // 22:00 BST, closed
  assert.equal(at.toISOString(), '2026-06-11T17:00:00.000Z');
});

test('weekday-only cadence skips the weekend', () => {
  const cadence = { ...evenings, frequency: 'weekdays' };
  const saturday = new Date('2026-06-13T06:00:00Z');
  const at = nextWindowOpening(saturday, cadence);
  assert.equal(at.getUTCDay(), 1, 'should land on Monday');
});

test('nothing is sent once the form is complete', () => {
  const plan = planNextNudge(evenings, { formComplete: true });
  assert.equal(plan.send, false);
  assert.equal(plan.reason, 'form_complete');
});

test('being ignored slows the drip rather than repeating it', () => {
  const now = new Date('2026-06-10T19:00:00Z');
  const base = planNextNudge(evenings, { now, lastNudgeAt: now.toISOString(), ignoredStreak: 0 });
  const ignored = planNextNudge(evenings, { now, lastNudgeAt: now.toISOString(), ignoredStreak: 2 });
  assert.ok(ignored.at > base.at, 'a silent seller should be chased less often, not more');
  assert.match(ignored.reason, /^backoff/);
});

test('after three ignored nudges the channel changes, then a human is asked to ring', () => {
  const now = new Date('2026-06-10T19:00:00Z');
  const escalated = planNextNudge(evenings, { now, ignoredStreak: 3 });
  assert.equal(escalated.channel, 'sms');
  assert.equal(escalated.escalated, true);
  const giveUp = planNextNudge(evenings, { now, ignoredStreak: 9 });
  assert.equal(giveUp.channel, 'call_from_solicitor');
  assert.equal(giveUp.handOffToHuman, true);
});

test('a looming deadline compresses the schedule', () => {
  const now = new Date('2026-06-10T19:00:00Z');
  const relaxed = planNextNudge(evenings, { now, lastNudgeAt: now.toISOString() });
  const urgent = planNextNudge(evenings, {
    now, lastNudgeAt: now.toISOString(),
    deadline: new Date('2026-06-14T00:00:00Z').toISOString(), sessionsLeft: 12,
  });
  assert.equal(urgent.reason, 'deadline_compression');
  assert.ok(urgent.at <= relaxed.at);
});

test('a seller who asked for peace gets it', () => {
  const now = new Date('2026-06-10T19:00:00Z');
  const paused = planNextNudge({ ...evenings, pauseUntil: '2026-06-20T00:00:00Z' }, { now });
  assert.equal(paused.reason, 'paused_by_seller');
  assert.ok(paused.at >= new Date('2026-06-20T00:00:00Z'));
});

test('the WhatsApp 24-hour window decides template vs free text', () => {
  const now = new Date('2026-06-10T19:00:00Z');
  assert.equal(whatsAppSendMode(null, now), 'template');
  assert.equal(whatsAppSendMode('2026-06-10T10:00:00Z', now), 'free_form');
  assert.equal(whatsAppSendMode('2026-06-08T10:00:00Z', now), 'template');
});
