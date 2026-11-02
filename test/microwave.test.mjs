// Spoofed microwave (synthetic ovenState, made-up ids) to exercise Microwave.ts end to end
// with the real HAP library: setup, every read, and the LG fields behind its comparisons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as hap from '@homebridge/hap-nodejs';

const require = createRequire(import.meta.url);
const { LGThinQHomebridgePlatform } = require('../dist/platform.js');
const { Device } = require('../dist/lib/Device.js');
const { DeviceModel } = require('../dist/lib/DeviceModel.js');

const { Characteristic, Service } = hap;
const MICROWAVE_ID = hap.uuid.generate('microwave-1');

class TestAccessory extends hap.Accessory {
  constructor(name, uuid, category) {
    super(name, uuid);
    this.category = category;
    this.context = {};
  }

  updateDisplayName(name) {
    this.displayName = name;
  }
}

const log = { info() {}, warn() {}, error() {}, debug() {}, success() {}, log() {} };

const IDLE = {
  LWOState: 'INITIAL',
  LWOManualCookName: 'NONE',
  LWOSubCookName: 0,
  LWOTargetTemperatureUnit: 'FAHRENHEIT',
  LWOTargetTemperatureValue: 0,
  upperCurrentTemperatureValue: 0,
  LWORemainTimeHour: 0, LWORemainTimeMinute: 0, LWORemainTimeSecond: 0,
  LWOTargetTimeHour: 0, LWOTargetTimeMinute: 0, LWOTargetTimeSecond: 0,
  LWOTimerHour: 0, LWOTimerMinute: 0, LWOTimerSecond: 0,
  mwoLampLevel: 0,
  mwoVentSpeedLevel: 0,
  LWOControlLock: 'DISABLE',
  LWOSabbath: 'DISABLE',
};

const COOKING = {
  ...IDLE,
  LWOState: 'COOKING_IN_PROGRESS',
  LWOManualCookName: 'MICROWAVE',
  LWORemainTimeHour: 0, LWORemainTimeMinute: 2, LWORemainTimeSecond: 30,
  LWOTargetTimeHour: 0, LWOTargetTimeMinute: 3, LWOTargetTimeSecond: 0,
};

async function buildMicrowave(ovenState) {
  const device = new Device({
    deviceId: MICROWAVE_ID, alias: 'Microwave', deviceType: 302, platformType: 'thinq2', modelName: 'MWO-TEST',
    online: true, snapshot: { online: true, ovenState },
  });
  device.deviceModel = new DeviceModel({ Info: {}, MonitoringValue: {}, Value: {} });

  const registered = [];
  const api = {
    hap, platformAccessory: TestAccessory, on() {},
    user: { storagePath: () => fs.mkdtempSync(path.join(os.tmpdir(), 'lgthinq-test-')) },
    registerPlatformAccessories: (_p, _n, accessories) => registered.push(...accessories),
    unregisterPlatformAccessories() {}, updatePlatformAccessories() {},
  };
  const platform = new LGThinQHomebridgePlatform(log, {
    platform: 'LGThinQ', country: 'US', language: 'en-US', refresh_token: 'test',
    devices: [{ id: MICROWAVE_ID, name: 'Microwave' }],
  }, api);
  platform.ThinQ.devices = async () => [device];
  platform.ThinQ.setup = async () => true;
  platform.ThinQ.unregister = async () => {};
  await platform.discoverDevices();
  return registered[0];
}

/** Read every readable characteristic; returns the HAP warnings printed meanwhile. */
async function readAll(accessory) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    for (const service of accessory.services) {
      for (const characteristic of service.characteristics) {
        if (characteristic.props.perms.includes('pr')) {
          await characteristic.handleGetRequest();
        }
      }
    }
  } finally {
    console.warn = original;
  }
  return warnings;
}

const service = (accessory, name) => accessory.services.find(s => s.displayName === name);
const read = (accessory, name, characteristic) => service(accessory, name).getCharacteristic(characteristic).handleGetRequest();

test('microwave: sets up and every characteristic reads, without HAP warnings, idle and cooking', async () => {
  for (const state of [IDLE, COOKING]) {
    const accessory = await buildMicrowave(state);
    assert.ok(accessory, 'accessory registered');
    assert.ok(accessory.getService(Service.Television), 'main Television service');
    assert.ok(service(accessory, 'Microwave Cook Time'), 'cook time valve');
    assert.deepEqual(await readAll(accessory), []);
  }
});

test('microwave: power level shows as a percentage, on reads and on status updates', async () => {
  // Power level was NaN when LG left it out, and status updates pushed the raw 0-10 level.
  const missing = await buildMicrowave(IDLE);
  assert.equal(await read(missing, 'Microwave Power', Characteristic.Brightness), 0);

  const full = await buildMicrowave({ ...COOKING, LWOMGTPowerLevel: '10' });
  const power = service(full, 'Microwave Power');
  assert.equal(power.getCharacteristic(Characteristic.Brightness).value, 100, 'after the status update');
  assert.equal(power.getCharacteristic(Characteristic.On).value, true);
  assert.equal(await read(full, 'Microwave Power', Characteristic.Brightness), 100);
});

test('microwave: idle with light and fan off is inactive; light or fan on makes it active', async () => {
  const idle = await buildMicrowave(IDLE);
  assert.equal(idle.getService(Service.Television).getCharacteristic(Characteristic.Active).value, 0);
  assert.equal(await read(idle, 'Microwave Light', Characteristic.On), false);

  const lampOn = await buildMicrowave({ ...IDLE, mwoLampLevel: 2 });
  assert.equal(lampOn.getService(Service.Television).getCharacteristic(Characteristic.Active).value, 1);
  assert.equal(await read(lampOn, 'Microwave Light', Characteristic.On), true);

  const fanOn = await buildMicrowave({ ...IDLE, mwoVentSpeedLevel: 3 });
  assert.equal(fanOn.getService(Service.Television).getCharacteristic(Characteristic.Active).value, 1);
});

test('microwave: cook time valve shows time left and program length', async () => {
  const cooking = await buildMicrowave(COOKING);
  assert.equal(await read(cooking, 'Microwave Cook Time', Characteristic.Active), 1);
  assert.equal(await read(cooking, 'Microwave Cook Time', Characteristic.RemainingDuration), 150);
  assert.equal(await read(cooking, 'Microwave Cook Time', Characteristic.SetDuration), 180);

  const idle = await buildMicrowave(IDLE);
  assert.equal(await read(idle, 'Microwave Cook Time', Characteristic.Active), 0);
  assert.equal(await read(idle, 'Microwave Cook Time', Characteristic.RemainingDuration), 0);
});

test('microwave: LG fields sent as numeric strings behave like numbers', async () => {
  const strings = Object.fromEntries(Object.entries(COOKING).map(([k, v]) => [k, typeof v === 'number' ? String(v) : v]));
  const accessory = await buildMicrowave({ ...strings, mwoLampLevel: '0', mwoVentSpeedLevel: '0' });
  // String seconds used to be appended as text ("120" + "30"); now they add up.
  assert.equal(await read(accessory, 'Microwave Cook Time', Characteristic.RemainingDuration), 150);
  assert.equal(await read(accessory, 'Microwave Cook Time', Characteristic.SetDuration), 180);

  const idleStrings = await buildMicrowave({ ...IDLE, mwoLampLevel: '0', mwoVentSpeedLevel: '0' });
  assert.equal(idleStrings.getService(Service.Television).getCharacteristic(Characteristic.Active).value, 0);
});
