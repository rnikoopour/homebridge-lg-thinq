import {baseDevice} from '../baseDevice';
import {LGThinQHomebridgePlatform} from '../platform';
import {PlatformAccessory} from 'homebridge';
import {rangeView} from './rangeLogic';

/** Taps on the read-only switches are reverted after this long. */
const REVERT_MS = 500;

/**
 * The cooktop burners of an LG range, published as their own "Burners" accessory next
 * to the oven. Main switch: any burner on. One switch per burner, bundled under it.
 * LG does not allow controlling burners remotely, so the switches are read-only
 * (taps revert).
 */
export default class Range extends baseDevice {
  protected mainSwitch;
  protected burnerSwitches = new Map<number, ReturnType<PlatformAccessory['addService']>>();

  constructor(
    public readonly platform: LGThinQHomebridgePlatform,
    public readonly accessory: PlatformAccessory,
  ) {
    super(platform, accessory);
    const {Service: {Switch}, Characteristic} = this.platform;

    this.mainSwitch = this.accessory.getService('Burners') || this.accessory.addService(Switch, 'Burners', 'burners');
    this.mainSwitch.setPrimaryService(true);
    this.mainSwitch.setCharacteristic(Characteristic.Name, this.accessory.displayName);
    this.readOnly(this.mainSwitch, () => this.view.on);

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
    if (!this.mainSwitch) {
      return;
    }
    const {Characteristic} = this.platform;
    const view = this.view;
    this.mainSwitch.updateCharacteristic(Characteristic.On, view.on);
    for (const burner of view.burners) {
      this.burnerSwitches.get(burner.index)?.updateCharacteristic(Characteristic.On, burner.on);
    }
  }
}
