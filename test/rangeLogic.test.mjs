// Unit tests for the pure cooktop burner logic (synthetic data only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { rangeView, burnerOn } = require('../dist/devices/rangeLogic.js');

const allOff = Object.fromEntries([1, 2, 3, 4, 5].map(i => [`cooktop${i}CooktopState`, 'INIT']));

test('burner slot state: INIT or missing is off, anything else is on', () => {
  assert.equal(burnerOn('INIT'), false);
  assert.equal(burnerOn(undefined), false);
  assert.equal(burnerOn(''), false);
  assert.equal(burnerOn('COOKING_IN_PROGRESS'), true);
});

test('all burners off', () => {
  assert.deepEqual(rangeView({ ...allOff, burnerOnCounter: 0 }), { on: false, burnersOn: 0 });
});

test('any burner on turns Burners on, whichever LG slot reports it', () => {
  // Real range: different physical burners were each reported as cooktop1.
  assert.deepEqual(rangeView({ ...allOff, cooktop1CooktopState: 'COOKING_IN_PROGRESS', burnerOnCounter: 1 }), { on: true, burnersOn: 1 });
  assert.deepEqual(rangeView({ ...allOff, cooktop4CooktopState: 'COOKING_IN_PROGRESS' }), { on: true, burnersOn: 1 });
});

test('the counter alone still means on; missing data is off', () => {
  assert.deepEqual(rangeView({ burnerOnCounter: 2 }), { on: true, burnersOn: 2 });
  assert.deepEqual(rangeView(undefined), { on: false, burnersOn: 0 });
});
