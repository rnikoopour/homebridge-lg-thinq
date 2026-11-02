import {baseDevice} from '../baseDevice';
import {LGThinQHomebridgePlatform} from '../platform';
import {PlatformAccessory} from 'homebridge';
import {Device} from '../lib/Device';
import {WasherDryerStatus} from './WasherDryer';
import {ProgramTracker} from './programTracking';
import {
  DEFAULT_DISHWASHER_STATE_VALUES,
  DishwasherStateValues,
  dishwasherView,
  initialDishwasherTracker,
  nextDishwasherStep,
} from './dishwasherLogic';

/** How long "Program Finished" stays triggered before resetting. */
const FINISHED_RESET_MS = 10 * 60 * 1000;

/**
 * HomeKit wiring for dishwashers. All status rules live in ./dishwasherLogic and
 * ./programTracking (pure, unit tested); this class only maps them to services:
 * - Valve (main tile): on, running, time left, program length, rinse-aid fault
 * - Contact sensor: door, with rinse-aid level as its battery level
 * - Occupancy sensor (optional): Program Finished
 */
export default class Dishwasher extends baseDevice {
  /** Program Finished tracking; see programTracking. */
  protected tracker: ProgramTracker;
  protected finishedResetTimer?: ReturnType<typeof setTimeout>;
  /** LG reports the rinse aid level reliably only while running; keep the last value. */
  protected rinseLevel = 'LEVEL_2';
  protected setDurationSeconds = 0;

  protected serviceDishwasher;
  protected serviceDoorOpened;
  protected serviceEventFinished;

  constructor(
    public readonly platform: LGThinQHomebridgePlatform,
    public readonly accessory: PlatformAccessory,
  ) {
    super(platform, accessory);

    const {
      Service: {Valve, ContactSensor, OccupancySensor},
      Characteristic,
    } = this.platform;
    const device: Device = accessory.context.device;

    // Earlier versions published a Television service with status text inputs.
    for (const service of [...this.accessory.services]) {
      if (service.UUID === this.platform.Service.Television.UUID || service.UUID === this.platform.Service.InputSource.UUID) {
        this.accessory.removeService(service);
      }
    }

    this.serviceDishwasher = accessory.getService(Valve) || accessory.addService(Valve, 'LG Dishwasher');
    this.serviceDishwasher.setPrimaryService(true);
    this.serviceDishwasher.setCharacteristic(Characteristic.Name, device.name);
    // Same faucet-type valve as the washer and dryer.
    this.serviceDishwasher.setCharacteristic(Characteristic.ValveType, Characteristic.ValveType.WATER_FAUCET);
    this.serviceDishwasher.getCharacteristic(Characteristic.Active)
      .onSet(() => this.updateAccessoryCharacteristic(this.accessory.context.device)) // read only
      .onGet(() => this.view.active ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE);
    this.serviceDishwasher.getCharacteristic(Characteristic.InUse)
      .onGet(() => this.view.inUse ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE);
    this.serviceDishwasher.getCharacteristic(Characteristic.StatusFault)
      .onGet(() => this.view.rinseLow ? Characteristic.StatusFault.GENERAL_FAULT : Characteristic.StatusFault.NO_FAULT);
    this.serviceDishwasher.getCharacteristic(Characteristic.RemainingDuration)
      .setProps({maxValue: 86400 / 4})
      .onGet(() => this.view.remainingSeconds);
    this.serviceDishwasher.getCharacteristic(Characteristic.SetDuration)
      .setProps({maxValue: 86400 / 4})
      .onGet(() => this.currentSetDuration());

    this.serviceDoorOpened = accessory.getService(ContactSensor) || accessory.addService(ContactSensor, 'Dishwasher Door');
    this.serviceDoorOpened.getCharacteristic(Characteristic.ContactSensorState)
      .onGet(() => this.view.doorClosed
        ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
    this.serviceDoorOpened.getCharacteristic(Characteristic.StatusActive)
      .onGet(() => this.view.powerOn);
    this.serviceDoorOpened.getCharacteristic(Characteristic.BatteryLevel)
      .onGet(() => this.view.rinsePercent);
    this.serviceDoorOpened.getCharacteristic(Characteristic.StatusLowBattery)
      .onGet(() => this.view.rinseLow
        ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);

    this.serviceEventFinished = accessory.getService(OccupancySensor);
    if (this.config.dishwasher_trigger as boolean) {
      this.serviceEventFinished = this.serviceEventFinished || accessory.addService(OccupancySensor, device.name + ' - Program Finished');
      this.serviceEventFinished.updateCharacteristic(Characteristic.OccupancyDetected, Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
    } else if (this.serviceEventFinished) {
      accessory.removeService(this.serviceEventFinished);
    }

    // A restart mid-program must still report the finish; a restart after it must not.
    this.tracker = initialDishwasherTracker(this.Status.data, this.stateValues);
  }

  /** This model's values for the running/paused/completed states. */
  protected get stateValues(): DishwasherStateValues {
    const model = this.accessory.context.device.deviceModel;
    const lookup = (label: string, fallback: string) => model?.lookupMonitorName('state', label) ?? fallback;
    return {
      running: lookup('@DW_STATE_RUNNING_W', DEFAULT_DISHWASHER_STATE_VALUES.running),
      paused: lookup('@DW_STATE_PAUSE_W', DEFAULT_DISHWASHER_STATE_VALUES.paused),
      completed: lookup('@DW_STATE_COMPLETE_W', DEFAULT_DISHWASHER_STATE_VALUES.completed),
    };
  }

  protected get view() {
    return dishwasherView(this.Status.data, {
      values: this.stateValues,
      doorClosedValue: this.accessory.context.device.deviceModel?.lookupMonitorName('door', '@CP_OFF_EN_W'),
      lastRinseLevel: this.rinseLevel,
    });
  }

  /** Program length while on; the last known value while off. */
  protected currentSetDuration() {
    const seconds = this.view.setDurationSeconds;
    if (seconds !== null) {
      this.setDurationSeconds = seconds;
    }
    return this.setDurationSeconds;
  }

  public get Status() {
    return new DishwasherStatus(this.accessory.context.device.snapshot?.dishwasher, this.accessory.context.device.deviceModel);
  }

  public get config() {
    return Object.assign({}, {
      dishwasher_trigger: false,
    }, super.config);
  }

  public updateAccessoryCharacteristic(device: Device) {
    super.updateAccessoryCharacteristic(device);
    const {Characteristic} = this.platform;
    const view = this.view;
    this.rinseLevel = view.rinseLevel;

    this.serviceDishwasher.updateCharacteristic(Characteristic.Active, view.active ? 1 : 0);
    this.serviceDishwasher.updateCharacteristic(Characteristic.InUse, view.inUse ? 1 : 0);
    this.serviceDishwasher.updateCharacteristic(Characteristic.RemainingDuration, view.remainingSeconds);
    this.serviceDishwasher.updateCharacteristic(Characteristic.SetDuration, this.currentSetDuration());
    this.serviceDishwasher.updateCharacteristic(Characteristic.StatusFault, view.rinseLow ? 1 : 0);

    this.serviceDoorOpened.updateCharacteristic(Characteristic.ContactSensorState, view.doorClosed
      ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
    this.serviceDoorOpened.updateCharacteristic(Characteristic.StatusActive, view.powerOn);
    this.serviceDoorOpened.updateCharacteristic(Characteristic.BatteryLevel, view.rinsePercent);
    this.serviceDoorOpened.updateCharacteristic(Characteristic.StatusLowBattery, view.rinseLow ? 1 : 0);
  }

  public update(snapshot) {
    super.update(snapshot);

    if (!snapshot?.dishwasher || !(this.config.dishwasher_trigger as boolean) || !this.serviceEventFinished) {
      return;
    }

    const {Characteristic: {OccupancyDetected}} = this.platform;
    const step = nextDishwasherStep(this.tracker, this.Status.data, this.stateValues);
    this.tracker = step.tracker;

    if (step.finished) {
      this.serviceEventFinished.updateCharacteristic(OccupancyDetected, OccupancyDetected.OCCUPANCY_DETECTED);
      clearTimeout(this.finishedResetTimer);
      this.finishedResetTimer = setTimeout(() => {
        this.serviceEventFinished.updateCharacteristic(OccupancyDetected, OccupancyDetected.OCCUPANCY_NOT_DETECTED);
      }, FINISHED_RESET_MS);
    }
    if (step.started) {
      clearTimeout(this.finishedResetTimer);
      this.serviceEventFinished.updateCharacteristic(OccupancyDetected, OccupancyDetected.OCCUPANCY_NOT_DETECTED);
    }
  }
}

export class DishwasherStatus extends WasherDryerStatus {
  public get isRunning() {
    return this.isPowerOn && this.data?.state === this.deviceModel.lookupMonitorName('state', '@DW_STATE_RUNNING_W');
  }

  public get isDoorClosed() {
    return this.data?.door === this.deviceModel.lookupMonitorName('door', '@CP_OFF_EN_W');
  }
}
