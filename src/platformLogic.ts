/**
 * Pure platform decisions: which devices to publish, as which accessories, under
 * which names. No Homebridge objects here, so every rule can be unit tested directly.
 */

import {PlatformType} from './lib/constants';

/** The per-device fields of the plugin config this module reads. */
export interface DeviceConfig {
  id: string;
  name?: string;
  burners_name?: string;
}

/** The device fields this module reads. */
export interface DeviceInfo {
  id: string;
  type: string;
  platform: string;
}

export type DeviceDecision = 'setup' | 'skip-thinq1' | 'skip-not-selected';

/**
 * Whether a device gets set up. ThinQ1 devices need the thinq1 option; when the
 * config lists devices, only the listed ones are published.
 */
export function deviceDecision(device: DeviceInfo, configDevices: DeviceConfig[], enableThinq1: boolean): DeviceDecision {
  if (!enableThinq1 && device.platform === PlatformType.ThinQ1) {
    return 'skip-thinq1';
  }
  if (configDevices.length && !configDevices.some(config => config.id === device.id)) {
    return 'skip-not-selected';
  }
  return 'setup';
}

/** The name from the Homebridge config wins over the LG app alias. */
export function configuredName(deviceId: string, configDevices: DeviceConfig[]): string | null {
  return configDevices.find(config => config.id === deviceId)?.name || null;
}

/**
 * One HomeKit accessory to publish for a device. `uuidSeed` null means the device
 * id is the UUID; otherwise the UUID is generated from the seed.
 */
export interface AccessoryPlan {
  kind: 'main' | 'burners';
  uuidSeed: string | null;
  name: string;
  /** Link every service to the primary one so Home shows a single tile. */
  bundle: boolean;
}

/** Device types that used to carry a Television service and moved to a new UUID without it. */
const NO_TV_TYPES = ['DISHWASHER', 'OVEN'];

export const DEFAULT_BURNERS_NAME = 'Burners';

/**
 * The accessories a device is published as: the appliance itself, plus a separate
 * Burners accessory for a range's cooktop.
 */
export function accessoryPlans(device: DeviceInfo, name: string, configDevices: DeviceConfig[]): AccessoryPlan[] {
  const noTv = NO_TV_TYPES.includes(device.type);
  const plans: AccessoryPlan[] = [{
    kind: 'main',
    uuidSeed: noTv ? device.id + ':no-tv' : null,
    name,
    bundle: noTv,
  }];

  if (device.type === 'OVEN') {
    const config = configDevices.find(entry => entry.id === device.id);
    plans.push({
      kind: 'burners',
      uuidSeed: device.id + ':burners',
      name: config?.burners_name || DEFAULT_BURNERS_NAME,
      bundle: false,
    });
  }
  return plans;
}

/**
 * A secondary service's name, prefixed with the appliance name: "Program Finished"
 * -> "Washer Program Finished", "Stop Oven" -> "Oven Stop". The appliance name is
 * removed wherever it already appears (any case, whole words) before prefixing,
 * so renaming the appliance or running this again does not stack prefixes.
 */
export function prefixedServiceName(current: string, deviceName: string): string {
  const escaped = deviceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Lookarounds instead of \b, which never matches next to a name's leading/trailing punctuation.
  const deviceWord = new RegExp('(?<!\\w)' + escaped + '(?!\\w)', 'gi');
  const base = current.replace(deviceWord, ' ').replace(/^[\s-]+|[\s-]+$/g, '').replace(/\s+/g, ' ');
  return base ? deviceName + ' ' + base : deviceName;
}

/**
 * Whether cached accessories should be kept when LG returns no devices. An empty
 * list while accessories are cached is almost always a transient LG account state
 * (e.g. a pending terms agreement); removing them makes HomeKit delete every
 * automation that references them.
 */
export function keepCacheOnEmptyDeviceList(deviceCount: number, cachedCount: number): boolean {
  return deviceCount === 0 && cachedCount > 0;
}
