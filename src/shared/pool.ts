// Community work pool. Levels, claim rules, and the board the office paints.
// Names and numbers only: no paths, tokens, or private projects.

export const LEASE_MS = 15 * 60 * 1000;
/** Names nobody may register as a caller or an account. Authority is an id in the pool policy, not a name. */
export const RESERVED_POOL_NAMES = ['dan', 'okkin', 'nick'] as const;

/** Who is acting. `id` is the account id or the caller-token id. `label` is only for the board. */
export interface PoolActor {
  id: string;
  label: string;
}

/** Allowlists kept in the floor's gitignored `.agent-office/work-pool-policy.json`. Empty means nobody. */
export interface PoolPolicy {
  /** Account ids that may record a Nick yes. */
  approvers: string[];
  /** Account ids or caller ids that may post a job whose level stays 1–3. */
  lowLevelPosters: string[];
  /** Account ids or caller ids that may post a job that lands at 6 or 7. */
  highLevelPosters: string[];
  /** Account ids or caller ids that may claim above level 3. */
  crew: string[];
  /** Caller-token ids or account ids that are Dan. */
  dan: string[];
  /** Caller-token ids or account ids that are Okkin. */
  okkin: string[];
}

export function emptyPolicy(): PoolPolicy {
  return { approvers: [], lowLevelPosters: [], highLevelPosters: [], crew: [], dan: [], okkin: [] };
}

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

export function reservedPoolName(name: unknown): boolean {
  return (RESERVED_POOL_NAMES as readonly string[]).includes(botName(name));
}

/** An account id or caller id: no spaces, no path characters. */
export function actorId(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : '';
}

/**
 * NFKC, then drop format characters (zero-width and the like), then case-fold.
 * Keyword checks run on this, so a hidden character cannot split a gated word.
 */
export function normalizePoolText(text: string): string {
  return text.normalize('NFKC').replace(/\p{Cf}/gu, '').toLowerCase();
}

const word = (stem: string) => new RegExp(`\\b${stem}\\b`, 'i');

/** Backstop only. merge/send/money/delete land at 7. */
const TO_SEVEN = ['merge', 'email', 'message', 'post', 'reply', 'slack', 'send', 'sent', 'sends', 'pay', 'payment', 'invoice', 'transfer', 'wire', 'purchase', 'buy', 'spend', 'delete', 'remove', 'wipe'].map(word);
/** Backstop only. code, secrets, and network land at 6 or above. */
const TO_SIX = ['deploy', 'push', 'commit', 'code', 'token', 'password', 'credential', 'auth', 'secret', 'key', 'security', 'network'].map(word);

/** Keyword floor. No gated word stays at 1, and the poster default of 4 is applied by enforcedLevel. */
export function keywordFloor(text: string): number {
  const n = normalizePoolText(text);
  if (TO_SEVEN.some((r) => r.test(n))) return 7;
  if (TO_SIX.some((r) => r.test(n)) || /major\s+files/.test(n)) return 6;
  return 1;
}

/**
 * No requested level means 4, which Okkin cannot claim.
 * A number can ask lower. Keywords only raise the result.
 */
export function enforcedLevel(requested: unknown, text: string): number {
  const ask = typeof requested === 'number' && Number.isInteger(requested) ? Math.min(7, Math.max(1, requested)) : 4;
  return Math.max(ask, keywordFloor(text));
}

/**
 * Default cap is level 3. Crew allowlist ids may go higher.
 * Levels 6 and 7 also have to be the named target id.
 * An Okkin id stops at 3 even when it is named or on the crew list.
 */
export function claimRefusal(level: number, actorId: string, targetId: string | undefined, policy: Pick<PoolPolicy, 'okkin' | 'crew'>): string | undefined {
  if (policy.okkin.includes(actorId) && level > 3) return 'Okkin can claim levels 1–3 only';
  if (level > 3 && !policy.crew.includes(actorId)) return 'that level is only for the crew allowlist';
  if (level >= 6 && actorId !== (targetId ?? '')) return 'Levels 6 and 7 are only for the named bot';
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
  /** Caller-token id or account id. */
  by: string;
  label: string;
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
  posterLabel?: string;
  /** sha256 of title, body, level, and target. Approvals must send this back. */
  contentHash?: string;
  createdAt: number;
  updatedAt: number;
  notBefore?: number;
  tags: string[];
  status: PoolStatus;
  claim?: PoolClaim;
  history: ClaimStamp[];
  doneBy?: string;
  doneLabel?: string;
  approval?: ApprovalGate;
  danPass?: { by: string; at: number };
  approvedBy?: string;
  completedAt?: number;
}

/** What the approver last saw. Both must match or the approve is stale. */
export interface SeenJob {
  state: string;
  updatedAt: number;
  /** Content hash the client saw. A mismatch is a 409. */
  hash: string;
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
  /** Short body, so an approver can see the text the hash covers. */
  body?: string;
  hash?: string;
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
    ...(job.claim ? { claimer: job.claim.label || job.claim.by } : {}),
    ...(leaseLeftMs !== undefined ? { leaseLeftMs } : {}),
    ...(job.doneLabel || job.doneBy ? { doneBy: job.doneLabel || job.doneBy } : {}),
    ...(job.approval ? { approval: job.approval } : {}),
    ...(job.body ? { body: job.body.slice(0, 80) } : {}),
    ...(job.contentHash ? { hash: job.contentHash } : {}),
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
  for (const job of jobs) if (job.status === 'done' && (job.doneLabel || job.doneBy)) {
    const bot = job.doneLabel || job.doneBy!;
    tally.set(bot, (tally.get(bot) ?? 0) + 1);
  }
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
