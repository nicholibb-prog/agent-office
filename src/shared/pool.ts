// Community work pool. Levels, claim rules, and the board the office paints.
// Names and numbers only: no paths, tokens, or private projects.

export const LEASE_MS = 15 * 60 * 1000;
export const OKKIN = 'okkin';
/** Crew id that may record a Dan pass. Compared after normalizing the authenticated caller. */
export const DAN = 'dan';

export type PoolStatus = 'open' | 'claimed' | 'needs_approval' | 'done';
export type ApprovalGate = 'dan-pass' | 'nick-yes';
export type BadgeShape = 'chevron' | 'stripes-star' | 'bar' | 'skull';

export interface LevelInfo {
  level: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  name: string;
  badge: BadgeShape;
  /** Chevrons or bars the badge draws. A skull ignores this. */
  marks: number;
  metal: 'bronze' | 'silver' | 'gold' | 'bone';
  line: string;
}

export const LEVELS: readonly LevelInfo[] = [
  { level: 1, name: 'Recruit', badge: 'chevron', marks: 1, metal: 'bronze', line: 'Notes, summaries, tidy' },
  { level: 2, name: 'Private', badge: 'chevron', marks: 1, metal: 'silver', line: 'First drafts, triage, tagging' },
  { level: 3, name: 'Corporal', badge: 'chevron', marks: 1, metal: 'gold', line: 'Research digests, checklists, test runs' },
  { level: 4, name: 'Sergeant', badge: 'stripes-star', marks: 3, metal: 'gold', line: 'Small code fixes and docs, draft only' },
  { level: 5, name: 'Lieutenant', badge: 'bar', marks: 1, metal: 'gold', line: 'Features and multi-file builds, review required' },
  { level: 6, name: 'Captain', badge: 'bar', marks: 2, metal: 'gold', line: 'Security, money, network. Needs a Dan pass' },
  { level: 7, name: 'Prestige', badge: 'skull', marks: 1, metal: 'bone', line: 'Merges, sends, spend, deletes. Needs a Nick yes' },
];

export function levelInfo(level: number): LevelInfo {
  const n = Math.min(7, Math.max(1, Math.floor(level) || 1));
  return LEVELS[n - 1];
}

/** A stored display name: trimmed, no control characters. */
export function displayName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 32);
}

/** Identity compare key. */
export function botName(raw: unknown): string {
  return displayName(raw).toLowerCase();
}

export function isOkkin(name: unknown): boolean {
  return botName(name) === OKKIN;
}

export function isDan(name: unknown): boolean {
  return botName(name) === DAN;
}

const TO_SEVEN: readonly RegExp[] = [/\bmerge\b/i, /\bsend\b/i, /\bspend\b/i, /\bdelete\b/i];
const TO_SIX: readonly RegExp[] = [/\bpay\b/i, /\bsecret\b/i, /\bsecurity\b/i, /\bnetwork\b/i, /major\s+files/i];

/** Keyword floor: merge/send/spend/delete → 7; the other gated words → 6; else 1. */
export function keywordFloor(text: string): number {
  if (TO_SEVEN.some((r) => r.test(text))) return 7;
  if (TO_SIX.some((r) => r.test(text))) return 6;
  return 1;
}

/** Poster may ask for a level. Keywords only raise it. */
export function enforcedLevel(requested: unknown, text: string): number {
  const ask = typeof requested === 'number' && Number.isInteger(requested) ? Math.min(7, Math.max(1, requested)) : 1;
  return Math.max(ask, keywordFloor(text));
}

/**
 * Who may claim. Okkin stops at 3. Other crew stop at 5.
 * Levels 6 and 7 are only for the named target, and Okkin is still refused there.
 */
export function claimRefusal(level: number, by: unknown, target?: string): string | undefined {
  if (isOkkin(by) && level > 3) return 'Okkin can claim levels 1–3 only';
  if (level >= 6 && botName(by) !== botName(target ?? '')) return 'Levels 6 and 7 are only for the named bot';
  return undefined;
}

export interface ClaimStamp {
  by: string;
  at: number;
  leaseUntil: number;
  endedAt?: number;
  reason?: 'expired' | 'released' | 'completed';
}

export interface PoolClaim {
  by: string;
  at: number;
  leaseUntil: number;
  leaseMs: number;
  heartbeatAt?: number;
}

export interface PoolJob {
  id: string;
  title: string;
  body: string;
  level: number;
  targetBot?: string;
  postedBy: string;
  createdAt: number;
  updatedAt: number;
  notBefore?: number;
  tags: string[];
  status: PoolStatus;
  claim?: PoolClaim;
  history: ClaimStamp[];
  doneBy?: string;
  approval?: ApprovalGate;
  danPass?: { by: string; at: number };
  approvedBy?: string;
  completedAt?: number;
}

/** What the approver last saw. Both must match or the approve is stale. */
export interface SeenJob {
  state: string;
  updatedAt: number;
}

export function showsWorking(job: PoolJob, now: number): boolean {
  const c = job.claim;
  if (job.status !== 'claimed' || !c?.heartbeatAt) return false;
  return now < c.leaseUntil;
}

export function jobFace(job: PoolJob, now: number): PoolStatus | 'working' {
  if (job.status === 'claimed') return showsWorking(job, now) ? 'working' : 'claimed';
  return job.status;
}

/** Holding a claim is not WORKING. needs_input is never overwritten. */
export function nextPresence(current: string, desired: 'working' | 'idle'): string {
  if (current === 'needs_input') return 'needs_input';
  return desired;
}

export interface PoolCard {
  id: string;
  title: string;
  level: number;
  badge: BadgeShape;
  metal: LevelInfo['metal'];
  marks: number;
  state: PoolStatus;
  status: string;
  updatedAt: number;
  claimer?: string;
  leaseLeftMs?: number;
  doneBy?: string;
  approval?: ApprovalGate;
}

export interface PoolBoard {
  columns: { open: PoolCard[]; claimed: PoolCard[]; needsApproval: PoolCard[]; done: PoolCard[] };
  credits: { bot: string; done: number }[];
}

export function emptyBoard(): PoolBoard {
  return { columns: { open: [], claimed: [], needsApproval: [], done: [] }, credits: [] };
}

export function toCard(job: PoolJob, now: number): PoolCard {
  const info = levelInfo(job.level);
  const face = jobFace(job, now);
  const leaseLeftMs = job.status === 'claimed' && job.claim ? Math.max(0, job.claim.leaseUntil - now) : undefined;
  return {
    id: job.id,
    title: job.title,
    level: job.level,
    badge: info.badge,
    metal: info.metal,
    marks: info.marks,
    state: job.status,
    status: face,
    updatedAt: job.updatedAt,
    ...(job.claim ? { claimer: job.claim.by } : {}),
    ...(leaseLeftMs !== undefined ? { leaseLeftMs } : {}),
    ...(job.doneBy ? { doneBy: job.doneBy } : {}),
    ...(job.approval ? { approval: job.approval } : {}),
  };
}

export function boardFrom(jobs: readonly PoolJob[], now: number): PoolBoard {
  const columns: PoolBoard['columns'] = { open: [], claimed: [], needsApproval: [], done: [] };
  for (const job of jobs) {
    const card = toCard(job, now);
    if (job.status === 'open') columns.open.push(card);
    else if (job.status === 'claimed') columns.claimed.push(card);
    else if (job.status === 'needs_approval') columns.needsApproval.push(card);
    else columns.done.push(card);
  }
  const tally = new Map<string, number>();
  for (const job of jobs) if (job.status === 'done' && job.doneBy) tally.set(job.doneBy, (tally.get(job.doneBy) ?? 0) + 1);
  const credits = [...tally.entries()].map(([bot, done]) => ({ bot, done })).sort((a, b) => b.done - a.done || a.bot.localeCompare(b.bot));
  return { columns, credits };
}

/** Refuse private paths, key-shaped text, and LAN addresses so they are not stored. */
export function unsafeText(text: string): boolean {
  if (/C:\\Users/i.test(text) || /\/Users\//.test(text)) return true;
  if (/\b(?:sk-|ghp_|github_pat_|xox[baprs]-|AKIA)/.test(text)) return true;
  if (/\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/.test(text)) return true;
  return false;
}
