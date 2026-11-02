// Unit tests for the pure washer/dryer logic (synthetic data only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const logic = require('../dist/devices/washerDryerLogic.js');
const { washerDryerView, isDeviceOnline, hasFault, isDoorLocked, initialInProgram, nextFinishState } = logic;

/** Feed a sequence of states; return which ones fired "finished" / "started". */
function run(states, inProgram = false) {
  const events = [];
  for (const state of states) {
    const step = nextFinishState(inProgram, { state });
    inProgram = step.inProgram;
    if (step.finished) {
      events.push(`finished@${state}`);
    }
    if (step.started) {
      events.push(`started@${state}`);
    }
  }
  return { events, inProgram };
}

test('view: off, running, paused, error', () => {
  assert.deepEqual(
    { ...washerDryerView({ state: 'POWEROFF', remainTimeHour: 1, remainTimeMinute: 5 }) },
    { powerOn: false, running: false, paused: false, error: false, remainingSeconds: 0, tubCleanCount: 0, tubCleanDue: false });
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
  const { events } = run(['POWEROFF', 'INITIAL', 'RUNNING', 'RINSING', 'SPINNING', 'END', 'END', 'POWEROFF']);
  assert.deepEqual(events, ['started@RUNNING', 'finished@END']);
});

test('finish: pausing and resuming does not fire', () => {
  const { events } = run(['RUNNING', 'PAUSE', 'PAUSE', 'RUNNING', 'END']);
  assert.deepEqual(events, ['started@RUNNING', 'finished@END']);
});

test('finish: dryer cooldown counts as the end, without a second alert at END', () => {
  const { events } = run(['DRYING', 'COOLDOWN', 'END', 'POWEROFF']);
  assert.deepEqual(events, ['started@DRYING', 'finished@COOLDOWN']);
});

test('finish: back-to-back programs each fire once', () => {
  const { events } = run(['RUNNING', 'END', 'RUNNING', 'END']);
  assert.deepEqual(events, ['started@RUNNING', 'finished@END', 'started@RUNNING', 'finished@END']);
});

test('finish: restart mid-program still reports the finish', () => {
  const inProgram = initialInProgram({ state: 'RUNNING' });
  assert.equal(inProgram, true);
  assert.deepEqual(run(['RUNNING', 'END'], inProgram).events, ['finished@END']);
});

test('finish: restart while paused still reports the finish', () => {
  assert.deepEqual(run(['PAUSE', 'RUNNING', 'END'], initialInProgram({ state: 'PAUSE' })).events, ['finished@END']);
});

test('finish: restart after the program ended does not fire a stale alert', () => {
  const inProgram = initialInProgram({ state: 'END' });
  assert.equal(inProgram, false);
  assert.deepEqual(run(['END', 'END', 'POWEROFF'], inProgram).events, []);
});

test('finish: an idle machine never fires', () => {
  assert.deepEqual(run(['POWEROFF', 'INITIAL', 'POWEROFF']).events, []);
});
