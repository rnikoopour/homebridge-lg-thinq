import {baseDevice} from '../baseDevice';
import {LGThinQHomebridgePlatform} from '../platform';
import {PlatformAccessory} from 'homebridge';
import {rangeView} from './rangeLogic';

/** Taps on the read-only switch are reverted after this long. */
const REVERT_MS = 500;

/**
 * The cooktop of an LG range, published as its own "Burners" accessory next to the
 * oven: one switch that is on while any burner is on. LG does not report which
 * physical burner is on (see rangeLogic), and does not allow controlling burners
 * remotely, so the switch is read-only (taps revert).
 */
export default class Range extends baseDevice {
  protected burnersSwitch;

  constructor(
    public readonly platform: LGThinQHomebridgePlatform,
    public readonly accessory: PlatformAccessory,
  ) {
    super(platform, accessory);
    const {Service: {Switch}, Characteristic} = this.platform;

    // Earlier test builds published one switch per LG cooktop slot (and an "any burner" switch).
    for (const service of [...this.accessory.services]) {
      if (service.UUID === Switch.UUID && service.subtype !== 'burners-any') {
        this.accessory.removeService(service);
      }
    }

    this.burnersSwitch = this.accessory.getServiceById(Switch, 'burners-any')
      || this.accessory.addService(Switch, this.accessory.displayName, 'burners-any');
    this.burnersSwitch.setPrimaryService(true);
    this.burnersSwitch.setCharacteristic(Characteristic.Name, this.accessory.displayName);
    this.burnersSwitch.getCharacteristic(Characteristic.On)
      .onGet(() => this.view.on)
      .onSet(() => {
        setTimeout(() => this.burnersSwitch.updateCharacteristic(Characteristic.On, this.view.on), REVERT_MS);
      });
  }

  protected get view() {
    return rangeView(this.accessory.context.device.snapshot?.ovenState);
  }

  updateAccessoryCharacteristic(device) {
    super.updateAccessoryCharacteristic(device);
    if (!this.burnersSwitch) {
      return;
    }
    this.burnersSwitch.updateCharacteristic(this.platform.Characteristic.On, this.view.on);
  }
}
