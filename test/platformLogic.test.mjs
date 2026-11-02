// Unit tests for the pure platform decisions (synthetic ids only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  deviceDecision, configuredName, accessoryPlans, prefixedServiceName, keepCacheOnEmptyDeviceList, DEFAULT_BURNERS_NAME,
} = require('../dist/platformLogic.js');
const { hmsSeconds, remainingSeconds } = require('../dist/devices/programTracking.js');

const washer = { id: 'washer-1', type: 'WASHER', platform: 'thinq2' };
const oven = { id: 'oven-1', type: 'OVEN', platform: 'thinq2' };
const dishwasher = { id: 'dish-1', type: 'DISHWASHER', platform: 'thinq2' };
const oldAc = { id: 'ac-1', type: 'AC', platform: 'thinq1' };

test('device decision: thinq1 needs the option; a device list limits what is published', () => {
  assert.equal(deviceDecision(washer, [], false), 'setup');
  assert.equal(deviceDecision(oldAc, [], false), 'skip-thinq1');
  assert.equal(deviceDecision(oldAc, [], true), 'setup');
  assert.equal(deviceDecision(washer, [{ id: 'other' }], false), 'skip-not-selected');
  assert.equal(deviceDecision(washer, [{ id: 'washer-1' }], false), 'setup');
  // thinq1 is checked first, even when listed
  assert.equal(deviceDecision(oldAc, [{ id: 'ac-1' }], false), 'skip-thinq1');
});

test('configured name overrides the LG alias only when set', () => {
  assert.equal(configuredName('washer-1', [{ id: 'washer-1', name: 'Laundry' }]), 'Laundry');
  assert.equal(configuredName('washer-1', [{ id: 'washer-1', name: '' }]), null);
  assert.equal(configuredName('washer-1', [{ id: 'washer-1' }]), null);
  assert.equal(configuredName('washer-1', []), null);
});

test('accessory plans: plain device keeps its id as UUID and is not bundled', () => {
  assert.deepEqual(accessoryPlans(washer, 'Washer', []), [
    { kind: 'main', uuidSeed: null, name: 'Washer', bundle: false },
  ]);
});

test('accessory plans: dishwasher uses the no-tv UUID and is bundled', () => {
  assert.deepEqual(accessoryPlans(dishwasher, 'Dishwasher', []), [
    { kind: 'main', uuidSeed: 'dish-1:no-tv', name: 'Dishwasher', bundle: true },
  ]);
});

test('accessory plans: oven adds a separate Burners accessory, name configurable', () => {
  assert.deepEqual(accessoryPlans(oven, 'Oven', []), [
    { kind: 'main', uuidSeed: 'oven-1:no-tv', name: 'Oven', bundle: true },
    { kind: 'burners', uuidSeed: 'oven-1:burners', name: DEFAULT_BURNERS_NAME, bundle: false },
  ]);
  assert.equal(accessoryPlans(oven, 'Oven', [{ id: 'oven-1', burners_name: 'Cooktop' }])[1].name, 'Cooktop');
  assert.equal(accessoryPlans(oven, 'Oven', [{ id: 'oven-1', burners_name: '' }])[1].name, DEFAULT_BURNERS_NAME);
});

test('service names get the appliance name as prefix', () => {
  assert.equal(prefixedServiceName('Program Finished', 'Washer'), 'Washer Program Finished');
  assert.equal(prefixedServiceName('Stop Oven', 'Oven'), 'Oven Stop');
  assert.equal(prefixedServiceName('oven - Light', 'Oven'), 'Oven Light');
  assert.equal(prefixedServiceName('', 'Oven'), 'Oven');
  assert.equal(prefixedServiceName('Oven', 'Oven'), 'Oven');
});

test('prefixing is idempotent and does not match partial words', () => {
  const once = prefixedServiceName('Program Finished', 'Washer');
  assert.equal(prefixedServiceName(once, 'Washer'), once);
  assert.equal(prefixedServiceName('Dishwasher Door', 'Washer'), 'Washer Dishwasher Door');
});

test('prefixing escapes regex characters in the appliance name', () => {
  assert.equal(prefixedServiceName('Door', 'Oven (Upper)'), 'Oven (Upper) Door');
  assert.equal(prefixedServiceName('Oven (Upper) Door', 'Oven (Upper)'), 'Oven (Upper) Door');
});

test('empty device list keeps the cache only when something is cached', () => {
  assert.equal(keepCacheOnEmptyDeviceList(0, 5), true);
  assert.equal(keepCacheOnEmptyDeviceList(0, 0), false);
  assert.equal(keepCacheOnEmptyDeviceList(3, 5), false);
});

test('hour/minute/second fields to seconds; missing and string values handled', () => {
  assert.equal(hmsSeconds(1, 2, 3), 3723);
  assert.equal(hmsSeconds(undefined, 5), 300);
  assert.equal(hmsSeconds('1', '0', '30'), 3630);
  assert.equal(hmsSeconds(null, 'x', undefined), 0);
  assert.equal(remainingSeconds({ remainTimeHour: 0, remainTimeMinute: 45 }), 2700);
});
