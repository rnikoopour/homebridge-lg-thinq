/**
 * Pure cooktop burner logic: LG ThinQ ovenState in, "any burner on" out.
 *
 * LG reports cooktop<N>CooktopState ('INIT' when off) and burnerOnCounter, but the
 * numbers are not burner positions: on a real range, different physical burners were
 * each reported as cooktop1 (slots appear to be filled in the order burners are turned
 * on). So only "any burner on" and the count are reliable.
 */

export interface RangeView {
  /** Any burner is on. */
  on: boolean;
  /** How many burners are on. */
  burnersOn: number;
}

export function burnerOn(state: unknown): boolean {
  return typeof state === 'string' && state !== '' && state !== 'INIT';
}

export function rangeView(data: Record<string, unknown> | null | undefined): RangeView {
  let slotsOn = 0;
  for (let index = 1; index <= 5; index++) {
    if (burnerOn(data?.[`cooktop${index}CooktopState`])) {
      slotsOn++;
    }
  }
  const counter = Number(data?.burnerOnCounter) || 0;
  const burnersOn = Math.max(slotsOn, counter);
  return {on: burnersOn > 0, burnersOn};
}
