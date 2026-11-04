// The settings schema and the device dispatcher must agree: the UI should expose
// every option the code reads, and every advertised device type should be buildable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { Helper } = require('../dist/helper.js');

const schema = JSON.parse(fs.readFileSync(new URL('../config.schema.json', import.meta.url), 'utf8'));

const findFieldset = (title) => {
  const fieldsets = [];
  const visit = (node) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (node && typeof node === 'object') {
      if (node.type === 'fieldset' && node.title === title) {
        fieldsets.push(node);
      }
      Object.values(node).forEach(visit);
    }
  };
  visit(schema.layout);
  return fieldsets[0];
};

test('AC settings expose every AC option the code reads', () => {
  const acFieldset = findFieldset('Air conditioner specific settings');
  assert.ok(acFieldset, 'AC fieldset exists');
  assert.ok(acFieldset.items.includes('devices[].ac_led_control'));
});

test('Range settings are not described as dishwasher settings', () => {
  const rangeFieldset = findFieldset('Range');
  assert.ok(rangeFieldset, 'Range fieldset exists');
  assert.doesNotMatch(rangeFieldset.description, /dishwasher/i);
});

test('every device type the schema advertises can be built', () => {
  const types = schema.schema.devices.items.properties.type.enum;
  for (const type of types) {
    const handler = Helper.make({ platform: 'thinq2', type });
    assert.notEqual(handler, null, `${type} has a handler`);
  }
});

test('the schema does not advertise unhandled RANGE/COOKTOP device types', () => {
  const types = schema.schema.devices.items.properties.type.enum;
  assert.ok(!types.includes('RANGE'));
  assert.ok(!types.includes('COOKTOP'));
});
