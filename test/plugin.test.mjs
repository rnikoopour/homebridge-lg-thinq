// Tests run against the compiled plugin (dist/) with the real HAP-NodeJS library,
// using only synthetic data and upstream's public sample/ files.
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
const { mergeDeep } = require('../dist/helper.js');

// LG device ids are UUIDs, and HAP requires accessory UUIDs to be valid.
const WASHER_ID = hap.uuid.generate('washer-1');
const OLD_ID = hap.uuid.generate('old-device');
const ABC_ID = hap.uuid.generate('abc');

const sample = (name) => JSON.parse(fs.readFileSync(new URL(`../sample/${name}`, import.meta.url), 'utf8'));

// Homebridge's PlatformAccessory is a thin wrapper around HAP's Accessory.
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

function makePlatform(devicesConfig) {
  const calls = { registered: [], unregistered: [], updated: [] };
  const api = {
    hap,
    platformAccessory: TestAccessory,
    on() {},
    user: { storagePath: () => fs.mkdtempSync(path.join(os.tmpdir(), 'lgthinq-test-')) },
    registerPlatformAccessories: (_plugin, _platform, accessories) => calls.registered.push(...accessories),
    unregisterPlatformAccessories: (_plugin, _platform, accessories) => calls.unregistered.push(...accessories),
    updatePlatformAccessories: (accessories) => calls.updated.push(...accessories),
  };
  const platform = new LGThinQHomebridgePlatform(log, {
    platform: 'LGThinQ', country: 'US', language: 'en-US', refresh_token: 'test', devices: devicesConfig,
  }, api);
  return { platform, calls };
}

function sampleWasher({ id = WASHER_ID, alias = 'LG App Name', state = 'POWEROFF', online = true } = {}) {
  const data = structuredClone(sample('washer_dryer.json'));
  data.deviceId = id;
  data.alias = alias;
  data.online = online;
  data.snapshot = { ...data.snapshot, online, washerDryer: { ...data.snapshot.washerDryer, state } };
  const device = new Device(data);
  device.deviceModel = new DeviceModel(sample('washer_dryer-model.json'));
  return device;
}

function stubThinQ(platform, devices) {
  platform.ThinQ.devices = async () => devices;
  platform.ThinQ.setup = async () => true;
  platform.ThinQ.unregister = async () => {};
}

const { Characteristic, Service } = hap;
const nameOf = (service) => service.getCharacteristic(Characteristic.Name).value;

test('keeps cached accessories when ThinQ returns an empty device list', async () => {
  const { platform, calls } = makePlatform([]);
  platform.accessories.push(new TestAccessory('Washer', WASHER_ID));
  stubThinQ(platform, []);

  await platform.discoverDevices();

  assert.equal(calls.unregistered.length, 0);
  assert.equal(platform.accessories.length, 1);
});

test('still removes an accessory whose device is gone when other devices are returned', async () => {
  const { platform, calls } = makePlatform([]);
  platform.accessories.push(new TestAccessory('Old', OLD_ID));
  stubThinQ(platform, [sampleWasher()]);

  await platform.discoverDevices();

  assert.deepEqual(calls.unregistered.map(a => a.UUID), [OLD_ID]);
});

test('names come from the Homebridge config and prefix every sub-service', async () => {
  const { platform, calls } = makePlatform([{ id: WASHER_ID, name: 'Washer', washer_trigger: true }]);
  stubThinQ(platform, [sampleWasher({ alias: 'LG App Name' })]);

  await platform.discoverDevices();

  const [accessory] = calls.registered;
  assert.equal(accessory.displayName, 'Washer');
  const finished = accessory.getService(Service.OccupancySensor);
  assert.ok(finished, 'Program Finished sensor exists');
  assert.equal(nameOf(finished), 'Washer Program Finished');
  assert.equal(finished.getCharacteristic(Characteristic.ConfiguredName).value, 'Washer Program Finished');
});

test('former TV devices get a stable no-tv UUID; others use the LG device id', () => {
  const { platform } = makePlatform([]);
  const uuidFor = (deviceType) => platform['accessoryUUID'](new Device({ deviceId: ABC_ID, deviceType }));

  assert.equal(uuidFor(204), hap.uuid.generate(ABC_ID + ':no-tv')); // DISHWASHER
  assert.equal(uuidFor(301), hap.uuid.generate(ABC_ID + ':no-tv')); // OVEN
  assert.equal(uuidFor(221), ABC_ID); // WASHER_NEW
});

test('partial ThinQ updates merge into the cached snapshot', () => {
  const current = { online: true, washerDryer: { state: 'RUNNING', remainTimeHour: 1, remainTimeMinute: 58 } };
  const merged = mergeDeep({}, current, { washerDryer: { remainTimeMinute: 57 } });

  assert.deepEqual(merged, { online: true, washerDryer: { state: 'RUNNING', remainTimeHour: 1, remainTimeMinute: 57 } });
  assert.equal(current.washerDryer.remainTimeMinute, 58, 'input snapshot is not mutated');
});

test('a powered-off washer that LG reports offline shows as off, not an error', async () => {
  const { platform, calls } = makePlatform([{ id: WASHER_ID, name: 'Washer' }]);
  stubThinQ(platform, [sampleWasher({ state: 'POWEROFF', online: false })]);

  await platform.discoverDevices();

  const valve = calls.registered[0].getService(Service.Valve);
  const active = await valve.getCharacteristic(Characteristic.Active).handleGetRequest();
  assert.equal(active, Characteristic.Active.INACTIVE);
  const inUse = await valve.getCharacteristic(Characteristic.InUse).handleGetRequest();
  assert.equal(inUse, Characteristic.InUse.NOT_IN_USE);
});

test('every value the dishwasher publishes can be read (modern onGet handlers)', async () => {
  const DISHWASHER_ID = hap.uuid.generate('dishwasher-1');
  const data = structuredClone(sample('dishwasher.json').data);
  data.deviceId = DISHWASHER_ID;
  const device = new Device(data);
  device.deviceModel = new DeviceModel(sample('dishwasher-model.json'));
  const { platform, calls } = makePlatform([{ id: DISHWASHER_ID, name: 'Dishwasher', dishwasher_trigger: true }]);
  stubThinQ(platform, [device]);

  await platform.discoverDevices();

  const accessory = calls.registered[0];
  assert.equal(accessory.UUID, hap.uuid.generate(DISHWASHER_ID + ':no-tv'));
  assert.equal(accessory.services.filter(s => s.UUID === Service.Television.UUID).length, 0, 'no Television service');
  let reads = 0;
  for (const service of accessory.services) {
    for (const characteristic of service.characteristics) {
      if (!characteristic.props.perms.includes('pr')) {
        continue;
      }
      await characteristic.handleGetRequest();
      reads++;
    }
  }
  assert.ok(reads > 10, `read ${reads} values`);
});

const ovenFixture = () => JSON.parse(fs.readFileSync(new URL('./fixtures/oven.json', import.meta.url), 'utf8'));

async function buildOven(ovenState) {
  const OVEN_ID = hap.uuid.generate('oven-1');
  const fixture = ovenFixture();
  const data = { ...fixture.device, deviceId: OVEN_ID };
  if (ovenState) {
    data.snapshot = { ...data.snapshot, ovenState: fixture[ovenState] };
  }
  const device = new Device(data);
  device.deviceModel = new DeviceModel(fixture.model);
  const { platform, calls } = makePlatform([{ id: OVEN_ID, name: 'Oven' }]);
  stubThinQ(platform, [device]);
  await platform.discoverDevices();
  return { accessory: calls.registered[0], OVEN_ID };
}

async function readAll(accessory) {
  let reads = 0;
  for (const service of accessory.services) {
    for (const characteristic of service.characteristics) {
      if (characteristic.props.perms.includes('pr')) {
        await characteristic.handleGetRequest();
        reads++;
      }
    }
  }
  return reads;
}

test('oven: thermostat main tile, no TV, every value readable while off and while baking', async () => {
  for (const state of [null, 'bakingState']) {
    const { accessory, OVEN_ID } = await buildOven(state);
    assert.equal(accessory.UUID, hap.uuid.generate(OVEN_ID + ':no-tv'));
    assert.equal(accessory.services.filter(s => s.UUID === Service.Television.UUID).length, 0, 'no Television service');
    assert.equal(accessory.services.filter(s => s.UUID === Service.Valve.UUID).length, 0, 'timer valves not published');
    const primary = accessory.services.find(s => s.isPrimaryService);
    assert.equal(primary.UUID, Service.Thermostat.UUID);
    assert.ok(await readAll(accessory) > 30, `${state ?? 'off'}: values readable`);
  }
});

// HAP clamps out-of-range values itself and only warns, so check for the warning.
async function captureHapWarnings(fn) {
  const warnings = [];
  const originals = { warn: console.warn, log: console.log, error: console.error };
  for (const level of Object.keys(originals)) {
    console[level] = (...args) => warnings.push(args.map(String).join(' '));
  }
  try {
    await fn();
  } finally {
    Object.assign(console, originals);
  }
  return warnings.filter(w => /illegal value/i.test(w));
}

test('oven: target temperature stays within the declared range when LG reports less', async () => {
  const { accessory } = await buildOven(null); // fixture reports a target of 10 while off
  const illegal = await captureHapWarnings(async () => {
    for (const service of accessory.services.filter(s => s.UUID === Service.Thermostat.UUID)) {
      await service.getCharacteristic(Characteristic.TargetTemperature).handleGetRequest();
    }
  });
  assert.deepEqual(illegal, []);
});

test('oven: sub-services carry the oven name and a ConfiguredName', async () => {
  const { accessory } = await buildOven('bakingState');
  for (const service of accessory.services) {
    if (service.isPrimaryService || service.UUID === Service.AccessoryInformation.UUID) {
      continue;
    }
    assert.match(String(nameOf(service)), /^Oven\b/);
    assert.equal(service.getCharacteristic(Characteristic.ConfiguredName).value, nameOf(service));
  }
});

test('washer: a live cycle triggers Program Finished once, resets after 10 minutes, offline shows a fault', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { platform, calls } = makePlatform([{ id: WASHER_ID, name: 'Washer', washer_trigger: true }]);
  stubThinQ(platform, [sampleWasher({ state: 'POWEROFF' })]);
  await platform.discoverDevices();

  const accessory = calls.registered[0];
  const sensor = accessory.getService(Service.OccupancySensor);
  const valve = accessory.getService(Service.Valve);
  const occupied = () => sensor.getCharacteristic(Characteristic.OccupancyDetected).value;
  const updates = [];
  sensor.getCharacteristic(Characteristic.OccupancyDetected).on('change', ({ newValue }) => updates.push(newValue));
  const send = (washerDryer) => platform.events.emit(WASHER_ID, { washerDryer });

  send({ state: 'RUNNING', remainTimeHour: 0, remainTimeMinute: 40 });
  assert.equal(valve.getCharacteristic(Characteristic.InUse).value, Characteristic.InUse.IN_USE);
  send({ remainTimeMinute: 39 }); // partial update keeps the state
  assert.equal(valve.getCharacteristic(Characteristic.InUse).value, Characteristic.InUse.IN_USE);
  send({ state: 'END', remainTimeMinute: 0 });
  assert.equal(occupied(), Characteristic.OccupancyDetected.OCCUPANCY_DETECTED);
  send({ state: 'END' }); // LG repeats itself
  assert.equal(updates.filter(v => v === Characteristic.OccupancyDetected.OCCUPANCY_DETECTED).length, 1, 'fired once');

  t.mock.timers.tick(10 * 60 * 1000);
  assert.equal(occupied(), Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED, 'reset after 10 minutes');

  platform.events.emit(WASHER_ID, { online: false, washerDryer: { state: 'POWEROFF' } });
  assert.equal(valve.getCharacteristic(Characteristic.StatusFault).value, Characteristic.StatusFault.GENERAL_FAULT);
  assert.equal(valve.getCharacteristic(Characteristic.Active).value, Characteristic.Active.INACTIVE);
});

test('dishwasher: a live program triggers Program Finished once; stopping mid-program does not', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const DISHWASHER_ID = hap.uuid.generate('dishwasher-2');
  const data = structuredClone(sample('dishwasher.json').data);
  data.deviceId = DISHWASHER_ID;
  data.snapshot.dishwasher.state = 'POWEROFF';
  const device = new Device(data);
  device.deviceModel = new DeviceModel(sample('dishwasher-model.json'));
  const { platform, calls } = makePlatform([{ id: DISHWASHER_ID, name: 'Dishwasher', dishwasher_trigger: true }]);
  stubThinQ(platform, [device]);
  await platform.discoverDevices();

  const sensor = calls.registered[0].getService(Service.OccupancySensor);
  const fired = [];
  sensor.getCharacteristic(Characteristic.OccupancyDetected).on('change', ({ newValue }) => {
    if (newValue === Characteristic.OccupancyDetected.OCCUPANCY_DETECTED) {
      fired.push(true);
    }
  });
  const send = (dishwasher) => platform.events.emit(DISHWASHER_ID, { dishwasher });

  send({ state: 'RUNNING', process: 'WASHING', remainTimeHour: 1, remainTimeMinute: 30 });
  send({ state: 'POWEROFF' }); // stopped mid-program
  assert.equal(fired.length, 0, 'stop is not a finish');

  send({ state: 'RUNNING', process: 'WASHING', remainTimeHour: 1, remainTimeMinute: 30 });
  send({ process: 'DRYING', remainTimeHour: 0, remainTimeMinute: 10 });
  send({ state: 'END' });
  send({ state: 'END' });
  assert.equal(fired.length, 1, 'finished once');
});

test('dishwasher: publishes only the valve, door and Program Finished services', async () => {
  const DISHWASHER_ID = hap.uuid.generate('dishwasher-3');
  const data = structuredClone(sample('dishwasher.json').data);
  data.deviceId = DISHWASHER_ID;
  const device = new Device(data);
  device.deviceModel = new DeviceModel(sample('dishwasher-model.json'));
  const { platform, calls } = makePlatform([{ id: DISHWASHER_ID, name: 'Dishwasher', dishwasher_trigger: true }]);
  stubThinQ(platform, [device]);
  await platform.discoverDevices();

  const types = calls.registered[0].services.map(s => s.UUID).sort();
  assert.deepEqual(types, [Service.AccessoryInformation.UUID, Service.ContactSensor.UUID, Service.OccupancySensor.UUID, Service.Valve.UUID].sort());
});
