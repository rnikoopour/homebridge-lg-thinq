// Recovery without a Homebridge restart: retry backoff, and reconnecting an MQTT
// connection that stays open but stops delivering updates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as hap from '@homebridge/hap-nodejs';

const require = createRequire(import.meta.url);
const { retryDelayMs } = require('../dist/platformLogic.js');
const {
  MqttWatchdog, stateFingerprint, STALE_POLLS_BEFORE_RECONNECT, MIN_RECONNECT_INTERVAL_MS,
} = require('../dist/lib/mqttWatchdog.js');
const { LGThinQHomebridgePlatform } = require('../dist/platform.js');

const MINUTE = 60_000;

test('retryDelayMs doubles from the base and stops at the cap', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(attempt => retryDelayMs(attempt)),
    [30_000, 60_000, 120_000, 240_000, 480_000, 600_000]);
  assert.equal(retryDelayMs(50, 5_000, 300_000), 300_000);
});

test('stateFingerprint ignores bookkeeping fields and key order', () => {
  const a = { washerDryer: { state: 'RUNNING', remainTimeMinute: 5 }, timestamp: 1, meta: { messageId: 'x' }, mid: 1 };
  const b = { mid: 2, timestamp: 2, washerDryer: { remainTimeMinute: 5, state: 'RUNNING' } };
  assert.equal(stateFingerprint(a), stateFingerprint(b));
  assert.notEqual(stateFingerprint(a), stateFingerprint({ washerDryer: { state: 'END' } }));
  assert.equal(stateFingerprint(null), '');
});

const running = minutes => ({ washerDryer: { state: 'RUNNING', remainTimeMinute: minutes }, timestamp: minutes });

/** Poll a device whose state changes every poll; returns the reconnect decisions. */
function pollChanging(watchdog, { count, start = 0, mqtt = false }) {
  const decisions = [];
  for (let i = 0; i < count; i++) {
    const now = (start + i) * MINUTE;
    if (mqtt) {
      watchdog.messageReceived('washer', now - 1000);
    }
    decisions.push(watchdog.observePoll([{ id: 'washer', snapshot: running(1000 - start - i) }], now));
  }
  return decisions;
}

test('watchdog: reconnects after consecutive polls see changes MQTT never delivered', () => {
  const watchdog = new MqttWatchdog();
  // The first poll only records state; the next STALE_POLLS_BEFORE_RECONNECT see missed changes.
  const decisions = pollChanging(watchdog, { count: STALE_POLLS_BEFORE_RECONNECT + 1 });
  assert.deepEqual(decisions, [...Array(STALE_POLLS_BEFORE_RECONNECT).fill(false), true]);
});

test('watchdog: no reconnect while MQTT delivers each change', () => {
  const watchdog = new MqttWatchdog();
  assert.ok(pollChanging(watchdog, { count: 20, mqtt: true }).every(decision => !decision));
});

test('watchdog: no reconnect while the device is idle', () => {
  const watchdog = new MqttWatchdog();
  for (let i = 0; i < 20; i++) {
    assert.equal(watchdog.observePoll([{ id: 'washer', snapshot: { washerDryer: { state: 'POWEROFF' }, timestamp: i } }], i * MINUTE), false);
  }
});

test('watchdog: a single missed update does not reconnect', () => {
  const watchdog = new MqttWatchdog();
  pollChanging(watchdog, { count: 2 }); // one missed change
  assert.ok(pollChanging(watchdog, { count: 10, start: 2, mqtt: true }).every(decision => !decision));
});

test('watchdog: forced reconnects are spaced out', () => {
  const watchdog = new MqttWatchdog();
  const decisions = pollChanging(watchdog, { count: 60 });
  const reconnectMinutes = decisions.flatMap((decision, minute) => decision ? [minute] : []);
  assert.ok(reconnectMinutes.length >= 2);
  for (let i = 1; i < reconnectMinutes.length; i++) {
    assert.ok((reconnectMinutes[i] - reconnectMinutes[i - 1]) * MINUTE >= MIN_RECONNECT_INTERVAL_MS);
  }
});

function makePlatform() {
  const log = { info() {}, warn() {}, debug() {}, success() {}, log() {}, error() {} };
  const api = {
    hap, platformAccessory: hap.Accessory, on() {},
    user: { storagePath: () => fs.mkdtempSync(path.join(os.tmpdir(), 'lgthinq-test-')) },
    registerPlatformAccessories() {}, unregisterPlatformAccessories() {}, updatePlatformAccessories() {},
  };
  return new LGThinQHomebridgePlatform(log, {
    platform: 'LGThinQ', country: 'US', language: 'en-US', refresh_token: 'test', devices: [],
  }, api);
}

test('reconnectMQTT ends the current client and connects again immediately', () => {
  const { ThinQ } = makePlatform();
  const ended = [];
  const scheduled = [];
  ThinQ.mqttClient = { end: force => ended.push(force) };
  ThinQ.scheduleMqttReconnect = delay => scheduled.push(delay);

  ThinQ.reconnectMQTT();
  assert.deepEqual(ended, [true]);
  assert.deepEqual(scheduled, [0]);

  // Already reconnecting: nothing more to do.
  ThinQ.reconnectMQTT();
  assert.deepEqual(scheduled, [0]);
});

test('reconnectMQTT before MQTT ever connected does nothing', () => {
  const { ThinQ } = makePlatform();
  assert.doesNotThrow(() => ThinQ.reconnectMQTT());
});

test('startup: an LG outage at launch is retried until it connects', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const log = { info() {}, warn() {}, debug() {}, success() {}, log() {}, error() {} };
  let launch;
  const api = {
    hap, platformAccessory: hap.Accessory,
    on: (event, callback) => { if (event === 'didFinishLaunching') launch = callback; },
    user: { storagePath: () => fs.mkdtempSync(path.join(os.tmpdir(), 'lgthinq-test-')) },
    registerPlatformAccessories() {}, unregisterPlatformAccessories() {}, updatePlatformAccessories() {},
  };
  const platform = new LGThinQHomebridgePlatform(log, {
    platform: 'LGThinQ', country: 'US', language: 'en-US', refresh_token: 'test', devices: [],
  }, api);

  let readyCalls = 0;
  platform.ThinQ.isReady = async () => {
    readyCalls++;
    if (readyCalls < 3) {
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    }
  };
  let discovered = 0;
  platform.discoverDevices = async () => { discovered++; };
  platform.startMonitor = async () => {};

  const settle = () => new Promise(resolve => setImmediate(resolve));
  launch();
  await settle();
  assert.equal(readyCalls, 1);

  t.mock.timers.tick(retryDelayMs(0));
  await settle();
  assert.equal(readyCalls, 2);

  t.mock.timers.tick(retryDelayMs(1));
  await settle();
  assert.equal(readyCalls, 3);
  assert.equal(discovered, 1);
});
