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

/** States in which no wash/dry program is actively running. */
export const NOT_RUNNING_STATES = ['COOLDOWN', 'POWEROFF', 'POWERFAIL', 'INITIAL', 'PAUSE', 'AUDIBLE_DIAGNOSIS', 'FIRMWARE',
  'COURSE_DOWNLOAD', 'ERROR', 'END'];

/** Paused programs resume, so a pause is not the end of a program. */
const PAUSED_STATES = ['PAUSE'];

/** The washerDryer (or washer) section of a ThinQ snapshot. Fields are optional: LG sends partial updates. */
export interface WasherDryerState {
  state?: string;
  remainTimeHour?: number;
  remainTimeMinute?: number;
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
    error: state === 'ERROR',
    remainingSeconds: running ? remainingSeconds(data) : 0,
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

/** States that mean a program completed: washer END, dryer COOLDOWN (anti-wrinkle). */
export const FINISHED_STATES = ['END', 'COOLDOWN'];

/** Map washer/dryer status to the shared program-tracking model. */
export function washerDryerProgramStatus(data: WasherDryerState | null | undefined): ProgramStatus {
  const view = washerDryerView(data);
  return {
    powerOn: view.powerOn,
    running: view.running,
    paused: view.paused,
    completed: FINISHED_STATES.includes(data?.state ?? ''),
    remainingSeconds: view.remainingSeconds,
  };
}

export function initialTracker(data: WasherDryerState | null | undefined): ProgramTracker {
  return initialProgramTracker(washerDryerProgramStatus(data));
}

export function nextFinishState(tracker: ProgramTracker, current: WasherDryerState | null | undefined): ProgramStep {
  return nextProgramStep(tracker, washerDryerProgramStatus(current));
}
