import {baseDevice} from '../baseDevice';
import {LGThinQHomebridgePlatform} from '../platform';
import {PlatformAccessory} from 'homebridge';
import {rangeView} from './rangeLogic';

/** Taps on the read-only switches are reverted after this long. */
const REVERT_MS = 500;

/**
 * The cooktop burners of an LG range, published as their own "Burners" accessory next
 * to the oven: one switch per burner (the Home app groups them and shows how many are
 * on). LG does not allow controlling burners remotely, so the switches are read-only
 * (taps revert).
 */
export default class Range extends baseDevice {
  protected burnerSwitches = new Map<number, ReturnType<PlatformAccessory['addService']>>();

  constructor(
    public readonly platform: LGThinQHomebridgePlatform,
    public readonly accessory: PlatformAccessory,
  ) {
    super(platform, accessory);
    const {Service: {Switch}} = this.platform;

    // An earlier test build published an extra "any burner on" switch.
    const anyBurner = this.accessory.getServiceById(Switch, 'burners');
    if (anyBurner) {
      this.accessory.removeService(anyBurner);
    }

    for (const burner of this.view.burners) {
      const service = this.accessory.getService(burner.name) || this.accessory.addService(Switch, burner.name, `burner${burner.index}`);
      this.readOnly(service, () => this.view.burners.find(b => b.index === burner.index)?.on ?? false);
      this.burnerSwitches.set(burner.index, service);
    }
  }

  protected readOnly(service, value: () => boolean) {
    const {Characteristic} = this.platform;
    service.getCharacteristic(Characteristic.On)
      .onGet(value)
      .onSet(() => {
        setTimeout(() => service.updateCharacteristic(Characteristic.On, value()), REVERT_MS);
      });
  }

  protected get view() {
    return rangeView(this.accessory.context.device.snapshot?.ovenState);
  }

  updateAccessoryCharacteristic(device) {
    super.updateAccessoryCharacteristic(device);
    if (!this.burnerSwitches) {
      return;
    }
    const {Characteristic} = this.platform;
    const view = this.view;
    for (const burner of view.burners) {
      this.burnerSwitches.get(burner.index)?.updateCharacteristic(Characteristic.On, burner.on);
    }
  }
}
