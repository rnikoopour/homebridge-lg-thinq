// Unit tests for the pure dishwasher logic and the shared program tracking (synthetic data only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { dishwasherProgramStatus, initialDishwasherTracker, nextDishwasherStep, dishwasherView, rinseLevelFor, rinseLevelPercent } =
  require('../dist/devices/dishwasherLogic.js');

function run(updates, tracker = { inProgram: false, lastRemainingSeconds: 0 }, values) {
  const events = [];
  for (const update of updates) {
    const data = typeof update === 'string' ? { state: update } : update;
    const step = nextDishwasherStep(tracker, data, values);
    tracker = step.tracker;
    if (step.finished) {
      events.push(`finished@${data.state}`);
    }
    if (step.started) {
      events.push(`started@${data.state}`);
    }
  }
  return events;
}

const running = (minutes, process = 'WASHING') => ({ state: 'RUNNING', process, remainTimeHour: 0, remainTimeMinute: minutes });

test('dishwasher status: STANDBY and missing state count as off', () => {
  assert.equal(dishwasherProgramStatus({ state: 'STANDBY' }).powerOn, false);
  assert.equal(dishwasherProgramStatus({}).running, false);
  assert.equal(dishwasherProgramStatus(null).powerOn, false);
  assert.equal(dishwasherProgramStatus(running(90)).remainingSeconds, 5400);
});

test('dishwasher: a full program fires once at END, through rinse and dry phases', () => {
  assert.deepEqual(run(['INITIAL', running(120), running(60, 'RINSING'), running(20, 'DRYING'), 'END', 'END', 'POWEROFF']),
    ['started@RUNNING', 'finished@END']);
});

test('dishwasher: stopping, cancelling or a power cut mid-program does not fire', () => {
  assert.deepEqual(run([running(90), 'POWEROFF']), ['started@RUNNING']);
  assert.deepEqual(run([running(90), 'INITIAL']), ['started@RUNNING']);
  assert.deepEqual(run([running(90), 'POWERFAIL']), ['started@RUNNING']);
});

test('dishwasher: pause/resume does not fire; power-off with a minute or less left does', () => {
  assert.deepEqual(run([running(90), 'PAUSE', running(80), 'END']), ['started@RUNNING', 'finished@END']);
  assert.deepEqual(run([running(90), running(1), 'POWEROFF']), ['started@RUNNING', 'finished@POWEROFF']);
});

test('dishwasher: restart mid-program reports the finish; restart after it does not', () => {
  assert.deepEqual(run([running(30), 'END'], initialDishwasherTracker(running(31))), ['finished@END']);
  assert.deepEqual(run(['END', 'POWEROFF'], initialDishwasherTracker({ state: 'END' })), []);
});

test('dishwasher: uses the model-specific state values when they differ', () => {
  const values = { running: 'DW_RUN', paused: 'DW_PAUSE', completed: 'DW_DONE' };
  assert.deepEqual(run([{ state: 'DW_RUN', remainTimeMinute: 50 }, 'DW_PAUSE', 'DW_DONE'], undefined, values),
    ['started@DW_RUN', 'finished@DW_DONE']);
});

const view = (data, lastRinseLevel = 'LEVEL_2') => dishwasherView(data, { lastRinseLevel });

test('dishwasher view: running shows active, in use, time left and program length', () => {
  const v = view({ state: 'RUNNING', process: 'WASHING', remainTimeHour: 1, remainTimeMinute: 30, initialTimeHour: 2, initialTimeMinute: 15, door: 'CLOSE' });
  assert.equal(v.active, true);
  assert.equal(v.inUse, true);
  assert.equal(v.remainingSeconds, 5400);
  assert.equal(v.setDurationSeconds, 8100);
  assert.equal(v.doorClosed, true);
});

test('dishwasher view: a delayed start that has not begun is not in use', () => {
  const v = view({ state: 'RUNNING', process: 'RESERVED', delayStart: 'ON', remainTimeHour: 3 });
  assert.equal(v.inUse, false);
  assert.equal(v.active, true);
});

test('dishwasher view: off and standby are inactive; program length is kept from before', () => {
  for (const state of ['POWEROFF', 'STANDBY']) {
    const v = view({ state, remainTimeMinute: 10, initialTimeHour: 2 });
    assert.equal(v.active, false);
    assert.equal(v.inUse, false);
    assert.equal(v.setDurationSeconds, null, 'null means keep the last value');
  }
});

test('dishwasher view: door uses the model value for closed when given', () => {
  assert.equal(dishwasherView({ door: 'DOOR_SHUT' }, { lastRinseLevel: 'LEVEL_2', doorClosedValue: 'DOOR_SHUT' }).doorClosed, true);
  assert.equal(view({ door: 'OPEN' }).doorClosed, false);
});

test('rinse aid: read while running, otherwise keep the last known level', () => {
  assert.equal(rinseLevelFor({ state: 'RUNNING', rinseLevel: 'LEVEL_0' }, 'LEVEL_2'), 'LEVEL_0');
  assert.equal(rinseLevelFor({ state: 'RUNNING' }, 'LEVEL_2'), 'LEVEL_1');
  assert.equal(rinseLevelFor({ state: 'POWEROFF', rinseLevel: 'LEVEL_0' }, 'LEVEL_2'), 'LEVEL_2');
  assert.deepEqual(['LEVEL_0', 'LEVEL_1', 'LEVEL_2', 'OTHER'].map(rinseLevelPercent), [0, 50, 100, 100]);
  assert.equal(view({ state: 'RUNNING', rinseLevel: 'LEVEL_0' }).rinseLow, true);
});
