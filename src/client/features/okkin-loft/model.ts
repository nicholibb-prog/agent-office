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
};

/** Every dial stop, never hidden: the API's list, or the five built-ins (status unknown) when it didn't answer. */
export function stopsView(d: LoftLike | null): StopView[] {
  const src: LoftStop[] = d?.dial.length ? d.dial : OKKIN_MODELS.map((m) => ({ tag: m.tag, role: m.role, ramOk: true, minFreeRamGB: 'minFreeRamGB' in m ? m.minFreeRamGB : null }));
  const on = d?.power === 'on';
  return src.map((s) => {
    const status = !d || s.installed === undefined ? 'unknown' : s.installed ? 'installed' : 'not installed';
    const usable = on && status === 'installed' && s.ramOk;
    const note = status === 'not installed' ? 'Not installed' : status === 'unknown' ? 'Status unknown' : !s.ramOk ? `Needs ${s.minFreeRamGB} GB free RAM` : on ? 'Press Enter to switch' : 'Turn power on to load';
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

export function switchView(d: LoftLike | null, apiError: string | null = null): SwitchView {
  if (!d) return { power: 'unknown', works: false, label: 'Not set up', icon: 'setup', reason: apiError ?? 'The loft did not answer.' };
  const on = d.power === 'on';
  const c = d.powerControl;
  if (c === 'ready') return { power: d.power, works: true, label: on ? 'Turn off' : 'Turn on', icon: on ? 'on' : 'off', reason: null };
  if (c === 'cooling') return { power: d.power, works: false, label: 'Cooling down…', icon: on ? 'on' : 'off', reason: null };
  if (c === 'no-rights') return { power: d.power, works: false, label: 'Power control needs rights', icon: 'setup', reason: d.powerReason };
  return { power: d.power, works: false, label: 'Not set up', icon: 'setup', reason: d.powerReason ?? 'No okkin-power.json yet.' };
}
