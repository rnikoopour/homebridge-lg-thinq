/**
 * Pure "Program Finished" tracking shared by appliances that run programs (washer,
 * dryer, dishwasher). Each appliance maps its LG status to a ProgramStatus; the rules
 * for when a program counts as finished live here once.
 */

/** What an appliance's status means for program tracking. */
export interface ProgramStatus {
  powerOn: boolean;
  running: boolean;
  paused: boolean;
  /** The appliance reports that the program completed (e.g. END, dryer COOLDOWN). */
  completed: boolean;
  /** Seconds left in the running program; 0 when not running. */
  remainingSeconds: number;
}

/**
 * A program that powers off with this much time left (or less) is treated as completed:
 * some models switch off at the end without reporting completion. Anything longer is a stop.
 */
export const FINISHED_POWEROFF_MAX_REMAINING_SECONDS = 60;

/**
 * `inProgram` is true from the moment a program is seen running until it ends, stops or
 * is cancelled; a pause keeps it true. `lastRemainingSeconds` is the time left at the
 * last running update.
 */
export interface ProgramTracker {
  inProgram: boolean;
  lastRemainingSeconds: number;
}

/**
 * Initialise tracking from the status at startup, so a restart mid-program still
 * reports the finish and a restart after it does not report a stale one.
 */
export function initialProgramTracker(status: ProgramStatus): ProgramTracker {
  return { inProgram: status.running || status.paused, lastRemainingSeconds: status.remainingSeconds };
}

export interface ProgramStep {
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
export function nextProgramStep(tracker: ProgramTracker, status: ProgramStatus): ProgramStep {
  if (status.running) {
    return {
      tracker: { inProgram: true, lastRemainingSeconds: status.remainingSeconds },
      finished: false,
      started: !tracker.inProgram,
    };
  }
  if (status.paused || !tracker.inProgram) {
    return { tracker, finished: false, started: false };
  }

  const finished = status.completed
    || (!status.powerOn && tracker.lastRemainingSeconds <= FINISHED_POWEROFF_MAX_REMAINING_SECONDS);
  return { tracker: { inProgram: false, lastRemainingSeconds: 0 }, finished, started: false };
}

/** Remaining time from LG's hour/minute fields. */
export function remainingSeconds(data: { remainTimeHour?: unknown; remainTimeMinute?: unknown } | null | undefined): number {
  return (Number(data?.remainTimeHour) || 0) * 3600 + (Number(data?.remainTimeMinute) || 0) * 60;
}
