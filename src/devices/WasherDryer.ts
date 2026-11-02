import {baseDevice} from '../baseDevice';
import {LGThinQHomebridgePlatform} from '../platform';
import {CharacteristicValue, PlatformAccessory} from 'homebridge';
import {Device} from '../lib/Device';
import {PlatformType} from '../lib/constants';
import {DeviceModel} from '../lib/DeviceModel';
import {
  NOT_RUNNING_STATES,
  hasFault,
  ProgramTracker,
  initialTracker,
  isDeviceOnline,
  isDoorLocked,
  nextFinishState,
  washerDryerView,
} from './washerDryerLogic';

/** @deprecated use NOT_RUNNING_STATES from './washerDryerLogic' */
export const NOT_RUNNING_STATUS = NOT_RUNNING_STATES;

/** How long "Program Finished" stays triggered before resetting. */
const FINISHED_RESET_MS = 10 * 60 * 1000;

/**
 * HomeKit wiring for washers, dryers and wash towers. All status rules live in
 * ./washerDryerLogic (pure, unit tested); this class only maps them to services.
 */
export default class WasherDryer extends baseDevice {
  /** Program Finished tracking; see nextFinishState(). */
  protected tracker: ProgramTracker;
  protected finishedResetTimer?: ReturnType<typeof setTimeout>;

  protected serviceWasherDryer;
  protected serviceEventFinished;
  protected serviceDoorLock;
  protected serviceTubCleanMaintenance;

  constructor(
    public readonly platform: LGThinQHomebridgePlatform,
    public readonly accessory: PlatformAccessory,
  ) {
    super(platform, accessory);

    const {
      Service: {
        OccupancySensor,
        LockMechanism,
        Valve,
      },
      Characteristic,
      Characteristic: {
        LockCurrentState,
      },
    } = this.platform;

    const device: Device = accessory.context.device;

    // A restart mid-program must still report the finish; a restart after it must not.
    this.tracker = initialTracker(this.Status.data);

    this.serviceWasherDryer = accessory.getService(Valve);
    if (!this.serviceWasherDryer) {
      this.serviceWasherDryer = accessory.addService(Valve, device.name, device.name);
    }

    this.serviceWasherDryer.getCharacteristic(Characteristic.Active)
      .onSet(this.setActive.bind(this))
      .updateValue(Characteristic.Active.INACTIVE);
    this.serviceWasherDryer.setCharacteristic(Characteristic.Name, device.name);
    this.serviceWasherDryer.setCharacteristic(Characteristic.ValveType, Characteristic.ValveType.WATER_FAUCET);
    this.serviceWasherDryer.setCharacteristic(Characteristic.InUse, Characteristic.InUse.NOT_IN_USE);
    this.serviceWasherDryer.getCharacteristic(Characteristic.RemainingDuration).setProps({
      maxValue: 86400, // 1 day
    });
    // Total program length; the Home app uses it with RemainingDuration for the countdown.
    this.serviceWasherDryer.getCharacteristic(Characteristic.SetDuration).setProps({
      maxValue: 86400,
    });

    // only thinq2 support door lock status
    this.serviceDoorLock = accessory.getService(LockMechanism);
    if (this.config.washer_door_lock && device.platform === PlatformType.ThinQ2 && 'doorLock' in (this.Status.data ?? {})) {
      if (!this.serviceDoorLock) {
        this.serviceDoorLock = accessory.addService(LockMechanism, device.name + ' - Door');
      }

      this.serviceDoorLock.getCharacteristic(Characteristic.LockCurrentState)
        .updateValue(LockCurrentState.UNSECURED)
        .onSet(this.setActive.bind(this))
        .setProps({
          minValue: 0,
          maxValue: 3,
          validValues: [LockCurrentState.UNSECURED, LockCurrentState.SECURED],
        });
      this.serviceDoorLock.getCharacteristic(Characteristic.LockTargetState)
        .onSet(this.setActive.bind(this))
        .updateValue(Characteristic.LockTargetState.UNSECURED);
    } else if (this.serviceDoorLock) {
      accessory.removeService(this.serviceDoorLock);
    }

    this.serviceEventFinished = accessory.getService('Program Finished');
    if (this.config.washer_trigger as boolean) {
      if (!this.serviceEventFinished) {
        this.serviceEventFinished = accessory.addService(OccupancySensor, 'Program Finished', 'Program Finished');
      }

      this.serviceEventFinished.setCharacteristic(Characteristic.Name, 'Program Finished');
      this.serviceEventFinished.updateCharacteristic(Characteristic.OccupancyDetected, Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
    } else if (this.serviceEventFinished) {
      accessory.removeService(this.serviceEventFinished);
    }

    // tub clean coach
    this.serviceTubCleanMaintenance = accessory.getService('Tub Clean Coach');
    if (this.config.washer_tub_clean as boolean) {
      if (!this.serviceTubCleanMaintenance) {
        this.serviceTubCleanMaintenance = accessory.addService(OccupancySensor, 'Tub Clean Coach', 'Tub Clean Coach');
      }

      this.serviceTubCleanMaintenance.setCharacteristic(Characteristic.Name, 'Tub Clean Coach');
      this.serviceTubCleanMaintenance.updateCharacteristic(Characteristic.OccupancyDetected,
        Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
    } else if (this.serviceTubCleanMaintenance) {
      accessory.removeService(this.serviceTubCleanMaintenance);
    }
  }

  public get Status() {
    return new WasherDryerStatus(this.accessory.context.device.snapshot?.washerDryer, this.accessory.context.device.deviceModel);
  }

  public get config() {
    return Object.assign({}, {
      washer_trigger: false,
      washer_door_lock: false,
      washer_tub_clean: false,
    }, super.config);
  }

  async setActive(_value: CharacteristicValue) {
    // read only: revert to the reported state
    this.updateAccessoryCharacteristic(this.accessory.context.device);
  }

  public updateAccessoryCharacteristic(device: Device) {
    super.updateAccessoryCharacteristic(device);

    const {Characteristic} = this.platform;
    const view = washerDryerView(this.Status.data);
    const online = isDeviceOnline({online: device.data?.online, snapshot: device.snapshot});

    this.serviceWasherDryer.updateCharacteristic(Characteristic.Active, view.powerOn ? 1 : 0);
    this.serviceWasherDryer.updateCharacteristic(Characteristic.InUse, view.running ? 1 : 0);
    if (this.serviceWasherDryer.getCharacteristic(Characteristic.RemainingDuration).value !== view.remainingSeconds) {
      this.serviceWasherDryer.updateCharacteristic(Characteristic.RemainingDuration, view.remainingSeconds);
    }
    if (view.programSeconds > 0) {
      this.serviceWasherDryer.updateCharacteristic(Characteristic.SetDuration, view.programSeconds);
    }
    this.serviceWasherDryer.updateCharacteristic(Characteristic.StatusFault,
      hasFault(view, online) ? Characteristic.StatusFault.GENERAL_FAULT : Characteristic.StatusFault.NO_FAULT);

    if (this.config.washer_door_lock && this.serviceDoorLock) {
      const locked = this.Status.isDoorLocked;
      this.serviceDoorLock.updateCharacteristic(Characteristic.LockCurrentState,
        locked ? Characteristic.LockCurrentState.SECURED : Characteristic.LockCurrentState.UNSECURED);
      this.serviceDoorLock.updateCharacteristic(Characteristic.LockTargetState, locked ? 1 : 0);
    }
  }

  public update(snapshot) {
    super.update(snapshot);

    if (!snapshot?.washerDryer) {
      return;
    }

    const {Characteristic: {OccupancyDetected}} = this.platform;

    if (this.config.washer_trigger as boolean && this.serviceEventFinished) {
      const step = nextFinishState(this.tracker, this.Status.data);
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

    if (this.serviceTubCleanMaintenance && 'TCLCount' in snapshot.washerDryer) {
      this.serviceTubCleanMaintenance.updateCharacteristic(OccupancyDetected, washerDryerView(this.Status.data).tubCleanDue
        ? OccupancyDetected.OCCUPANCY_DETECTED : OccupancyDetected.OCCUPANCY_NOT_DETECTED);
    }
  }
}

/** Status accessors over the pure logic; kept for WasherDryer2 and the dishwasher. */
export class WasherDryerStatus {
  // Untyped LG payload: subclasses (DishwasherStatus) read device-specific fields.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(public data: any, protected deviceModel: DeviceModel) {
  }

  public get isPowerOn() {
    return washerDryerView(this.data).powerOn;
  }

  public get isRunning() {
    return washerDryerView(this.data).running;
  }

  public get isError() {
    return washerDryerView(this.data).error;
  }

  public get isRemoteStartEnable() {
    return this.data?.remoteStart === this.deviceModel.lookupMonitorName('remoteStart', '@CP_ON_EN_W');
  }

  public get isDoorLocked() {
    return isDoorLocked(this.data, this.deviceModel.lookupMonitorName('doorLock', '@CP_ON_EN_W'));
  }

  public get remainDuration() {
    return washerDryerView(this.data).remainingSeconds;
  }

  public get TCLCount() {
    return washerDryerView(this.data).tubCleanCount;
  }
}
