import {
  ProgramStatus,
  ProgramStep,
  ProgramTracker,
  initialProgramTracker,
  nextProgramStep,
  remainingSeconds,
} from './programTracking';

export {ProgramTracker} from './programTracking';

/**
 * Pure washer/dryer logic: LG ThinQ status in, plain values out. No HomeKit or
 * network code here, so every rule can be unit tested directly.
 */

/*
 * State names come from LG's washer/dryer device models (e.g. a front-load washer:
 * POWEROFF INITIAL PAUSE DETECTING ADD_DRAIN DETERGENT_AMOUNT RESERVED PREWASH RUNNING
 * RINSING RINSEHOLD SPINNING DRYING END REFRESHING ERROR_AUTO_OFF FROZEN_PREVENT_*
 * AUDIBLE_DIAGNOSIS AUTO_DT_OPEN_PAUSE CONFIRM_START_FOR_CONTROL; a WashTower dryer:
 * POWEROFF INITIAL RUNNING PAUSE END ERROR AUDIBLE_DIAGNOSIS DRYING COOLING WRINKLECARE).
 * Any state not listed below is part of a running program.
 */

/** The program completed. After END, WRINKLECARE/REFRESHING tumble occasionally until opened. */
export const COMPLETED_STATES = ['END', 'COOLDOWN', 'WRINKLECARE', 'REFRESHING'];

/** A program that is paused or waiting for the user; it will resume. */
export const PAUSED_STATES = ['PAUSE', 'RINSEHOLD', 'AUTO_DT_OPEN_PAUSE'];

/** On, but no program is running: idle, delayed start, maintenance (freeze prevention), errors. */
export const IDLE_STATES = ['INITIAL', 'RESERVED', 'CONFIRM_START_FOR_CONTROL', 'AUDIBLE_DIAGNOSIS', 'FIRMWARE', 'COURSE_DOWNLOAD',
  'FROZEN_PREVENT_INITIAL', 'FROZEN_PREVENT_PAUSE', 'FROZEN_PREVENT_RUNNING', 'ERROR', 'ERROR_AUTO_OFF'];

/** States in which no wash/dry program is actively running. */
export const NOT_RUNNING_STATES = ['POWEROFF', 'POWERFAIL', ...COMPLETED_STATES, ...PAUSED_STATES, ...IDLE_STATES];

/** The washerDryer (or washer) section of a ThinQ snapshot. Fields are optional: LG sends partial updates. */
export interface WasherDryerState {
  state?: string;
  remainTimeHour?: number;
  remainTimeMinute?: number;
  initialTimeHour?: number;
  initialTimeMinute?: number;
  doorLock?: string;
  TCLCount?: number | string;
  [key: string]: unknown;
}

export interface WasherDryerView {
  powerOn: boolean;
  running: boolean;
  paused: boolean;
  error: boolean;
  /** Seconds left in the running program; 0 when not running. */
  remainingSeconds: number;
  /** Total length of the current program; 0 when unknown or not running. */
  programSeconds: number;
  /** Tub clean coach counter, capped at 30. */
  tubCleanCount: number;
  tubCleanDue: boolean;
}

/** An unknown (missing) state is treated as off, never as running. */
export function isPowerOn(state?: string): boolean {
  return typeof state === 'string' && state !== '' && !['POWEROFF', 'POWERFAIL'].includes(state);
}

export function isRunning(state?: string): boolean {
  return isPowerOn(state) && !NOT_RUNNING_STATES.includes(state as string);
}

export function washerDryerView(data: WasherDryerState | null | undefined): WasherDryerView {
  const state = data?.state;
  const running = isRunning(state);
  const tubCleanCount = Math.min(parseInt(String(data?.TCLCount ?? 0), 10) || 0, 30);

  return {
    powerOn: isPowerOn(state),
    running,
    paused: PAUSED_STATES.includes(state ?? ''),
    error: (state ?? '').startsWith('ERROR'),
    remainingSeconds: running ? remainingSeconds(data) : 0,
    programSeconds: running
      ? Math.max((Number(data?.initialTimeHour) || 0) * 3600 + (Number(data?.initialTimeMinute) || 0) * 60, remainingSeconds(data))
      : 0,
    tubCleanCount,
    tubCleanDue: tubCleanCount >= 30,
  };
}

/**
 * Whether LG currently reports the appliance online. Live updates carry
 * `snapshot.online`, which wins over the flag from the initial device list.
 */
export function isDeviceOnline(device: { online?: boolean; snapshot?: { online?: unknown } | null } | null | undefined): boolean {
  const live = device?.snapshot?.online;
  if (typeof live === 'boolean') {
    return live;
  }
  return device?.online !== false;
}

/**
 * HomeKit fault flag: set for an appliance error or when LG reports it offline.
 * Power/running state are unaffected, so an offline machine still shows as off.
 */
export function hasFault(view: WasherDryerView, online: boolean): boolean {
  return view.error || !online;
}

/**
 * Door lock state. `lockedValue` is the device model's value for "locked" (null when
 * the model has no mapping, in which case LG's DOORLOCK_ON is used).
 */
export function isDoorLocked(data: WasherDryerState | null | undefined, lockedValue: string | null): boolean {
  return data?.doorLock === (lockedValue ?? 'DOORLOCK_ON');
}

/** @deprecated use COMPLETED_STATES */
export const FINISHED_STATES = COMPLETED_STATES;

/** Map washer/dryer status to the shared program-tracking model. */
export function washerDryerProgramStatus(data: WasherDryerState | null | undefined): ProgramStatus {
  const view = washerDryerView(data);
  return {
    powerOn: view.powerOn,
    running: view.running,
    paused: view.paused,
    completed: COMPLETED_STATES.includes(data?.state ?? ''),
    remainingSeconds: view.remainingSeconds,
  };
}

export function initialTracker(data: WasherDryerState | null | undefined): ProgramTracker {
  return initialProgramTracker(washerDryerProgramStatus(data));
}

export function nextFinishState(tracker: ProgramTracker, current: WasherDryerState | null | undefined): ProgramStep {
  return nextProgramStep(tracker, washerDryerProgramStatus(current));
}
