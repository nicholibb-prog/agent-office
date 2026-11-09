// Okkin's loft power switch. ON starts the local Ollama service and loads the chosen model;
// OFF unloads every model and stops the service. The start and stop commands are a FIXED argv pair
// from a server-side file (`<dataDir>/okkin-power.json`, under the gitignored .agent-office/). This
// module ships with no real commands: the file does not exist until an operator writes it, and a
// placeholder (`<...>`) argv counts as not set up.
//
// Request input is only the enum 'start' | 'stop'. Nothing from a request reaches argv or env.
// Children run with execFile/spawn and shell: false, never through a shell, never elevated.
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export const POWER_FILE = 'okkin-power.json';
export const POWER_LOG = 'okkin-power.log';
export const POWER_COOLDOWN_MS = 60_000;
/** The only address Ollama may listen on. Pinned in the child's env. */
export const PINNED_OLLAMA_HOST = '127.0.0.1:11434';

export type PowerAction = 'start' | 'stop';
export type Tuning = { num_ctx?: number; num_gpu?: number; keep_alive?: string | number };
export type PowerConfig = { start: string[]; stop: string[]; tuning: Tuning; scriptSha256?: string; scriptPath?: string };
export type PowerLoad = { ok: true; config: PowerConfig } | { ok: false; reason: string };

/** Programs and words that would elevate or hand the argv to a shell. Any of them disables the switch. */
const FORBIDDEN = /^(sudo|doas|pkexec|su|runas|gsudo|sc|sc\.exe|cmd|cmd\.exe|sh|bash|zsh|dash|powershell|powershell\.exe|pwsh|pwsh\.exe|wscript|cscript|env)$/i;
const FORBIDDEN_ARG = /(-verb\s*runas|^-?verb$|^runas$|[;&|`$<>\n\r])/i;

export function parseAction(value: unknown): PowerAction | null {
  return value === 'start' || value === 'stop' ? value : null;
}

function argvOk(argv: unknown): argv is string[] {
  if (!Array.isArray(argv) || argv.length === 0 || argv.length > 16) return false;
  for (const a of argv) if (typeof a !== 'string' || !a.trim() || a.length > 400) return false;
  const prog = path.win32.basename(path.basename(String(argv[0]))).toLowerCase();
  // Exactly Dan's reviewed shape: powershell -NoProfile -ExecutionPolicy Bypass -File <absolute>\okkin-off-v2.ps1 [-WhatIf].
  if (/^(powershell|pwsh)(\.exe)?$/.test(prog)) return psShapeOk(argv as string[]);
  if (FORBIDDEN.test(prog)) return false;
  for (const a of argv as string[]) {
    if (/^<.*>$/.test(a.trim()) || a.includes('<') || a.includes('>')) return false; // placeholder or redirection
    if (FORBIDDEN_ARG.test(a)) return false;
    if (FORBIDDEN.test(path.basename(a).toLowerCase()) && a !== argv[0]) return false;
  }
  return true;
}

export function psShapeOk(a: string[]): boolean {
  if (a.length !== 6 && a.length !== 7) return false;
  if (a[0]!.toLowerCase() !== 'powershell' || a[1] !== '-NoProfile' || a[2] !== '-ExecutionPolicy' || a[3] !== 'Bypass' || a[4] !== '-File') return false;
  if (a.length === 7 && a[6] !== '-WhatIf') return false;
  return /^[a-zA-Z]:\\[^<>|&;`$\n\r"]*\\okkin-off-v2\.ps1$/.test(a[5]!);
}

/** The script path in a PowerShell argv, or null. */
export function scriptOf(argv: string[]): string | null {
  return /^(powershell|pwsh)(\.exe)?$/i.test(path.win32.basename(argv[0] ?? '')) ? argv[5] ?? null : null;
}

/** Hex sha256 of a file, or null when unreadable. */
export function fileSha256(file: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

/** 'VRAM freed MiB: n' and 'RAM freed MiB: n' from the stop script's output. Null when absent. */
export function parseFreed(out: string): { vramMiB: number | null; ramMiB: number | null } {
  const grab = (label: string) => {
    const m = new RegExp(`^\\s*${label} freed MiB:\\s*(\\d+(?:\\.\\d+)?)\\s*$`, 'mi').exec(out);
    return m ? Number(m[1]) : null;
  };
  return { vramMiB: grab('VRAM'), ramMiB: grab('RAM') };
}

function tuningOf(raw: unknown): Tuning {
  const t: Tuning = {};
  if (!raw || typeof raw !== 'object') return t;
  const r = raw as Record<string, unknown>;
  if (typeof r.num_ctx === 'number' && Number.isInteger(r.num_ctx) && r.num_ctx > 0 && r.num_ctx <= 1_048_576) t.num_ctx = r.num_ctx;
  if (typeof r.num_gpu === 'number' && Number.isInteger(r.num_gpu) && r.num_gpu >= 0 && r.num_gpu <= 1000) t.num_gpu = r.num_gpu;
  if ((typeof r.keep_alive === 'string' && /^-?\d+(ms|s|m|h)?$/.test(r.keep_alive)) || (typeof r.keep_alive === 'number' && Number.isFinite(r.keep_alive))) t.keep_alive = r.keep_alive as string | number;
  return t;
}

export type StatLike = { uid: number; mode: number };
export type PowerFs = { exists(p: string): boolean; stat(p: string): StatLike; read(p: string): string };
const realFs: PowerFs = { exists: existsSync, stat: (p) => statSync(p), read: (p) => readFileSync(p, 'utf8') };

/**
 * Loads the command pair. Fails closed: the file must be owned by this user and not group- or
 * world-writable. On Windows the POSIX mode and uid are not meaningful and Node has no ACL reader,
 * so the switch stays disabled there unless AO_OKKIN_POWER_WINDOWS_ACL_OK=1 is set by the operator
 * after checking the file's ACL by hand (documented in docs/hq.md).
 */
export function loadPowerConfig(dataDir: string, opts: { fs?: PowerFs; platform?: NodeJS.Platform; uid?: number; env?: NodeJS.ProcessEnv } = {}): PowerLoad {
  const fs = opts.fs ?? realFs;
  const platform = opts.platform ?? process.platform;
  const file = path.join(dataDir, POWER_FILE);
  if (!fs.exists(file)) return { ok: false, reason: 'power control not set up' };
  if (platform === 'win32') {
    if ((opts.env ?? process.env).AO_OKKIN_POWER_WINDOWS_ACL_OK !== '1') return { ok: false, reason: 'power config ACL not verified on Windows' };
  } else {
    let st: StatLike;
    try {
      st = fs.stat(file);
    } catch {
      return { ok: false, reason: 'power config unreadable' };
    }
    const uid = opts.uid ?? (typeof process.getuid === 'function' ? process.getuid() : -1);
    if (st.uid !== uid) return { ok: false, reason: 'power config not owned by this user' };
    if (st.mode & 0o022) return { ok: false, reason: 'power config is group- or world-writable' };
  }
  let raw: { start?: unknown; stop?: unknown; tuning?: unknown; scriptSha256?: unknown; scriptPath?: unknown };
  try {
    raw = JSON.parse(fs.read(file));
  } catch {
    return { ok: false, reason: 'power config is not JSON' };
  }
  if (!argvOk(raw.start) || !argvOk(raw.stop)) return { ok: false, reason: 'power control not set up' };
  const pin = typeof raw.scriptSha256 === 'string' && /^[0-9a-f]{64}$/i.test(raw.scriptSha256) ? raw.scriptSha256.toLowerCase() : undefined;
  if (raw.scriptSha256 !== undefined && !pin) return { ok: false, reason: 'scriptSha256 is not a sha256' };
  const script = scriptOf(raw.stop as string[]);
  if (script) {
    // A PowerShell stop must name the exact approved path and carry its sha256 pin.
    if (typeof raw.scriptPath !== 'string' || raw.scriptPath !== script || !pin) return { ok: false, reason: 'stop script path or sha256 pin missing or different' };
  }
  return { ok: true, config: { start: [...raw.start], stop: [...raw.stop], tuning: tuningOf(raw.tuning), ...(pin ? { scriptSha256: pin } : {}), ...(script ? { scriptPath: script } : {}) } };
}

/** The child's whole env: a few OS basics and the pinned host. Never a request value, never the parent's OLLAMA_*. */
export function childEnv(parent: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']) {
    const v = parent[k];
    if (typeof v === 'string') out[k] = v;
  }
  out.OLLAMA_HOST = PINNED_OLLAMA_HOST;
  return out;
}

export type Runner = {
  /** Start the service: detached, no shell. Resolves once spawned. */
  start(argv: string[], env: Record<string, string>): Promise<{ ok: boolean; error?: string }>;
  /** Run the stop command to completion: no shell. */
  run(argv: string[], env: Record<string, string>): Promise<{ ok: boolean; code: number | null; stderr: string; stdout?: string }>;
  /** sha256 of a file (the stop script). */
  hash?(file: string): string | null;
  /** GPU memory used, MB, summed over GPUs (nvidia-smi), or null with no reading. */
  gpuUsedMB(): Promise<number | null>;
  /** Temperature and fan, as nvidia-smi reports them. Fan is often 'N/A' on laptops: shown as is. */
  gpuStats?(): Promise<GpuStats | null>;
  /** Raw listening-socket table (ss / netstat) for the exposure check. */
  listeners(): Promise<string>;
};

export type GpuStats = { usedMB: number | null; totalMB: number | null; tempC: number | null; fan: string };

/** Parses `nvidia-smi --query-gpu=memory.used,memory.total,temperature.gpu,fan.speed --format=csv,noheader,nounits` (first GPU). */
export function parseGpuStats(out: string): GpuStats | null {
  const line = out.split(/\r?\n/).find((l) => l.trim());
  if (!line) return null;
  const [used, total, temp, fan] = line.split(',').map((x) => x.trim());
  const num = (v: string | undefined) => (v && /^\d+(\.\d+)?$/.test(v) ? Number(v) : null);
  return { usedMB: num(used), totalMB: num(total), tempC: num(temp), fan: num(fan) !== null ? `${num(fan)}%` : 'N/A' };
}

export const realRunner: Runner = {
  hash: fileSha256,
  gpuStats() {
    return new Promise((resolve) => {
      execFile('nvidia-smi', ['--query-gpu=memory.used,memory.total,temperature.gpu,fan.speed', '--format=csv,noheader,nounits'], { shell: false, timeout: 5000, encoding: 'utf8' }, (err, out) => resolve(err ? null : parseGpuStats(String(out))));
    });
  },
  start(argv, env) {
    return new Promise((resolve) => {
      try {
        const child = spawn(argv[0]!, argv.slice(1), { shell: false, detached: true, stdio: 'ignore', env, windowsHide: true });
        child.once('error', (e) => resolve({ ok: false, error: e.message }));
        child.once('spawn', () => {
          child.unref();
          resolve({ ok: true });
        });
      } catch (e) {
        resolve({ ok: false, error: (e as Error).message });
      }
    });
  },
  run(argv, env) {
    return new Promise((resolve) => {
      execFile(argv[0]!, argv.slice(1), { shell: false, env, timeout: 30_000, windowsHide: true, encoding: 'utf8' }, (err, out, errOut) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : null) : 0;
        resolve({ ok: !err, code, stderr: String(errOut || (err ? err.message : '')).slice(0, 400), stdout: String(out || '').slice(0, 4000) });
      });
    });
  },
  gpuUsedMB() {
    return new Promise((resolve) => {
      execFile('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { shell: false, timeout: 5000, encoding: 'utf8' }, (err, out) => {
        if (err) return resolve(null);
        const nums = String(out).split(/\r?\n/).map((l) => Number(l.trim())).filter((n) => Number.isFinite(n) && l(n));
        resolve(nums.length ? nums.reduce((a, b) => a + b, 0) : null);
      });
    });
    function l(n: number) {
      return n >= 0;
    }
  },
  listeners() {
    return new Promise((resolve) => {
      const [cmd, args] = process.platform === 'win32' ? ['netstat', ['-ano', '-p', 'TCP']] : ['ss', ['-ltnH']];
      execFile(cmd as string, args as string[], { shell: false, timeout: 5000, encoding: 'utf8' }, (err, out) => resolve(err ? '' : String(out)));
    });
  },
};

/**
 * Allowlist: true when any LISTEN socket on Ollama's port has a local address other than
 * 127.0.0.1 or [::1] (a LAN IP, 0.0.0.0, [::], *). Reads `ss -ltn` and Windows `netstat -ano` rows.
 */
export function exposedOnAllInterfaces(table: string, port = 11434): boolean {
  for (const raw of table.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || !/LISTEN/i.test(line) && !/^\S+\s+\S+:\d+/.test(line)) continue;
    if (/ESTABLISHED|TIME_WAIT|CLOSE_WAIT|SYN_/i.test(line)) continue;
    const cols = line.split(/\s+/);
    // netstat: Proto Local Foreign State PID. ss: State Recv-Q Send-Q Local Peer.
    const local = /^tcp/i.test(cols[0]!) ? cols[1] : cols[3];
    if (!local) continue;
    const at = local.lastIndexOf(':');
    if (at < 0 || local.slice(at + 1) !== String(port)) continue;
    const host = local.slice(0, at).replace(/%.*$/, '');
    if (host !== '127.0.0.1' && host !== '[::1]') return true;
  }
  return false;
}

/** Stop failed for lack of rights: the switch shows disabled rather than trying anything higher. */
export function lacksRights(r: { code: number | null; stderr: string }): boolean {
  return r.code === 5 || /access is denied|permission denied|EPERM|EACCES|not permitted|requires elevation/i.test(r.stderr);
}

export type PowerLogLine = { at: string; who: string; action: PowerAction | 'exposed-killed'; result: string; freedMB: number | null };

/** Append-only, 0600, under the gitignored data dir. Who, when, what, result, freed MB. No prompts. */
export function appendPowerLog(dataDir: string, line: PowerLogLine) {
  const file = path.join(dataDir, POWER_LOG);
  appendFileSync(file, JSON.stringify(line) + '\n', { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* Windows: mode bits are not ACLs */
  }
}

let lastAction = 0;
let rightsBlocked = false;
let busy = false;

export function powerCooling(now = Date.now()) {
  return lastAction > 0 && now - lastAction < POWER_COOLDOWN_MS;
}
export function powerRightsBlocked() {
  return rightsBlocked;
}
export function resetPowerForTests() {
  lastAction = 0;
  rightsBlocked = false;
  busy = false;
}

export type PowerDeps = {
  runner: Runner;
  /** Is Ollama answering /api/tags on the pinned origin. */
  reachable(): Promise<boolean>;
  /** Names loaded per /api/ps. */
  loaded(): Promise<string[]>;
  /** POST /api/generate on the pinned origin. */
  generate(body: Record<string, unknown>): Promise<boolean>;
  /** The model to load on ON (the switch's saved choice, already allowlist ∩ tags), or ''. */
  chosenModel(): Promise<{ tag: string; num_ctx?: number; keep_alive?: string | number } | null>;
  sleep?(ms: number): Promise<void>;
  now?(): number;
};

export type PowerResult = { status: number; error?: string; power: 'on' | 'off'; beforeMB: number | null; afterMB: number | null; freedMB: number | null; script?: { vramMiB: number | null; ramMiB: number | null } };

async function waitFor(check: () => Promise<boolean>, want: boolean, deps: PowerDeps, tries = 20): Promise<boolean> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let i = 0; i < tries; i++) {
    if ((await check()) === want) return true;
    await sleep(500);
  }
  return false;
}

/**
 * Flip the power. `action` must already be the parsed enum. The caller has checked the office
 * session (never a token). Cooldown is global: the switch cannot be flapped.
 */
export async function flipPower(dataDir: string, action: PowerAction, who: string, deps: PowerDeps, load: PowerLoad = loadPowerConfig(dataDir)): Promise<PowerResult> {
  const now = deps.now ?? Date.now;
  const before = await deps.runner.gpuUsedMB();
  const on = await deps.reachable();
  const base = { power: (on ? 'on' : 'off') as 'on' | 'off', beforeMB: before, afterMB: before, freedMB: null };
  if (!load.ok) return { ...base, status: 503, error: load.reason };
  if (rightsBlocked) return { ...base, status: 503, error: 'stop command lacks rights; switch disabled' };
  if (busy) return { ...base, status: 409, error: 'power change in progress' };
  if (powerCooling(now())) return { ...base, status: 429, error: 'cooling down' };
  const script = scriptOf(load.config.stop);
  if (script) {
    if (!load.config.scriptSha256 || load.config.scriptPath !== script) return { ...base, status: 503, error: 'stop script not pinned; refused' };
    const got = (deps.runner.hash ?? fileSha256)(script);
    if (got !== load.config.scriptSha256) return { ...base, status: 503, error: 'stop script hash does not match the pin; refused' };
  }
  busy = true;
  lastAction = now();
  const env = childEnv();
  const log = (result: string, freedMB: number | null, act: PowerLogLine['action'] = action) =>
    appendPowerLog(dataDir, { at: new Date(now()).toISOString(), who, action: act, result, freedMB });
  try {
    if (action === 'start') {
      if (!on) {
        const started = await deps.runner.start(load.config.start, env);
        if (!started.ok) {
          log('start failed', null);
          return { ...base, status: 502, error: 'start command failed' };
        }
        if (!(await waitFor(deps.reachable, true, deps))) {
          log('no answer after start', null);
          return { ...base, status: 504, error: 'Ollama did not come up' };
        }
      }
      if (exposedOnAllInterfaces(await deps.runner.listeners())) {
        await deps.runner.run(load.config.stop, env);
        log('listening on all interfaces; stopped', null, 'exposed-killed');
        return { ...base, power: (await deps.reachable()) ? 'on' : 'off', status: 502, error: 'Ollama was listening on 0.0.0.0; stopped' };
      }
      const model = await deps.chosenModel();
      if (model) {
        const t: Tuning = { ...load.config.tuning, ...(model.num_ctx !== undefined ? { num_ctx: model.num_ctx } : {}), ...(model.keep_alive !== undefined ? { keep_alive: model.keep_alive } : {}) };
        const options: Record<string, number> = { num_predict: 1 };
        if (t.num_ctx !== undefined) options.num_ctx = t.num_ctx;
        if (t.num_gpu !== undefined) options.num_gpu = t.num_gpu;
        await deps.generate({ model: model.tag, ...(t.keep_alive !== undefined ? { keep_alive: t.keep_alive } : {}), options });
      }
      const after = await deps.runner.gpuUsedMB();
      log(model ? `on, loaded ${model.tag}` : 'on, no model chosen', null);
      return { status: 200, power: 'on', beforeMB: before, afterMB: after, freedMB: null };
    }
    // stop
    for (const name of on ? await deps.loaded() : []) await deps.generate({ model: name, keep_alive: 0 });
    const stopped = await deps.runner.run(load.config.stop, env);
    if (!stopped.ok) {
      if (lacksRights(stopped)) rightsBlocked = true;
      log(rightsBlocked ? 'stop lacks rights' : 'stop failed', null);
      return { ...base, power: (await deps.reachable()) ? 'on' : 'off', status: rightsBlocked ? 403 : 502, error: rightsBlocked ? 'stop command lacks rights; switch disabled' : 'stop command failed' };
    }
    await waitFor(deps.reachable, false, deps);
    const after = await deps.runner.gpuUsedMB();
    const freed = before !== null && after !== null ? Math.max(0, before - after) : null;
    const power = (await deps.reachable()) ? 'on' : 'off';
    log(power === 'off' ? 'off' : 'stop ran but Ollama still answers', freed);
    return { status: power === 'off' ? 200 : 502, power, beforeMB: before, afterMB: after, freedMB: freed, script: parseFreed(stopped.stdout ?? ''), ...(power === 'on' ? { error: 'Ollama still answers' } : {}) };
  } finally {
    busy = false;
  }
}

/** Dan nit (b): while ON, each loft read re-checks exposure; an exposed listener is stopped and logged. */
export async function recheckExposure(dataDir: string, runner: Runner = realRunner, load: PowerLoad = loadPowerConfig(dataDir)): Promise<boolean> {
  if (!exposedOnAllInterfaces(await runner.listeners())) return false;
  let result = 'exposed; power control not set up, could not stop';
  if (load.ok) {
    const r = await runner.run(load.config.stop, childEnv());
    result = r.ok ? 'exposed on loft check; stopped' : 'exposed on loft check; stop failed';
  }
  appendPowerLog(dataDir, { at: new Date().toISOString(), who: 'loft-check', action: 'exposed-killed', result, freedMB: null });
  return true;
}
