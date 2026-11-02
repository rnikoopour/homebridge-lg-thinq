import {LGThinQHomebridgePlatform} from './platform';
import {PlatformAccessory} from 'homebridge';
import {Device} from './lib/Device';
import {EventEmitter} from 'events';
import {mergeDeep} from './helper';

export class baseDevice extends EventEmitter {
  constructor(
    public readonly platform: LGThinQHomebridgePlatform,
    public readonly accessory: PlatformAccessory,
  ) {
    super();

    const device: Device = accessory.context.device;
    const {AccessoryInformation} = this.platform.Service;
    const serviceAccessoryInformation = accessory.getService(AccessoryInformation) || accessory.addService(AccessoryInformation);

    // set accessory information
    serviceAccessoryInformation
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'LG')
      .setCharacteristic(this.platform.Characteristic.Model, device.salesModel || device.model || 'Unknown')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.config.serial_number || device.serialNumber || 'Unknown');
  }

  public updateAccessoryCharacteristic(device: Device) {
    this.accessory.context.device = device;
  }

  public update(snapshot) {
    const device: Device = this.accessory.context.device;
    this.platform.log.debug('['+device.name+'] Received snapshot: ', JSON.stringify(snapshot));
    device.data.snapshot = mergeDeep({}, device.snapshot, snapshot);
    // Runs from MQTT and polling callbacks; an exception here would crash the bridge.
    try {
      this.updateAccessoryCharacteristic(device);
    } catch (err) {
      this.platform.log.error('['+device.name+'] Failed to apply device update:', (err as Error)?.message ?? err);
      this.platform.log.debug(String((err as Error)?.stack ?? err));
    }
  }

  public get config() {
    return this.platform.config.devices.find(enabled => enabled.id === this.accessory.context.device.id) || {};
  }

  public static model() {
    return '';
  }
}
