// Unit tests for the pure oven logic (synthetic data only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { fToC, cToF, ovenView, activeModeSwitch, temperatureRange, cookStartPayload, commandsAllowed, DEFAULT_SELECTION } =
  require('../dist/devices/ovenLogic.js');

const off = { upperState: 'INITIAL', upperManualCookName: 'NONE', upperCurrentTemperatureUnit: 'FAHRENHEIT',
  upperCurrentTemperatureValue: 0, upperTargetTemperatureValue: 10, upperCurrentProveTemperatureF: 0, upperTargetProveTemperatureF: 0,
  upperDoorOpen: 'DISABLE', upperRemoteStart: 'DISABLE', upperCookAndWarmStatus: 'DISABLE', burnerOnCounter: 0 };
const baking = { ...off, upperState: 'COOKING_IN_PROGRESS', upperManualCookName: 'BAKE', upperCurrentTemperatureValue: 300,
  upperTargetTemperatureValue: 350, upperRemoteStart: 'ENABLE' };

test('temperature conversion', () => {
  assert.equal(fToC(350), 176.5);
  assert.equal(cToF(175), 347);
  assert.equal(fToC(32), 0);
});

test('view: oven off', () => {
  const v = ovenView(off);
  assert.equal(v.ovenOn, false);
  assert.equal(v.rangeOn, false);
  assert.equal(v.cookingMode, null);
  assert.equal(v.heating, false);
  assert.equal(v.targetTemperatureC, 38, 'LG reports 10 while off; clamped to the declared minimum');
  assert.equal(v.currentTemperatureC, 22, 'off: room temperature, not the leftover target (10F would be -12C)');
  assert.equal(v.doorOpen, false);
  assert.equal(v.remoteStartEnabled, false);
  assert.equal(v.keepWarm, false);
});

test('view: preheating with no current reading shows the target', () => {
  const v = ovenView({ ...baking, upperCurrentTemperatureValue: 0 });
  assert.equal(v.currentTemperatureC, fToC(350));
});

test('view: baking at 350F', () => {
  const v = ovenView(baking);
  assert.equal(v.ovenOn, true);
  assert.equal(v.cookingMode, 'BAKE');
  assert.equal(v.currentTemperatureC, fToC(300));
  assert.equal(v.targetTemperatureC, fToC(350));
  assert.equal(v.heating, true);
  assert.equal(v.remoteStartEnabled, true);
});

test('view: burners alone count as the range cooking', () => {
  const v = ovenView({ ...off, burnerOnCounter: 2 });
  assert.equal(v.ovenOn, false);
  assert.equal(v.rangeOn, true);
  assert.equal(v.burnersOn, 2);
});

test('view: probe is only active with a probe reading (old code checked a misspelled field)', () => {
  assert.equal(ovenView(off).probeInserted, false);
  assert.equal(ovenView({ ...off, upperCurrentProveTemperatureF: 120 }).probeInserted, true);
});

test('view: missing data is off, not an error; keep warm unknown when not reported', () => {
  const v = ovenView(undefined);
  assert.equal(v.ovenOn, false);
  assert.equal(v.keepWarm, null);
  assert.equal(v.doorOpen, false);
});

test('mode switches: the mode being cooked wins over the selection', () => {
  assert.equal(activeModeSwitch(ovenView(off), 'AIR_FRY'), 'AIR_FRY');
  assert.equal(activeModeSwitch(ovenView(baking), 'AIR_FRY'), 'BAKE');
  assert.equal(activeModeSwitch(ovenView(off), null), null);
});

test('temperature ranges per mode, including sous-vide in Celsius (old code forced 38C)', () => {
  assert.deepEqual(temperatureRange('AIR_SOUSVIDE', false), { min: 38, max: 96 });
  const payload = cookStartPayload({ ...DEFAULT_SELECTION, mode: 'AIR_SOUSVIDE', temperatureC: 60 }, false);
  assert.equal(payload.setTargetTemperature, 60);
});

test('start command: defaults to Bake 350F for 30 minutes', () => {
  const p = cookStartPayload(DEFAULT_SELECTION, true);
  assert.equal(p.cmdOptionSetCookName, 'BAKE');
  assert.equal(p.setTargetTemperature, 350);
  assert.equal(p.cmdOptionSetTargetTemperatureUnit, 'FAHRENHEIT');
  assert.equal(p.cmdOptionSetTargetTimeHour, 0);
  assert.equal(p.cmdOptionSetTargetTimeMinute, 30);
  assert.equal(p.cmdOptionSetCookAndWarm, 'DISABLE');
});

test('start command: temperature converted to the oven unit and clamped to the mode range', () => {
  assert.equal(cookStartPayload({ ...DEFAULT_SELECTION, mode: 'BAKE', temperatureC: 175 }, true).setTargetTemperature, 347);
  assert.equal(cookStartPayload({ ...DEFAULT_SELECTION, mode: 'CONVECTION_BAKE', temperatureC: 93 }, true).setTargetTemperature, 300);
  assert.equal(cookStartPayload({ ...DEFAULT_SELECTION, mode: 'AIR_FRY', temperatureC: 400 }, false).setTargetTemperature, 285);
});

test('start command: proof/warm has no temperature, duration or keep warm', () => {
  const p = cookStartPayload({ ...DEFAULT_SELECTION, mode: 'WARM', temperatureC: 100, keepWarm: true, durationSeconds: 600 }, true);
  assert.equal(p.setTargetTemperature, 0);
  assert.equal(p.cmdOptionSetTargetTimeMinute, 0);
  assert.equal(p.cmdOptionSetCookAndWarm, 'DISABLE');
});

test('commands are blocked by monitor only or remote start disabled', () => {
  assert.equal(commandsAllowed(ovenView(baking), false), true);
  assert.equal(commandsAllowed(ovenView(baking), true), false);
  assert.equal(commandsAllowed(ovenView(off), false), false);
});
