/**
 * Detects an MQTT connection that is still open but no longer delivers updates.
 * The backup poll shows a device's state changing; if MQTT delivered nothing for
 * that device over the same interval, several polls in a row, the connection is
 * treated as dead and reconnected. Pure: the caller supplies the clock.
 */

/** Consecutive polls that must show missed updates before reconnecting. */
export const STALE_POLLS_BEFORE_RECONNECT = 3;

/** Never force a reconnect more often than this. */
export const MIN_RECONNECT_INTERVAL_MS = 30 * 60 * 1000;

/** Snapshot fields that change without the device's state changing. */
const VOLATILE_FIELDS = new Set(['timestamp', 'meta', 'mid']);

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map(key => JSON.stringify(key) + ':' + stableStringify((value as Record<string, unknown>)[key]))
      .join(',') + '}';
  }
  return JSON.stringify(value) ?? 'undefined';
}

/** A comparable form of a device's reported state, ignoring bookkeeping fields. */
export function stateFingerprint(snapshot: unknown): string {
  if (!snapshot || typeof snapshot !== 'object') {
    return '';
  }
  const state = Object.fromEntries(Object.entries(snapshot).filter(([key]) => !VOLATILE_FIELDS.has(key)));
  return stableStringify(state);
}

export interface PolledDevice {
  id: string;
  snapshot: unknown;
}

export class MqttWatchdog {
  private readonly fingerprints = new Map<string, string>();
  private readonly lastMessageAt = new Map<string, number>();
  private lastPollAt: number | null = null;
  private stalePolls = 0;
  private lastReconnectAt = -Infinity;

  /** Record an MQTT message for a device. */
  messageReceived(deviceId: string, now: number) {
    this.lastMessageAt.set(deviceId, now);
  }

  /** Record a poll result; returns true when MQTT should be reconnected now. */
  observePoll(devices: PolledDevice[], now: number): boolean {
    const previousPollAt = this.lastPollAt;
    let missed = false;

    for (const device of devices) {
      const fingerprint = stateFingerprint(device.snapshot);
      const previous = this.fingerprints.get(device.id);
      this.fingerprints.set(device.id, fingerprint);

      const changed = previous !== undefined && previous !== fingerprint;
      const heardSincePreviousPoll = (this.lastMessageAt.get(device.id) ?? -Infinity) >= (previousPollAt ?? Infinity);
      if (previousPollAt !== null && changed && !heardSincePreviousPoll) {
        missed = true;
      }
    }

    this.lastPollAt = now;
    this.stalePolls = missed ? this.stalePolls + 1 : 0;

    if (this.stalePolls >= STALE_POLLS_BEFORE_RECONNECT && now - this.lastReconnectAt >= MIN_RECONNECT_INTERVAL_MS) {
      this.stalePolls = 0;
      this.lastReconnectAt = now;
      return true;
    }
    return false;
  }
}
