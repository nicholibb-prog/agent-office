// What the loft's two controls show, worked out from the loft API's answer (or its absence). Pure: no
// DOM, no three.js, so tests can check it. The panel and the switch/dial in the room both use it.
import { OKKIN_MODELS, normTag } from '../../../shared/okkin-loft';

export type LoftStop = { tag: string; role: string; installed?: boolean | null; allowed?: boolean; ramOk: boolean; minFreeRamGB: number | null };
export type LoftLike = {
  power: 'on' | 'off';
  powerControl: 'ready' | 'cooling' | 'no-rights' | 'not-set-up';
  powerReason: string | null;
  okkin: { chip: string; configured: string; model: string | null };
  dial: LoftStop[];
  /** False: the viewer isn't the owner; the server refuses their changes (403), so the controls say so. */
  owner?: boolean;
  /** The owner passphrase: not set up yet, locked (unlock in the panel), unlocked, or its file changed (restart). */
  ownerState?: 'not-set-up' | 'locked' | 'unlocked' | 'changed';
  bench?: Record<string, { tokensPerSec: number }>;
  mock?: boolean;
};

export type StopView = { tag: string; role: string; status: 'installed' | 'not installed' | 'unknown'; usable: boolean; note: string };
/** The status light: green on, grey off (works), amber not set up / needs rights, red can't reach Okkin. */
export type Light = 'on' | 'off' | 'setup' | 'error';
export type SwitchView = {
  light: Light;
  /** The light's tooltip. */
  tip: string;
  /** Real Okkin state; 'unknown' when the loft API didn't answer. */
  power: 'on' | 'off' | 'unknown';
  /** Whether pressing the switch does anything. Only when the real power config passed. */
  works: boolean;
  label: string;
  icon: 'on' | 'off' | 'setup';
  reason: string | null;
  /** Locked for this viewer (not the owner): shown grey. */
  locked?: boolean;
  /** The loft API said 401/403-session: the fix is to sign in again. */
  signIn?: boolean;
  /** The raw error behind `reason` (e.g. the HTTP 403 text): shown on hover or focus only. */
  detail?: string | null;
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
export const OWNER_NOT_SET_UP = 'Owner not set up — run npm run owner:set on the ProArt';
export const OWNER_FILE_CHANGED = 'Owner file changed — restart the office after a deliberate owner:set';

/** Every dial stop, never hidden: the API's list, or the five built-ins (status unknown) when it didn't answer. */
export function stopsView(d: LoftLike | null): StopView[] {
  const src: LoftStop[] = d?.dial.length ? d.dial : OKKIN_MODELS.map((m) => ({ tag: m.tag, role: m.role, ramOk: true, minFreeRamGB: 'minFreeRamGB' in m ? m.minFreeRamGB : null }));
  const on = d?.power === 'on';
  return src.map((s) => {
    const status = !d || s.installed === undefined || s.installed === null ? 'unknown' : s.installed ? 'installed' : 'not installed';
    const owner = d?.owner !== false;
    const allowed = s.allowed !== false;
    const usable = owner && on && status === 'installed' && allowed && s.ramOk;
    const note =
      !owner && d ? (d.ownerState === 'not-set-up' ? 'Owner not set up' : OWNER_ONLY)
      : status === 'not installed' ? 'Not installed'
      : status === 'unknown' ? (d ? 'Okkin is off · can\'t check' : 'Can\'t reach Okkin')
      : !allowed ? 'Installed · not on the allowlist'
      : !s.ramOk ? `Needs ${s.minFreeRamGB} GB free RAM`
      : on ? 'Press Enter to switch' : POWER_ON_FIRST;
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
    if (apiStatus === 401) return { power: 'unknown', works: false, label: 'Sign in again', icon: 'setup', light: 'error', tip: 'Sign in again', reason: 'Your office session ended. Sign in again to use the switch.', signIn: true, detail: apiError };
    const reason = apiError && /\b403\b/.test(apiError) ? "Okkin refused this office's address" : apiError ? "Okkin's loft didn't answer" : 'The loft did not answer.';
    return { power: 'unknown', works: false, label: "Can't reach Okkin", icon: 'setup', light: 'error', tip: `Can't reach Okkin: ${reason}`, reason, detail: apiError };
  }
  const on = d.power === 'on';
  // Not the owner: a locked switch, grey (never green), whatever the power is.
  if (d.ownerState === 'not-set-up') return { power: d.power, works: false, locked: true, label: 'Owner not set up', icon: on ? 'on' : 'off', light: on ? 'on' : 'off', tip: OWNER_NOT_SET_UP, reason: OWNER_NOT_SET_UP };
  if (d.ownerState === 'changed') return { power: d.power, works: false, locked: true, label: OWNER_ONLY, icon: on ? 'on' : 'off', light: on ? 'on' : 'off', tip: OWNER_FILE_CHANGED, reason: OWNER_FILE_CHANGED };
  if (d.owner === false) return { power: d.power, works: false, locked: true, label: OWNER_ONLY, icon: on ? 'on' : 'off', light: on ? 'on' : 'off', tip: OWNER_ONLY, reason: 'Owner only: unlock with the owner passphrase below to switch Okkin.' };
  const c = d.powerControl;
  if (c === 'ready') return { power: d.power, works: true, label: on ? 'Turn off' : 'Turn on', icon: on ? 'on' : 'off', light: on ? 'on' : 'off', tip: on ? 'Okkin is on' : 'Okkin is off', reason: null };
  if (c === 'cooling') return { power: d.power, works: false, label: 'Cooling down…', icon: on ? 'on' : 'off', light: on ? 'on' : 'off', tip: 'Cooling down', reason: 'Wait a minute: the switch cools down between flips.' };
  if (c === 'no-rights') return { power: d.power, works: false, label: 'Power control needs rights', icon: 'setup', light: on ? 'on' : 'setup', tip: 'Power control needs rights', reason: powerReasonText(d.powerReason) };
  // One line under the switch: what's locked and what the operator does about it.
  // While Okkin is on the light stays green: amber only means 'off and the switch can't turn it on'.
  return { power: d.power, works: false, label: 'Not set up', icon: 'setup', light: on ? 'on' : 'setup', tip: 'Power switch locked', reason: powerReasonText(d.powerReason) };
}

/** A model's benchmark, matched by normalised tag; mock data says so. Not installed: no number. */
export function benchText(d: LoftLike | null, s: StopView): string {
  if (s.status === 'not installed') return 'not installed';
  const b = d?.bench ? Object.entries(d.bench).find(([k]) => normTag(k) === normTag(s.tag))?.[1] : undefined;
  if (!b || !(b.tokensPerSec > 0)) return 'not measured yet';
  return `${b.tokensPerSec} tok/s${d?.mock ? ' (mock)' : s.status === 'unknown' ? ' · earlier this session' : ''}`;
}

/** What Okkin last said, from the loft data (the in-memory Ask thread); never invented. */
export type CrtSource = { text: string; at: number; model: string | null } | null;
export type CrtView = { mode: 'off' | 'idle' | 'live'; lines: string[]; mock: boolean };
export const CRT_IDLE = 'okkin idle · waiting for a question';
export const CRT_COLS = 34;
export const CRT_ROWS = 6;

/** The CRT beside the console: dark when off, an honest idle line with no output, else the latest output's tail. */
export function crtView(d: (LoftLike & { crt?: CrtSource }) | null): CrtView {
  const mock = !!d?.mock;
  if (!d || d.power !== 'on') return { mode: 'off', lines: [], mock };
  const text = d.crt?.text?.replace(/\s+/g, ' ').trim();
  if (!text) return { mode: 'idle', lines: [CRT_IDLE], mock };
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const word = w.length > CRT_COLS ? `${w.slice(0, CRT_COLS - 1)}…` : w;
    if ((cur ? cur.length + 1 : 0) + word.length > CRT_COLS) { lines.push(cur); cur = word; } else cur = cur ? `${cur} ${word}` : word;
  }
  if (cur) lines.push(cur);
  return { mode: 'live', lines: [`> ${d.crt!.model ?? 'okkin'}`, ...lines.slice(-(CRT_ROWS - 1))], mock };
}

/** The hologram's data: real tok/s and the loaded model only while Okkin is on; '—' otherwise. */
export function holoData(d: (LoftLike & { speed?: { tokensPerSec: number } | null; loaded?: { name: string }[] }) | null): { tps: number | null; model: string | null; mock: boolean } | null {
  if (!d) return null;
  if (d.power !== 'on') return { tps: null, model: null, mock: !!d.mock };
  return { tps: d.speed?.tokensPerSec ?? null, model: d.loaded?.[0]?.name ?? null, mock: !!d.mock };
}

/** The Ask box: ONE hint when it can't send (shown once, below the box); the placeholder never repeats it. */
export function askView(on: boolean, owner: boolean): { placeholder: string; hint: string | null } {
  return { placeholder: 'Ask Okkin', hint: !owner ? OWNER_ONLY : on ? null : POWER_ON_FIRST };
}
