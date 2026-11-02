/**
 * Pure dishwasher logic for "Program Finished" tracking. Wash phases (rinse, dry) are
 * reported in `process`; `state` stays RUNNING for the whole program.
 */
import {ProgramStatus, ProgramStep, ProgramTracker, initialProgramTracker, nextProgramStep, remainingSeconds} from './programTracking';

/** The model's values for the states that matter (looked up from the LG device model). */
export interface DishwasherStateValues {
  running: string;
  paused: string;
  completed: string;
}

export const DEFAULT_DISHWASHER_STATE_VALUES: DishwasherStateValues = {running: 'RUNNING', paused: 'PAUSE', completed: 'END'};

/** States meaning the dishwasher is off; STANDBY maps to "power off" in LG's models. */
const OFF_STATES = ['POWEROFF', 'POWERFAIL', 'STANDBY'];

export interface DishwasherData {
  state?: string;
  remainTimeHour?: number;
  remainTimeMinute?: number;
  [key: string]: unknown;
}

export function dishwasherProgramStatus(data: DishwasherData | null | undefined,
  values: DishwasherStateValues = DEFAULT_DISHWASHER_STATE_VALUES): ProgramStatus {
  const state = data?.state;
  const powerOn = typeof state === 'string' && state !== '' && !OFF_STATES.includes(state);
  const running = powerOn && state === values.running;
  return {
    powerOn,
    running,
    paused: powerOn && state === values.paused,
    completed: state === values.completed,
    remainingSeconds: running ? remainingSeconds(data) : 0,
  };
}

export function initialDishwasherTracker(data: DishwasherData | null | undefined, values?: DishwasherStateValues): ProgramTracker {
  return initialProgramTracker(dishwasherProgramStatus(data, values));
}

export function nextDishwasherStep(tracker: ProgramTracker, data: DishwasherData | null | undefined,
  values?: DishwasherStateValues): ProgramStep {
  return nextProgramStep(tracker, dishwasherProgramStatus(data, values));
}

export interface DishwasherDisplayData extends DishwasherData {
  door?: string;
  rinseLevel?: string;
  delayStart?: string;
  process?: string;
  initialTimeHour?: number;
  initialTimeMinute?: number;
}

/** Rinse aid level: LG only reports it reliably while running; otherwise keep the last known level. */
export function rinseLevelFor(data: DishwasherDisplayData | null | undefined, lastLevel: string,
  values: DishwasherStateValues = DEFAULT_DISHWASHER_STATE_VALUES): string {
  return data?.state === values.running ? (data.rinseLevel || 'LEVEL_1') : lastLevel;
}

export function rinseLevelPercent(level: string): number {
  if (level === 'LEVEL_0') {
    return 0;
  }
  return level === 'LEVEL_1' ? 50 : 100;
}

export interface DishwasherView {
  powerOn: boolean;
  /** Valve Active: on with time left on a program. */
  active: boolean;
  /** Valve InUse: running, excluding a delayed start that has not begun. */
  inUse: boolean;
  remainingSeconds: number;
  /** Total program length; null when the dishwasher is off (keep the last value). */
  setDurationSeconds: number | null;
  doorClosed: boolean;
  rinseLevel: string;
  rinsePercent: number;
  rinseLow: boolean;
}

export function dishwasherView(data: DishwasherDisplayData | null | undefined, options: {
  values?: DishwasherStateValues;
  doorClosedValue?: string | null;
  lastRinseLevel: string;
}): DishwasherView {
  const values = options.values ?? DEFAULT_DISHWASHER_STATE_VALUES;
  const status = dishwasherProgramStatus(data, values);
  const delayedStart = data?.delayStart === 'ON' && String(data?.process ?? '').includes('RESER');
  const rinseLevel = rinseLevelFor(data, options.lastRinseLevel, values);

  return {
    powerOn: status.powerOn,
    active: status.powerOn && status.remainingSeconds > 0,
    inUse: status.running && !delayedStart,
    remainingSeconds: status.remainingSeconds,
    setDurationSeconds: status.powerOn
      ? (Number(data?.initialTimeHour) || 0) * 3600 + (Number(data?.initialTimeMinute) || 0) * 60
      : null,
    doorClosed: data?.door === (options.doorClosedValue ?? 'CLOSE'),
    rinseLevel,
    rinsePercent: rinseLevelPercent(rinseLevel),
    rinseLow: rinseLevel === 'LEVEL_0',
  };
}
