// Talk and the model switch are session actions. One account cannot flood either.
const TALK_GAP_MS = 3_000;
const TALK_WINDOW_MS = 60_000;
const TALK_PER_WINDOW = 20;
export const SWITCH_COOLDOWN_MS = 45_000;

const talkHits = new Map<string, number[]>();
let lastSwitch = 0;

/** True when this account must wait. */
export function talkLimited(accountKey: string, now = Date.now()): boolean {
  const recent = (talkHits.get(accountKey) ?? []).filter((t) => now - t <= TALK_WINDOW_MS);
  const last = recent[recent.length - 1] ?? 0;
  if (last && now - last < TALK_GAP_MS) {
    talkHits.set(accountKey, recent);
    return true;
  }
  if (recent.length >= TALK_PER_WINDOW) {
    talkHits.set(accountKey, recent);
    return true;
  }
  recent.push(now);
  talkHits.set(accountKey, recent);
  return false;
}

export function switchCooling(now = Date.now()): boolean {
  return lastSwitch > 0 && now - lastSwitch < SWITCH_COOLDOWN_MS;
}

export function markSwitch(now = Date.now()): void {
  lastSwitch = now;
}

export function resetHqLimitsForTests(): void {
  talkHits.clear();
  lastSwitch = 0;
}
