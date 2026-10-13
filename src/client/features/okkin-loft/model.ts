// What the loft's two controls show, worked out from the loft API's answer (or its absence). Pure: no
// DOM, no three.js, so tests can check it. The panel and the switch/dial in the room both use it.
import { OKKIN_MODELS } from '../../../shared/okkin-loft';

export type LoftStop = { tag: string; role: string; installed?: boolean; ramOk: boolean; minFreeRamGB: number | null };
export type LoftLike = {
  power: 'on' | 'off';
  powerControl: 'ready' | 'cooling' | 'no-rights' | 'not-set-up';
  powerReason: string | null;
  okkin: { chip: string; configured: string; model: string | null };
  dial: LoftStop[];
  /** False: the viewer isn't the owner; the server refuses their changes (403), so the controls say so. */
  owner?: boolean;
};

export type StopView = { tag: string; role: string; status: 'installed' | 'not installed' | 'unknown'; usable: boolean; note: string };
export type SwitchView = {
  /** Real Okkin state; 'unknown' when the loft API didn't answer. */
  power: 'on' | 'off' | 'unknown';
  /** Whether pressing the switch does anything. Only when the real power config passed. */
  works: boolean;
  label: string;
  icon: 'on' | 'off' | 'setup';
  reason: string | null;
  /** The loft API said 401/403-session: the fix is to sign in again. */
  signIn?: boolean;
};

/** The server's short powerReason, said so an operator knows what to do. Never a silent grey switch. */
export function powerReasonText(reason: string | null | undefined): string {
  const r = (reason ?? '').trim();
  if (/ACL not verified on Windows/i.test(r)) return 'Power switch locked: operator must verify okkin-power.json ACL and set AO_OKKIN_POWER_WINDOWS_ACL_OK=1 (docs/hq.md)';
  if (!r || /not set up/i.test(r)) return 'Power switch locked: no okkin-power.json yet (operator sets it up; see docs/hq.md)';
  return `Power switch locked: ${r}`;
}

/** Said on the dial and the Ask box while the power is off. */
export const POWER_ON_FIRST = 'Turn power on first';
export const OWNER_ONLY = 'Owner only';

/** Every dial stop, never hidden: the API's list, or the five built-ins (status unknown) when it didn't answer. */
export function stopsView(d: LoftLike | null): StopView[] {
  const src: LoftStop[] = d?.dial.length ? d.dial : OKKIN_MODELS.map((m) => ({ tag: m.tag, role: m.role, ramOk: true, minFreeRamGB: 'minFreeRamGB' in m ? m.minFreeRamGB : null }));
  const on = d?.power === 'on';
  return src.map((s) => {
    const status = !d || s.installed === undefined ? 'unknown' : s.installed ? 'installed' : 'not installed';
    const owner = d?.owner !== false;
    const usable = owner && on && status === 'installed' && s.ramOk;
    const note = !owner && d ? OWNER_ONLY : status === 'not installed' ? 'Not installed' : status === 'unknown' ? 'Status unknown' : !s.ramOk ? `Needs ${s.minFreeRamGB} GB free RAM` : on ? 'Press Enter to switch' : POWER_ON_FIRST;
    return { tag: s.tag, role: s.role, status, usable, note };
  });
}

/** The chosen stop: the loaded model, else the configured one, else the default role. */
export function chosenIndex(d: LoftLike | null, stops: StopView[]): number {
  const want = d?.okkin.model ?? d?.okkin.configured ?? '';
  const i = stops.findIndex((s) => s.tag === want);
  if (i >= 0) return i;
  return Math.max(0, stops.findIndex((s) => s.role === 'default'));
}

export function switchView(d: LoftLike | null, apiError: string | null = null, apiStatus: number | null = null): SwitchView {
  if (!d) {
    // The loft API didn't answer for us: a lapsed session (401) is its own state, with its own fix.
    if (apiStatus === 401) return { power: 'unknown', works: false, label: 'Sign in again', icon: 'setup', reason: 'Your office session ended. Sign in again to use the switch.', signIn: true };
    return { power: 'unknown', works: false, label: "Can't reach Okkin", icon: 'setup', reason: apiError ?? 'The loft did not answer.' };
  }
  const on = d.power === 'on';
  if (d.owner === false) return { power: d.power, works: false, label: OWNER_ONLY, icon: on ? 'on' : 'off', reason: 'Owner only: you can watch Okkin; only the owner can switch it.' };
  const c = d.powerControl;
  if (c === 'ready') return { power: d.power, works: true, label: on ? 'Turn off' : 'Turn on', icon: on ? 'on' : 'off', reason: null };
  if (c === 'cooling') return { power: d.power, works: false, label: 'Cooling down…', icon: on ? 'on' : 'off', reason: 'Wait a minute: the switch cools down between flips.' };
  if (c === 'no-rights') return { power: d.power, works: false, label: 'Power control needs rights', icon: 'setup', reason: powerReasonText(d.powerReason) };
  return { power: d.power, works: false, label: 'Not set up', icon: 'setup', reason: powerReasonText(d.powerReason) };
}
