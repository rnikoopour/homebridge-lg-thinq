/**
 * Special thank to carlosgamezvillegas (https://github.com/carlosgamezvillegas) for the initial work on the Oven device.
 */

import {baseDevice} from '../baseDevice';
import {LGThinQHomebridgePlatform} from '../platform';
import {CharacteristicValue, PlatformAccessory} from 'homebridge';
import {DeviceModel} from '../lib/DeviceModel';
import {
  COOK_STOP_PAYLOAD,
  CookSelection,
  DEFAULT_SELECTION,
  OVEN_MODES,
  OVEN_TARGET_RANGE,
  OvenMode,
  OvenState,
  PROBE_TARGET_RANGE,
  activeModeSwitch,
  commandsAllowed,
  cookStartPayload,
  isFahrenheit,
  ovenView,
} from './ovenLogic';

/** Mode switches: service name, subtype and LG cook name. Names/subtypes must not change (HomeKit identity). */
const MODE_SWITCHES: { name: string; subtype: string; mode: OvenMode }[] = [
  {name: 'Bake Mode', subtype: 'CataNicoGaTa-80', mode: 'BAKE'},
  {name: 'Convection Bake Mode', subtype: 'CataNicoGaTa-Control1', mode: 'CONVECTION_BAKE'},
  {name: 'Convection Roast Mode', subtype: 'CataNicoGaTa-Control2', mode: 'CONVECTION_ROST'},
  {name: 'Frozen Meal Mode', subtype: 'CataNicoGaTa-Control3', mode: 'FROZEN_MEAL'},
  {name: 'Air Fry Mode', subtype: 'CataNicoGaTa-Control4', mode: 'AIR_FRY'},
  {name: 'Air Sousvide Mode', subtype: 'CataNicoGaTa-Control5', mode: 'AIR_SOUSVIDE'},
  {name: 'Proof-Warm Mode', subtype: 'CataNicoGaTa-Control5W', mode: 'WARM'},
];

/** Momentary switches (Start/Stop) turn themselves back off after this long. */
const MOMENTARY_RESET_MS = 1000;
const HUMIDITY = 50;

/**
 * HomeKit wiring for ovens/ranges. All status rules and command payloads live in
 * ./ovenLogic (pure, unit tested); this class only maps them to services:
 * - Thermostat "Oven" (main tile) and "Probe Temperature Control"
 * - Switches: cooking modes (select the mode for the next start), Start, Stop,
 *   Monitor Only (blocks commands), Keep Warm (when the model reports it)
 * - Sensors: door, remote control enabled (cooktop burners: see Range.ts)
 */
export default class Oven extends baseDevice {
  /** What the user selected in HomeKit for the next start. */
  protected selection: CookSelection = {...DEFAULT_SELECTION};
  /** HomeKit Monitor Only switch: commands are blocked while on (default on, as before). */
  protected monitorOnly = true;
  protected commandInFlight = false;

  protected ovenTempControl;
  protected probeTempControl;
  protected modeSwitches = new Map<OvenMode, ReturnType<PlatformAccessory['addService']>>();
  protected startSwitch;
  protected stopSwitch;
  protected monitorOnlySwitch;
  protected keepWarmSwitch;
  protected doorSensor;
  protected remoteEnabledSensor;

  constructor(
    public readonly platform: LGThinQHomebridgePlatform,
    public readonly accessory: PlatformAccessory,
  ) {
    super(platform, accessory);
    const {Service, Characteristic} = this.platform;

    // Earlier versions published a Television service with status text inputs and timer valves,
    // and the cooktop parts that now live on the separate "Burners" accessory.
    for (const service of [...this.accessory.services]) {
      if ([Service.Television.UUID, Service.InputSource.UUID, Service.Valve.UUID].includes(service.UUID)
        || ['Range is Cooking', 'Number of Burners in Use'].includes(service.displayName)) {
        this.accessory.removeService(service);
      }
    }

    // Main tile: oven thermostat
    this.ovenTempControl = this.serviceFor(Service.Thermostat, 'Oven Temperature Control', 'NicoCataGaTa-OvenTC');
    this.ovenTempControl.setPrimaryService(true);
    this.ovenTempControl.setCharacteristic(Characteristic.Name, this.accessory.context.device.name);
    this.ovenTempControl.setCharacteristic(Characteristic.TemperatureDisplayUnits, Characteristic.TemperatureDisplayUnits.FAHRENHEIT);
    this.ovenTempControl.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
      .onGet(() => this.view.heating ? Characteristic.CurrentHeatingCoolingState.HEAT : Characteristic.CurrentHeatingCoolingState.OFF);
    this.ovenTempControl.getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .setProps({validValues: [Characteristic.TargetHeatingCoolingState.OFF, Characteristic.TargetHeatingCoolingState.HEAT]})
      .onGet(() => this.view.targetHeat ? Characteristic.TargetHeatingCoolingState.HEAT : Characteristic.TargetHeatingCoolingState.OFF)
      .onSet((value) => {
        if (value === Characteristic.TargetHeatingCoolingState.OFF) {
          this.stop();
        }
      });
    this.ovenTempControl.getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({minValue: 0, maxValue: OVEN_TARGET_RANGE.max, minStep: 0.5})
      .onGet(() => this.view.currentTemperatureC);
    this.ovenTempControl.getCharacteristic(Characteristic.TargetTemperature)
      // HAP's default (10) is below our minimum: move it into range before narrowing the props.
      .updateValue(OVEN_TARGET_RANGE.min)
      .setProps({minValue: OVEN_TARGET_RANGE.min, maxValue: OVEN_TARGET_RANGE.max, minStep: 0.5})
      .onGet(() => this.view.targetTemperatureC)
      .onSet((value) => {
        this.selection.temperatureC = Number(value);
      });
    this.ovenTempControl.getCharacteristic(Characteristic.CurrentRelativeHumidity).onGet(() => HUMIDITY);

    // Probe thermostat
    this.probeTempControl = this.serviceFor(Service.Thermostat, 'Probe Temperature Control', 'NicoCataGaTa-OvenTCP2');
    this.probeTempControl.setCharacteristic(Characteristic.TemperatureDisplayUnits, Characteristic.TemperatureDisplayUnits.FAHRENHEIT);
    this.probeTempControl.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
      .onGet(() => this.view.probeInserted ? Characteristic.CurrentHeatingCoolingState.HEAT : Characteristic.CurrentHeatingCoolingState.OFF);
    this.probeTempControl.getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .setProps({validValues: [Characteristic.TargetHeatingCoolingState.OFF, Characteristic.TargetHeatingCoolingState.HEAT]})
      .onGet(() => this.view.probeTargetSet ? Characteristic.TargetHeatingCoolingState.HEAT : Characteristic.TargetHeatingCoolingState.OFF);
    this.probeTempControl.getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({minValue: 0, maxValue: PROBE_TARGET_RANGE.max, minStep: 0.1})
      .onGet(() => this.view.probeCurrentTemperatureC);
    this.probeTempControl.getCharacteristic(Characteristic.TargetTemperature)
      .updateValue(PROBE_TARGET_RANGE.min)
      .setProps({minValue: PROBE_TARGET_RANGE.min, maxValue: PROBE_TARGET_RANGE.max, minStep: 0.1})
      .onGet(() => this.view.probeTargetTemperatureC)
      .onSet((value) => {
        this.selection.probeTemperatureC = Number(value);
      });
    this.probeTempControl.getCharacteristic(Characteristic.CurrentRelativeHumidity).onGet(() => HUMIDITY);

    // Mode selection switches
    for (const {name, subtype, mode} of MODE_SWITCHES) {
      const service = this.serviceFor(Service.Switch, name, subtype);
      service.getCharacteristic(Characteristic.On)
        .onGet(() => this.activeMode === mode)
        .onSet((value) => this.selectMode(mode, value));
      this.modeSwitches.set(mode, service);
    }

    this.startSwitch = this.momentarySwitch('Start Oven', 'CataNicoGaTa-Control8', () => this.start());
    this.stopSwitch = this.momentarySwitch('Stop Oven', 'CataNicoGaTa-Control6', () => this.stop());

    this.monitorOnlySwitch = this.serviceFor(Service.Switch, 'Monitor Only Mode', 'CataNicoGaTa-Control7');
    this.monitorOnlySwitch.getCharacteristic(Characteristic.On)
      .onGet(() => !commandsAllowed(this.view, this.monitorOnly))
      .onSet((value) => {
        this.monitorOnly = Boolean(value);
      });

    if (this.view.keepWarm !== null) {
      this.keepWarmSwitch = this.serviceFor(Service.Switch, 'Keep Warm', 'CataNicoGaTa-Control9');
      this.keepWarmSwitch.getCharacteristic(Characteristic.On)
        .onGet(() => this.view.cookingMode ? Boolean(this.view.keepWarm) : this.selection.keepWarm)
        .onSet((value) => {
          this.selection.keepWarm = Boolean(value);
        });
    }

    // Sensors
    this.doorSensor = this.serviceFor(Service.ContactSensor, 'Oven Door', 'NicoCataGaTa-OvenTCBCS');
    this.remoteEnabledSensor = this.serviceFor(Service.ContactSensor, 'Remote Control Enabled', 'NicoCataGaTa-OvenTCRCS');

    this.updateAccessoryCharacteristic(this.accessory.context.device);
  }

  /** Existing service by name (as cached), or a new one with the given subtype. */
  protected serviceFor(type, name: string, subtype: string) {
    return this.accessory.getService(name) || this.accessory.addService(type, name, subtype);
  }

  protected momentarySwitch(name: string, subtype: string, action: () => void) {
    const {Characteristic} = this.platform;
    const service = this.serviceFor(this.platform.Service.Switch, name, subtype);
    service.getCharacteristic(Characteristic.On)
      .onGet(() => false)
      .onSet((value) => {
        if (value) {
          action();
          setTimeout(() => service.updateCharacteristic(Characteristic.On, false), MOMENTARY_RESET_MS);
        }
      });
    return service;
  }

  protected get view() {
    return ovenView(this.Status.data);
  }

  protected get activeMode() {
    return activeModeSwitch(this.view, this.selection.mode);
  }

  protected selectMode(mode: OvenMode, on: CharacteristicValue) {
    if (on) {
      this.selection.mode = mode;
    } else if (this.selection.mode === mode) {
      this.selection.mode = null;
    }
    this.updateModeSwitches();
  }

  protected updateModeSwitches() {
    const active = this.activeMode;
    for (const mode of OVEN_MODES) {
      this.modeSwitches.get(mode)?.updateCharacteristic(this.platform.Characteristic.On, active === mode);
    }
  }

  /** Send a command unless blocked (monitor only / remote start disabled) or one was just sent. */
  protected sendCommand(ctrlKey: string, ovenState: Record<string, string | number>) {
    if (!commandsAllowed(this.view, this.monitorOnly)) {
      this.platform.log.info(`[${this.accessory.context.device.name}] ${ctrlKey} ignored: monitor only or remote start disabled`);
      return;
    }
    if (this.commandInFlight) {
      return;
    }
    this.commandInFlight = true;
    setTimeout(() => {
      this.commandInFlight = false;
    }, MOMENTARY_RESET_MS);

    this.platform.log.debug(`[${this.accessory.context.device.name}] ${ctrlKey}: ${JSON.stringify(ovenState)}`);
    this.platform.ThinQ?.deviceControl(this.accessory.context.device.id, {
      dataKey: null,
      dataValue: null,
      dataSetList: {ovenState},
      dataGetList: null,
    }, 'Set', ctrlKey);
  }

  protected start() {
    this.sendCommand('SetCookStart', cookStartPayload(this.selection, isFahrenheit(this.Status.data)));
  }

  protected stop() {
    this.sendCommand('SetCookStop', COOK_STOP_PAYLOAD);
  }

  public get Status() {
    return new OvenStatus(this.accessory.context.device.snapshot?.ovenState, this.accessory.context.device.deviceModel);
  }

  get config() {
    return Object.assign({}, {
      oven_trigger: false,
    }, super.config);
  }

  updateAccessoryCharacteristic(device) {
    super.updateAccessoryCharacteristic(device);
    if (!this.ovenTempControl) {
      return; // called by the base constructor before services exist
    }
    const {Characteristic} = this.platform;
    const view = this.view;

    this.ovenTempControl.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, view.heating ? 1 : 0);
    this.ovenTempControl.updateCharacteristic(Characteristic.TargetHeatingCoolingState, view.targetHeat ? 1 : 0);
    this.ovenTempControl.updateCharacteristic(Characteristic.CurrentTemperature, view.currentTemperatureC);
    this.ovenTempControl.updateCharacteristic(Characteristic.TargetTemperature, view.targetTemperatureC);

    this.probeTempControl.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, view.probeInserted ? 1 : 0);
    this.probeTempControl.updateCharacteristic(Characteristic.TargetHeatingCoolingState, view.probeTargetSet ? 1 : 0);
    this.probeTempControl.updateCharacteristic(Characteristic.CurrentTemperature, view.probeCurrentTemperatureC);
    this.probeTempControl.updateCharacteristic(Characteristic.TargetTemperature, view.probeTargetTemperatureC);

    this.updateModeSwitches();
    this.monitorOnlySwitch.updateCharacteristic(Characteristic.On, !commandsAllowed(view, this.monitorOnly));
    if (this.keepWarmSwitch) {
      this.keepWarmSwitch.updateCharacteristic(Characteristic.On, view.cookingMode ? Boolean(view.keepWarm) : this.selection.keepWarm);
    }

    this.doorSensor.updateCharacteristic(Characteristic.ContactSensorState, view.doorOpen ? 1 : 0);
    this.doorSensor.updateCharacteristic(Characteristic.StatusActive, view.ovenOn);
    this.remoteEnabledSensor.updateCharacteristic(Characteristic.ContactSensorState, view.remoteStartEnabled ? 1 : 0);
    this.remoteEnabledSensor.updateCharacteristic(Characteristic.StatusActive, view.ovenOn);
  }
}

export class OvenStatus {
  constructor(public data: OvenState, protected deviceModel: DeviceModel) {}

  getState(key) {
    return this.data?.[key + 'State'];
  }
}
