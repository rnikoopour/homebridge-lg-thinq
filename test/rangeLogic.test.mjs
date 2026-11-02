// Unit tests for the pure cooktop burner logic (synthetic data only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { rangeView, burnerOn } = require('../dist/devices/rangeLogic.js');

const allOff = Object.fromEntries([1, 2, 3, 4, 5].map(i => [`cooktop${i}CooktopState`, 'INIT']));

test('burner state: INIT or missing is off, anything else is on', () => {
  assert.equal(burnerOn('INIT'), false);
  assert.equal(burnerOn(undefined), false);
  assert.equal(burnerOn(''), false);
  assert.equal(burnerOn('HIGH'), true);
});

test('all burners off', () => {
  const v = rangeView({ ...allOff, burnerOnCounter: 0 });
  assert.equal(v.on, false);
  assert.deepEqual(v.burners.map(b => b.name), ['Front Left', 'Back Left', 'Center', 'Front Right', 'Back Right']);
  assert.ok(v.burners.every(b => !b.on));
});

test('one burner on turns the range on and identifies the burner', () => {
  const v = rangeView({ ...allOff, cooktop4CooktopState: 'MEDIUM', burnerOnCounter: 1 });
  assert.equal(v.on, true);
  assert.deepEqual(v.burners.filter(b => b.on).map(b => b.name), ['Front Right']);
});

test('only burners the model reports are listed; the counter alone still means on', () => {
  const v = rangeView({ cooktop1CooktopState: 'INIT', cooktop2CooktopState: 'INIT', burnerOnCounter: 1 });
  assert.equal(v.burners.length, 2);
  assert.equal(v.on, true);
  assert.deepEqual(rangeView(undefined), { on: false, burners: [] });
});
