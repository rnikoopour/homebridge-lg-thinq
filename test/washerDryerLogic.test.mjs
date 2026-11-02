// Unit tests for the pure washer/dryer logic (synthetic data only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const logic = require('../dist/devices/washerDryerLogic.js');
const { washerDryerView, isDeviceOnline, hasFault, isDoorLocked, initialTracker, nextFinishState } = logic;

/** Feed a sequence of updates ("STATE" or {state, remainTimeMinute}); report finished/started events. */
function run(updates, tracker = { inProgram: false, lastRemainingSeconds: 0 }) {
  const events = [];
  for (const update of updates) {
    const current = typeof update === 'string' ? { state: update } : update;
    const step = nextFinishState(tracker, current);
    tracker = step.tracker;
    if (step.finished) {
      events.push(`finished@${current.state}`);
    }
    if (step.started) {
      events.push(`started@${current.state}`);
    }
  }
  return { events, tracker };
}

const running = (minutes) => ({ state: 'RUNNING', remainTimeMinute: minutes });

test('view: off, running, paused, error', () => {
  assert.deepEqual(
    { ...washerDryerView({ state: 'POWEROFF', remainTimeHour: 1, remainTimeMinute: 5 }) },
    { powerOn: false, running: false, paused: false, error: false, remainingSeconds: 0, programSeconds: 0, tubCleanCount: 0, tubCleanDue: false });
  const running = washerDryerView({ state: 'RUNNING', remainTimeHour: 1, remainTimeMinute: 5 });
  assert.equal(running.powerOn, true);
  assert.equal(running.running, true);
  assert.equal(running.remainingSeconds, 3900);
  const paused = washerDryerView({ state: 'PAUSE', remainTimeMinute: 20 });
  assert.equal(paused.paused, true);
  assert.equal(paused.running, false);
  assert.equal(paused.remainingSeconds, 0);
  assert.equal(washerDryerView({ state: 'ERROR' }).error, true);
});

test('view: missing or partial data is treated as idle, not an error', () => {
  for (const data of [undefined, null, {}]) {
    const view = washerDryerView(data);
    assert.equal(view.running, false);
    assert.equal(view.error, false);
    assert.equal(view.remainingSeconds, 0);
  }
});

test('view: tub clean counter is capped at 30 and accepts LG strings', () => {
  assert.equal(washerDryerView({ TCLCount: '35' }).tubCleanCount, 30);
  assert.equal(washerDryerView({ TCLCount: '35' }).tubCleanDue, true);
  assert.equal(washerDryerView({ TCLCount: 12 }).tubCleanDue, false);
  assert.equal(washerDryerView({ TCLCount: 'n/a' }).tubCleanCount, 0);
});

test('online: live snapshot flag wins over the device-list flag', () => {
  assert.equal(isDeviceOnline({ online: true, snapshot: { online: false } }), false);
  assert.equal(isDeviceOnline({ online: false, snapshot: { online: true } }), true);
  assert.equal(isDeviceOnline({ online: false, snapshot: {} }), false);
  assert.equal(isDeviceOnline({ snapshot: null }), true);
});

test('fault: offline raises the fault but the machine still reads as off', () => {
  const view = washerDryerView({ state: 'POWEROFF' });
  assert.equal(hasFault(view, false), true);
  assert.equal(view.powerOn, false);
  assert.equal(hasFault(view, true), false);
  assert.equal(hasFault(washerDryerView({ state: 'ERROR' }), true), true);
});

test('door lock: model mapping when present, DOORLOCK_ON otherwise', () => {
  assert.equal(isDoorLocked({ doorLock: 'DOORLOCK_ON' }, null), true);
  assert.equal(isDoorLocked({ doorLock: 'LOCKED_VALUE' }, 'LOCKED_VALUE'), true);
  assert.equal(isDoorLocked({ doorLock: 'DOORLOCK_ON' }, 'LOCKED_VALUE'), false);
  assert.equal(isDoorLocked(undefined, null), false);
});

test('finish: a full wash cycle fires exactly once, at the end', () => {
  const { events } = run(['POWEROFF', 'INITIAL', running(40), { state: 'RINSING', remainTimeMinute: 20 }, running(2), 'END', 'END', 'POWEROFF']);
  assert.deepEqual(events, ['started@RUNNING', 'finished@END']);
});

test('finish: stopping or powering off mid-cycle is not a finish', () => {
  assert.deepEqual(run([running(30), 'POWEROFF']).events, ['started@RUNNING']);
  assert.deepEqual(run([running(30), 'POWERFAIL']).events, ['started@RUNNING']);
});

test('finish: cancelling mid-cycle (back to INITIAL) is not a finish', () => {
  assert.deepEqual(run([running(30), 'INITIAL', 'POWEROFF']).events, ['started@RUNNING']);
});

test('finish: an error mid-cycle is not a finish', () => {
  assert.deepEqual(run([running(30), 'ERROR']).events, ['started@RUNNING']);
});

test('finish: powering off with a minute or less left counts as finished (no END reported)', () => {
  assert.deepEqual(run([running(30), running(1), 'POWEROFF']).events, ['started@RUNNING', 'finished@POWEROFF']);
  assert.deepEqual(run([running(30), running(2), 'POWEROFF']).events, ['started@RUNNING']);
});

test('finish: pausing and resuming does not fire; stopping while paused does not either', () => {
  assert.deepEqual(run([running(30), 'PAUSE', 'PAUSE', running(29), 'END']).events, ['started@RUNNING', 'finished@END']);
  assert.deepEqual(run([running(30), 'PAUSE', 'POWEROFF']).events, ['started@RUNNING']);
});

test('finish: dryer cooldown counts as the end, without a second alert at END', () => {
  const { events } = run([{ state: 'DRYING', remainTimeMinute: 50 }, 'COOLDOWN', 'END', 'POWEROFF']);
  assert.deepEqual(events, ['started@DRYING', 'finished@COOLDOWN']);
});

// Sequences below use the state names from real LG washer/dryer models.
const drying = (minutes) => ({ state: 'DRYING', remainTimeMinute: minutes });

test('real dryer: COOLING is still the program; END fires once; wrinkle care afterwards does not re-trigger', () => {
  assert.deepEqual(run([drying(50), { state: 'COOLING', remainTimeMinute: 5 }, 'END', 'WRINKLECARE', 'WRINKLECARE', 'END', 'POWEROFF']).events,
    ['started@DRYING', 'finished@END']);
});

test('real dryer: wrinkle care without an END report counts as the finish', () => {
  assert.deepEqual(run([drying(50), { state: 'COOLING', remainTimeMinute: 3 }, 'WRINKLECARE', 'POWEROFF']).events,
    ['started@DRYING', 'finished@WRINKLECARE']);
});

test('real washer: a delayed start is not running until it starts', () => {
  const view = washerDryerView({ state: 'RESERVED', remainTimeHour: 2 });
  assert.equal(view.powerOn, true);
  assert.equal(view.running, false);
  assert.deepEqual(run(['RESERVED', 'RESERVED', 'DETECTING', running(55), 'END']).events, ['started@DETECTING', 'finished@END']);
});

test('real washer: freeze prevention is not a program and never alerts', () => {
  assert.deepEqual(run(['POWEROFF', 'FROZEN_PREVENT_INITIAL', 'FROZEN_PREVENT_RUNNING', 'FROZEN_PREVENT_PAUSE', 'POWEROFF']).events, []);
});

test('real washer: rinse hold and auto door-open pause are pauses, not stops', () => {
  assert.deepEqual(run([running(40), { state: 'RINSING', remainTimeMinute: 20 }, 'RINSEHOLD', 'POWEROFF']).events, ['started@RUNNING']);
  assert.deepEqual(run([running(40), 'RINSEHOLD', { state: 'SPINNING', remainTimeMinute: 8 }, 'AUTO_DT_OPEN_PAUSE', 'END']).events,
    ['started@RUNNING', 'finished@END']);
});

test('real washer: refresh tumbling after END does not re-trigger; auto-off error is an error, not a finish', () => {
  assert.deepEqual(run([running(40), 'END', 'REFRESHING', 'REFRESHING', 'POWEROFF']).events, ['started@RUNNING', 'finished@END']);
  assert.deepEqual(run([running(40), 'ERROR_AUTO_OFF']).events, ['started@RUNNING']);
  assert.equal(washerDryerView({ state: 'ERROR_AUTO_OFF' }).error, true);
});

test('finish: back-to-back programs each fire once', () => {
  const { events } = run([running(30), 'END', running(30), 'END']);
  assert.deepEqual(events, ['started@RUNNING', 'finished@END', 'started@RUNNING', 'finished@END']);
});

test('finish: restart mid-program still reports the finish', () => {
  const tracker = initialTracker(running(30));
  assert.equal(tracker.inProgram, true);
  assert.deepEqual(run([running(29), 'END'], tracker).events, ['finished@END']);
});

test('finish: restart while paused still reports the finish', () => {
  assert.deepEqual(run([running(10), 'END'], initialTracker({ state: 'PAUSE' })).events, ['finished@END']);
});

test('finish: restart after the program ended does not fire a stale alert', () => {
  const tracker = initialTracker({ state: 'END' });
  assert.equal(tracker.inProgram, false);
  assert.deepEqual(run(['END', 'END', 'POWEROFF'], tracker).events, []);
});

test('finish: an idle machine never fires', () => {
  assert.deepEqual(run(['POWEROFF', 'INITIAL', 'POWEROFF']).events, []);
});

test('view: program length from LG\'s initial time, never shorter than the time left', () => {
  assert.equal(washerDryerView({ state: 'RUNNING', initialTimeHour: 1, initialTimeMinute: 10, remainTimeMinute: 40 }).programSeconds, 4200);
  assert.equal(washerDryerView({ state: 'RINSING', remainTimeMinute: 24 }).programSeconds, 1440);
  assert.equal(washerDryerView({ state: 'POWEROFF', initialTimeHour: 1 }).programSeconds, 0);
});
