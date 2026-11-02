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
