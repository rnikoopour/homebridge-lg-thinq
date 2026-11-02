// Homebridge shuts the bridge down on any uncaught exception (including unhandled
// rejections), so failures in commands and device updates must be caught and logged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as hap from '@homebridge/hap-nodejs';

const require = createRequire(import.meta.url);
const { LGThinQHomebridgePlatform } = require('../dist/platform.js');
const { baseDevice } = require('../dist/baseDevice.js');
const { Device } = require('../dist/lib/Device.js');

function makePlatform(errors) {
  const log = { info() {}, warn() {}, debug() {}, success() {}, log() {}, error: (...args) => errors.push(args.join(' ')) };
  const api = {
    hap, platformAccessory: hap.Accessory, on() {},
    user: { storagePath: () => fs.mkdtempSync(path.join(os.tmpdir(), 'lgthinq-test-')) },
    registerPlatformAccessories() {}, unregisterPlatformAccessories() {}, updatePlatformAccessories() {},
  };
  return new LGThinQHomebridgePlatform(log, {
    platform: 'LGThinQ', country: 'US', language: 'en-US', refresh_token: 'test', devices: [],
  }, api);
}

test('deviceControl: a failed request resolves false and logs, instead of rejecting', async () => {
  const errors = [];
  const platform = makePlatform(errors);
  platform.ThinQ.api.sendCommandToDevice = async () => { throw new Error('socket hang up'); };

  assert.equal(await platform.ThinQ.deviceControl('device-1', { a: 1 }), false);
  assert.match(errors.join('\n'), /socket hang up/);
});

test('device update: an exception while applying a snapshot is logged, not thrown', () => {
  const errors = [];
  const platform = makePlatform(errors);
  const device = new Device({ deviceId: 'device-1', alias: 'Thing', deviceType: 0, platformType: 'thinq2', modelName: 'X', snapshot: {} });
  const accessory = new hap.Accessory('Thing', hap.uuid.generate('device-1'));
  accessory.context = { device };

  class Broken extends baseDevice {
    updateAccessoryCharacteristic() {
      throw new Error('bad payload');
    }
  }
  const handler = new Broken(platform, accessory);

  assert.doesNotThrow(() => handler.update({ some: 'state' }));
  assert.match(errors.join('\n'), /\[Thing\] Failed to apply device update: bad payload/);
});
