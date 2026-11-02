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
  const hours = Number(data?.remainTimeHour) || 0;
  const minutes = Number(data?.remainTimeMinute) || 0;
  const tubCleanCount = Math.min(parseInt(String(data?.TCLCount ?? 0), 10) || 0, 30);

  return {
    powerOn: isPowerOn(state),
    running,
    paused: PAUSED_STATES.includes(state ?? ''),
    error: state === 'ERROR',
    remainingSeconds: running ? hours * 3600 + minutes * 60 : 0,
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

/**
 * A program that powers off with this much time left (or less) is treated as completed:
 * some models switch off at the end without reporting END. Anything longer is a stop.
 */
export const FINISHED_POWEROFF_MAX_REMAINING_SECONDS = 60;

/**
 * "Program Finished" tracking state. `inProgram` is true from the moment a program is
 * seen running until it ends, stops or is cancelled; a pause keeps it true.
 * `lastRemainingSeconds` is the time left at the last running update.
 */
export interface ProgramTracker {
  inProgram: boolean;
  lastRemainingSeconds: number;
}

/**
 * Initialise tracking from the snapshot at startup, so a restart mid-program still
 * reports the finish and a restart after it does not report a stale one.
 */
export function initialTracker(data: WasherDryerState | null | undefined): ProgramTracker {
  const view = washerDryerView(data);
  return { inProgram: view.running || view.paused, lastRemainingSeconds: view.remainingSeconds };
}

export interface FinishStep {
  tracker: ProgramTracker;
  /** The program completed: trigger "Program Finished" (once per program). */
  finished: boolean;
  /** A new program started: clear "Program Finished". */
  started: boolean;
}

/**
 * Only a completed program counts as finished. Stopping, cancelling, powering off
 * mid-program or an error ends tracking without an alert.
 */
export function nextFinishState(tracker: ProgramTracker, current: WasherDryerState | null | undefined): FinishStep {
  const view = washerDryerView(current);
  const state = current?.state ?? '';

  if (view.running) {
    return {
      tracker: { inProgram: true, lastRemainingSeconds: view.remainingSeconds },
      finished: false,
      started: !tracker.inProgram,
    };
  }
  if (view.paused || !tracker.inProgram) {
    return { tracker, finished: false, started: false };
  }

  const completed = FINISHED_STATES.includes(state)
    || (!view.powerOn && tracker.lastRemainingSeconds <= FINISHED_POWEROFF_MAX_REMAINING_SECONDS);
  return { tracker: { inProgram: false, lastRemainingSeconds: 0 }, finished: completed, started: false };
}
