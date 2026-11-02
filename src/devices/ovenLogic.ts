/**
 * Pure oven logic: LG ThinQ ovenState in, plain values and command payloads out.
 * No HomeKit or network code here, so every rule can be unit tested directly.
 */

/** The fields of LG's ovenState this plugin reads. LG sends partial updates, so all are optional. */
export interface OvenState {
  upperState?: string;
  upperManualCookName?: string;
  upperCurrentTemperatureUnit?: string;
  upperCurrentTemperatureValue?: number;
  upperTargetTemperatureValue?: number;
  upperCurrentProveTemperatureF?: number;
  upperTargetProveTemperatureF?: number;
  upperDoorOpen?: string;
  upperRemoteStart?: string;
  upperCookAndWarmStatus?: string;
  burnerOnCounter?: number;
  [key: string]: unknown;
}

export const OVEN_MODES = ['BAKE', 'CONVECTION_BAKE', 'CONVECTION_ROST', 'FROZEN_MEAL', 'AIR_FRY', 'AIR_SOUSVIDE', 'WARM'] as const;
export type OvenMode = typeof OVEN_MODES[number];

/** Declared HomeKit ranges (Celsius) for the oven and probe thermostats. */
export const OVEN_TARGET_RANGE = { min: 38, max: 218 };
export const PROBE_TARGET_RANGE = { min: 38, max: 285 };
export const OVEN_CURRENT_RANGE = { min: 0, max: 218 };
/** Shown when the oven reports no temperature (it is off). */
export const IDLE_TEMPERATURE_C = 22;

export function fToC(f: number): number {
  return 0.5 * Math.round(2 * (f - 32) / 1.8);
}

export function cToF(c: number): number {
  return Math.round(c * 1.8 + 32);
}

export function isFahrenheit(data: OvenState | null | undefined): boolean {
  return String(data?.upperCurrentTemperatureUnit ?? '').includes('FAH');
}

/** LG temperature in the oven's unit -> Celsius, rounded to 0.5. */
function toCelsius(value: number, fahrenheit: boolean): number {
  return fahrenheit ? fToC(value) : 0.5 * Math.round(2 * value);
}

function clamp(value: number, range: { min: number; max: number }): number {
  return Math.min(Math.max(value, range.min), range.max);
}

const num = (value: unknown) => Number(value) || 0;

export interface OvenView {
  /** The oven cavity is on (anything but INITIAL). */
  ovenOn: boolean;
  /** The oven or any burner is on. */
  rangeOn: boolean;
  /** The mode the oven is cooking in, or null when it is not cooking. */
  cookingMode: string | null;
  currentTemperatureC: number;
  targetTemperatureC: number;
  heating: boolean;
  targetHeat: boolean;
  probeInserted: boolean;
  probeCurrentTemperatureC: number;
  probeTargetTemperatureC: number;
  probeTargetSet: boolean;
  doorOpen: boolean;
  remoteStartEnabled: boolean;
  /** Keep Warm after cooking; null when the model does not report it. */
  keepWarm: boolean | null;
  burnersOn: number;
}

export function ovenView(data: OvenState | null | undefined): OvenView {
  const fahrenheit = isFahrenheit(data);
  const current = num(data?.upperCurrentTemperatureValue);
  const target = num(data?.upperTargetTemperatureValue);
  const probeCurrent = num(data?.upperCurrentProveTemperatureF);
  const probeTarget = num(data?.upperTargetProveTemperatureF);
  const burnersOn = num(data?.burnerOnCounter);
  const state = String(data?.upperState ?? '');
  const ovenOn = state !== '' && !state.includes('INITIAL');
  const cookName = String(data?.upperManualCookName ?? '');

  // No current reading: use the target while on (preheating), otherwise room temperature.
  let currentTemperatureC = IDLE_TEMPERATURE_C;
  if (current !== 0) {
    currentTemperatureC = toCelsius(current, fahrenheit);
  } else if (ovenOn && target !== 0) {
    currentTemperatureC = toCelsius(target, fahrenheit);
  }
  currentTemperatureC = clamp(currentTemperatureC, OVEN_CURRENT_RANGE);

  return {
    ovenOn,
    rangeOn: ovenOn || burnersOn > 0,
    cookingMode: ovenOn && cookName !== '' && cookName !== 'NONE' ? cookName : null,
    currentTemperatureC,
    targetTemperatureC: clamp(target !== 0 ? toCelsius(target, fahrenheit) : OVEN_TARGET_RANGE.min, OVEN_TARGET_RANGE),
    heating: current !== 0,
    targetHeat: target !== 0,
    probeInserted: probeCurrent !== 0,
    probeCurrentTemperatureC: probeCurrent !== 0 ? fToC(probeCurrent) : IDLE_TEMPERATURE_C,
    probeTargetTemperatureC: clamp(probeTarget !== 0 ? fToC(probeTarget) : PROBE_TARGET_RANGE.min, PROBE_TARGET_RANGE),
    probeTargetSet: probeTarget !== 0,
    doorOpen: !String(data?.upperDoorOpen ?? 'DISABLE').includes('DIS'),
    remoteStartEnabled: !String(data?.upperRemoteStart ?? 'DISABLE').includes('DIS'),
    keepWarm: data && 'upperCookAndWarmStatus' in data ? !String(data.upperCookAndWarmStatus ?? '').includes('DIS') : null,
    burnersOn,
  };
}

/** Which mode switch shows as on: the mode being cooked, otherwise the one selected for the next start. */
export function activeModeSwitch(view: OvenView, selectedMode: OvenMode | null): string | null {
  return view.cookingMode ?? selectedMode;
}

/** Allowed target temperature per mode, in the oven's unit. */
export function temperatureRange(mode: OvenMode, fahrenheit: boolean): { min: number; max: number } | null {
  switch (mode) {
    case 'CONVECTION_BAKE':
    case 'CONVECTION_ROST':
    case 'FROZEN_MEAL':
    case 'AIR_FRY':
      return fahrenheit ? { min: 300, max: 550 } : { min: 150, max: 285 };
    case 'BAKE':
      return fahrenheit ? { min: 170, max: 550 } : { min: 80, max: 285 };
    case 'AIR_SOUSVIDE':
      return fahrenheit ? { min: 100, max: 205 } : { min: 38, max: 96 };
    case 'WARM':
      return null; // no temperature
  }
}

/** What the user has chosen in HomeKit for the next start. */
export interface CookSelection {
  mode: OvenMode | null;
  /** Target temperature in Celsius, or null for the default. */
  temperatureC: number | null;
  /** Probe target in Celsius, or null for none. */
  probeTemperatureC: number | null;
  durationSeconds: number | null;
  keepWarm: boolean;
}

export const DEFAULT_SELECTION: CookSelection = { mode: null, temperatureC: null, probeTemperatureC: null, durationSeconds: null, keepWarm: false };
const DEFAULT_TEMPERATURE = { fahrenheit: 350, celsius: 175 };
const DEFAULT_DURATION_SECONDS = 1800;

/** The ovenState values sent with SetCookStart. */
export function cookStartPayload(selection: CookSelection, fahrenheit: boolean): Record<string, string | number> {
  const mode: OvenMode = selection.mode ?? 'BAKE';
  const range = temperatureRange(mode, fahrenheit);
  const toUnit = (c: number) => fahrenheit ? cToF(c) : Math.round(c);

  let temperature = 0;
  if (range) {
    const requested = selection.temperatureC !== null
      ? toUnit(selection.temperatureC)
      : (fahrenheit ? DEFAULT_TEMPERATURE.fahrenheit : DEFAULT_TEMPERATURE.celsius);
    temperature = clamp(requested, range);
  }
  const duration = mode === 'WARM' ? 0 : (selection.durationSeconds || DEFAULT_DURATION_SECONDS);

  return {
    cmdOptionContentsType: 'REMOTE_COOK_START',
    cmdOptionDataLength: 'REMOTE_COOK_START',
    cmdOptionSetCookAndWarm: mode !== 'WARM' && selection.keepWarm ? 'ENABLE' : 'DISABLE',
    cmdOptionSetCookName: mode,
    cmdOptionSetMyRecipeCookNumber: 0,
    cmdOptionSetSteamLevel: '',
    cmdOptionSetSubCookNumber: 0,
    cmdOptionSetTargetTemperatureUnit: fahrenheit ? 'FAHRENHEIT' : 'CELSIUS',
    cmdOptionSetTargetTimeHour: Math.floor(duration / 3600),
    cmdOptionSetTargetTimeMinute: Math.floor(duration % 3600 / 60),
    cmdOptionSetRapidPreheat: 'OFF',
    setTargetProveTemperature: mode !== 'WARM' && selection.probeTemperatureC !== null ? toUnit(selection.probeTemperatureC) : 0,
    setTargetTemperature: temperature,
  };
}

export const COOK_STOP_PAYLOAD = { cmdOptionCookStop: 'UPPER' };

/** Commands are blocked when the oven has remote start disabled or HomeKit monitor-only is on. */
export function commandsAllowed(view: OvenView, monitorOnly: boolean): boolean {
  return view.remoteStartEnabled && !monitorOnly;
}
