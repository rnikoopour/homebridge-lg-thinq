/**
 * Pure cooktop burner logic: LG ThinQ ovenState in, burner states out.
 * LG reports each burner as cooktop<N>CooktopState ('INIT' when off).
 */

/** Burner names by LG cooktop number. */
export const BURNER_NAMES: Record<number, string> = {
  1: 'Front Left',
  2: 'Back Left',
  3: 'Center',
  4: 'Front Right',
  5: 'Back Right',
};

export interface Burner {
  index: number;
  name: string;
  on: boolean;
}

export interface RangeView {
  /** Any burner is on. */
  on: boolean;
  /** The burners this model reports, in cooktop order. */
  burners: Burner[];
}

export function burnerOn(state: unknown): boolean {
  return typeof state === 'string' && state !== '' && state !== 'INIT';
}

export function rangeView(data: Record<string, unknown> | null | undefined): RangeView {
  const burners: Burner[] = [];
  for (const index of Object.keys(BURNER_NAMES).map(Number)) {
    const key = `cooktop${index}CooktopState`;
    if (data && key in data) {
      burners.push({index, name: BURNER_NAMES[index], on: burnerOn(data[key])});
    }
  }
  const counter = Number(data?.burnerOnCounter) || 0;
  return {on: burners.some(b => b.on) || counter > 0, burners};
}
