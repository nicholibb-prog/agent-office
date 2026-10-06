import { randomBytes } from 'node:crypto';
import {
  LEASE_MS,
  actorId,
  boardFrom,
  botName,
  claimRefusal,
  displayName,
  emptyBoard,
  enforcedLevel,
  showsWorking,
  unsafeText,
  type PoolActor,
  type PoolBoard,
  type PoolJob,
  type PoolPolicy,
  type SeenJob,
} from '../../shared/pool.js';
import { CallerBook, rememberReservedNames } from './callers.js';
import { contentHash } from './hash.js';
import { readPolicy } from './policy.js';
import { poolPath, readPrivate, writePrivate } from './persist.js';
import type { WorkPuller } from './puller.js';

export interface PoolEvents {
  update?(board: PoolBoard): void;
  /** working only with a live heartbeat. idle when the claim has none. needs_input is the floor's to keep. */
  presence?(name: string, desired: 'working' | 'idle'): void;
}

export type PoolFail = { ok: false; status: number; error: string };
export type PoolOk<T> = { ok: true; value: T } | PoolFail;

const MAX_ACTIVE = 200;
const MAX_DONE = 200;
const MAX_HISTORY = 20;
const TITLE_MAX = 120;
const BODY_MAX = 4000;
const POST_LIMIT = 8;
const POST_WINDOW_MS = 60_000;

export class WorkPool {
  private jobs: PoolJob[] = [];
  private file: string;
  private dataDir: string;
  private callers: CallerBook;
  private now: () => number;
  private timer?: ReturnType<typeof setInterval>;
  private puller?: WorkPuller;
  /** Bots we last told the office were working, so a stalled claim can return them to idle. */
  private working = new Set<string>();
  private posts = new Map<string, number[]>();

  constructor(
    dataDir: string,
    private events: PoolEvents = {},
    opts: { now?: () => number; autoPull?: boolean; puller?: WorkPuller } = {},
  ) {
    this.dataDir = dataDir;
    this.file = poolPath(dataDir, 'work-pool.json');
    this.callers = new CallerBook(dataDir);
    this.now = opts.now ?? Date.now;
    this.policy();
    this.restore();
    // Auto-pull stays off until a caller injects an armed runner. The quiet default must not claim.
    if (opts.autoPull && opts.puller?.armed) {
      this.puller = opts.puller;
      this.timer = setInterval(() => this.tick(), 5_000);
      this.timer.unref?.();
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  registerCaller(name: unknown, accountNames: readonly string[] = []) {
    return this.callers.register(name, accountNames);
  }

  callerByToken(token: string): PoolActor | undefined {
    const who = this.callers.who(token);
    return who ? { id: who.id, label: who.label } : undefined;
  }

  board(): PoolBoard {
    this.sweep();
    return boardFrom(this.jobs, this.now());
  }

  get(id: string): PoolJob | undefined {
    this.sweep();
    return this.jobs.find((j) => j.id === id);
  }

  post(input: { title: unknown; body: unknown; level?: unknown; targetBot?: unknown; tags?: unknown; notBefore?: unknown }, actor: PoolActor, gate: { admin?: boolean } = {}): PoolOk<PoolJob> {
    const who = asActor(actor);
    if (!who) return fail(400, 'caller identity required');
    const now = this.now();
    if (this.rateLimited(who.id, now)) return fail(429, 'too many posts');
    const title = displayName(input.title).slice(0, TITLE_MAX);
    const body = typeof input.body === 'string' ? input.body.replace(/\r\n?/g, '\n').trim().slice(0, BODY_MAX) : '';
    if (!title) return fail(400, 'title required');
    if (!body) return fail(400, 'body required');
    const tags = cleanTags(input.tags);
    const text = `${title}\n${body}\n${tags.join(' ')}`;
    if (unsafeText(text) || unsafeText(who.label)) return fail(400, 'that text cannot be stored');
    if (this.jobs.filter((j) => j.status !== 'done').length >= MAX_ACTIVE) return fail(400, 'the pool is full');
    const target = actorId(input.targetBot);
    if (input.targetBot !== undefined && input.targetBot !== null && input.targetBot !== '' && !target) return fail(400, 'target must be an id');
    if (target && unsafeText(target)) return fail(400, 'that text cannot be stored');
    const notBefore = when(input.notBefore);
    if (input.notBefore !== undefined && input.notBefore !== null && notBefore === undefined) return fail(400, 'notBefore must be a time');
    const level = enforcedLevel(input.level, text);
    const policy = this.policy();
    if (level <= 3 && !gate.admin && !policy.lowLevelPosters.includes(who.id)) return fail(403, 'levels 1–3 are only for an allowlisted poster');
    if (level >= 6 && !policy.highLevelPosters.includes(who.id)) return fail(403, 'levels 6 and 7 are only for an allowlisted poster');
    const job: PoolJob = {
      id: randomBytes(6).toString('hex'),
      title,
      body,
      level,
      ...(target ? { targetBot: target } : {}),
      postedBy: who.id,
      posterLabel: who.label,
      createdAt: now,
      updatedAt: now,
      ...(notBefore !== undefined ? { notBefore } : {}),
      tags,
      status: 'open',
      history: [],
      contentHash: '',
    };
    job.contentHash = contentHash(job);
    this.jobs.push(job);
    this.changed();
    return { ok: true, value: job };
  }

  claim(id: string, actor: PoolActor, leaseMs?: number): PoolOk<PoolJob> {
    this.sweep();
    const who = asActor(actor);
    if (!who) return fail(400, 'caller identity required');
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return fail(404, 'no such job');
    if (job.status !== 'open') return fail(409, 'job is not open');
    const now = this.now();
    if (job.notBefore !== undefined && now < job.notBefore) return fail(409, 'not open yet');
    const why = claimRefusal(job.level, who.id, job.targetBot, this.policy());
    if (why) return fail(403, why);
    if (this.liveClaim(who.id, now)) return fail(409, 'finish or release the job you already hold');
    const lease = clampLease(leaseMs);
    job.status = 'claimed';
    job.claim = { by: who.id, label: who.label, at: now, leaseUntil: now + lease, leaseMs: lease };
    this.remember(job, { by: who.id, at: now, leaseUntil: now + lease });
    this.touch(job, now);
    this.syncPresence();
    this.changed();
    return { ok: true, value: job };
  }

  heartbeat(id: string, actor: PoolActor): PoolOk<PoolJob> {
    this.sweep();
    const who = asActor(actor);
    const job = this.jobs.find((j) => j.id === id);
    if (!job?.claim || job.status !== 'claimed' || !who) return fail(409, 'no live claim');
    if (job.claim.by !== who.id) return fail(403, 'only the claimer can heartbeat');
    const now = this.now();
    job.claim.heartbeatAt = now;
    job.claim.leaseUntil = now + job.claim.leaseMs;
    const stamp = job.history[job.history.length - 1];
    if (stamp && !stamp.endedAt) stamp.leaseUntil = job.claim.leaseUntil;
    this.touch(job, now);
    this.syncPresence();
    this.changed();
    return { ok: true, value: job };
  }

  release(id: string, actor: PoolActor): PoolOk<PoolJob> {
    this.sweep();
    const who = asActor(actor);
    const job = this.jobs.find((j) => j.id === id);
    if (!job?.claim || job.status !== 'claimed' || !who) return fail(409, 'no live claim');
    if (job.claim.by !== who.id) return fail(403, 'only the claimer can release');
    this.endClaim(job, 'released');
    this.changed();
    return { ok: true, value: job };
  }

  /** Levels 1–5 become done. Levels 6–7 become needs approval. The pool never runs the action. */
  complete(id: string, actor: PoolActor): PoolOk<PoolJob> {
    this.sweep();
    const who = asActor(actor);
    const job = this.jobs.find((j) => j.id === id);
    if (!job?.claim || job.status !== 'claimed' || !who) return fail(409, 'no live claim');
    if (job.claim.by !== who.id) return fail(403, 'only the claimer can complete');
    const now = this.now();
    const label = job.claim.label;
    this.endClaim(job, 'completed');
    job.doneBy = who.id;
    job.doneLabel = label;
    job.completedAt = now;
    if (job.level >= 6) {
      job.status = 'needs_approval';
      job.approval = 'dan-pass';
    } else {
      job.status = 'done';
      this.trimDone();
    }
    this.touch(job, now);
    this.changed();
    return { ok: true, value: job };
  }

  /**
   * Levels 6 and 7. The actor id must be on the Dan allowlist, and must not have posted,
   * claimed, or completed the job. This does not mark the job done. It moves the job to owner approval.
   */
  danPass(id: string, actor: PoolActor, seen: SeenJob): PoolOk<PoolJob> {
    this.sweep();
    const who = asActor(actor);
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return fail(404, 'no such job');
    if (!fresh(job, seen)) return fail(409, 'stale');
    if (seen.hash !== contentHash(job)) return fail(409, 'content changed');
    if (!who || !this.policy().dan.includes(who.id)) return fail(403, 'only Dan can record a Dan pass');
    if (touchedBy(job, who.id)) return fail(403, 'cannot pass your own job');
    if (job.status !== 'needs_approval' || job.level < 6 || job.approval !== 'dan-pass') return fail(409, 'job is not waiting on a Dan pass');
    const now = this.now();
    job.danPass = { by: who.id, at: now };
    job.approval = 'owner-yes';
    this.touch(job, now);
    this.changed();
    return { ok: true, value: job };
  }

  /**
   * Owner approval from an account id on pool.approvers.
   * Levels 6 and 7 need a Dan pass first. The approver id must differ from the account
   * that recorded that pass, the poster, and the claimer. Display names are not compared.
   */
  ownerApproval(id: string, actor: PoolActor, seen: SeenJob): PoolOk<PoolJob> {
    this.sweep();
    const who = asActor(actor);
    if (!who) return fail(403, 'account required');
    if (!this.policy().approvers.includes(who.id)) return fail(403, 'not an approver');
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return fail(404, 'no such job');
    if (!fresh(job, seen)) return fail(409, 'stale');
    if (seen.hash !== contentHash(job)) return fail(409, 'content changed');
    if (job.status !== 'needs_approval' || (job.level !== 6 && job.level !== 7)) return fail(409, 'job is not waiting on approval');
    if (job.level >= 6 && !job.danPass) return fail(403, 'Dan pass is required');
    if (job.approval !== 'owner-yes') return fail(409, 'needs owner');
    if (job.danPass?.by === who.id) return fail(403, 'cannot approve a pass you recorded');
    if (touchedBy(job, who.id)) return fail(403, 'cannot approve your own job');
    const now = this.now();
    job.status = 'done';
    job.approvedBy = who.id;
    job.approval = 'owner-yes';
    this.trimDone();
    this.touch(job, now);
    this.changed();
    return { ok: true, value: job };
  }

  /** Next job this bot may claim. Refuses while they are WORKING or already hold a claim. */
  pull(actor: PoolActor): PoolOk<PoolJob> {
    this.sweep();
    const who = asActor(actor);
    if (!who) return fail(400, 'caller identity required');
    const now = this.now();
    const held = this.liveClaim(who.id, now);
    if (held && showsWorking(held, now)) return fail(409, 'already working');
    if (held) return fail(409, 'already claimed');
    const policy = this.policy();
    const next = this.jobs
      .filter((j) => j.status === 'open' && (j.notBefore === undefined || now >= j.notBefore) && !claimRefusal(j.level, who.id, j.targetBot, policy))
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!next) return fail(404, 'nothing to pull');
    return this.claim(next.id, who);
  }

  private tick() {
    this.sweep();
    const puller = this.puller;
    if (!puller?.armed || !puller.idle()) return;
    const now = this.now();
    const held = this.liveClaim(puller.id, now);
    if (held && showsWorking(held, now)) return;
    if (held) return;
    const result = this.pull({ id: puller.id, label: puller.label });
    if (result.ok) puller.take({ id: result.value.id, title: result.value.title, level: result.value.level });
  }

  private policy(): PoolPolicy {
    const found = readPolicy(this.dataDir);
    rememberReservedNames(found.reservedNames);
    return found;
  }

  private rateLimited(id: string, now: number): boolean {
    const prev = (this.posts.get(id) ?? []).filter((t) => now - t < POST_WINDOW_MS);
    if (prev.length >= POST_LIMIT) {
      this.posts.set(id, prev);
      return true;
    }
    prev.push(now);
    this.posts.set(id, prev);
    return false;
  }

  private sweep() {
    const now = this.now();
    let changed = false;
    for (const job of this.jobs) {
      if (job.status !== 'claimed' || !job.claim) continue;
      if (now < job.claim.leaseUntil) continue;
      this.endClaim(job, 'expired');
      changed = true;
    }
    if (changed) this.changed();
  }

  private endClaim(job: PoolJob, reason: 'expired' | 'released' | 'completed') {
    const now = this.now();
    const stamp = [...job.history].reverse().find((h) => h.by === job.claim?.by && !h.endedAt);
    if (stamp) {
      stamp.endedAt = now;
      stamp.reason = reason;
    }
    job.claim = undefined;
    if (reason !== 'completed') job.status = 'open';
    this.touch(job, now);
    this.syncPresence();
  }

  private remember(job: PoolJob, stamp: PoolJob['history'][number]) {
    job.history.push(stamp);
    if (job.history.length > MAX_HISTORY) job.history.splice(0, job.history.length - MAX_HISTORY);
  }

  private trimDone() {
    const done = this.jobs.filter((j) => j.status === 'done');
    if (done.length <= MAX_DONE) return;
    const drop = new Set(done.slice(0, done.length - MAX_DONE));
    this.jobs = this.jobs.filter((j) => !drop.has(j));
  }

  private liveClaim(id: string, now: number): PoolJob | undefined {
    return this.jobs.find((j) => j.status === 'claimed' && j.claim && j.claim.by === id && now < j.claim.leaseUntil);
  }

  private touch(job: PoolJob, now: number) {
    job.updatedAt = Math.max(now, job.updatedAt + 1);
  }

  private syncPresence() {
    const now = this.now();
    const want = new Map<string, 'working' | 'idle'>();
    for (const job of this.jobs) {
      if (job.status !== 'claimed' || !job.claim) continue;
      const name = botName(job.claim.label || job.claim.by);
      want.set(name, showsWorking(job, now) ? 'working' : 'idle');
    }
    for (const name of this.working) if (!want.has(name)) want.set(name, 'idle');
    this.working = new Set([...want.entries()].filter(([, s]) => s === 'working').map(([n]) => n));
    for (const [name, desired] of want) this.events.presence?.(name, desired);
  }

  private changed() {
    this.save();
    this.events.update?.(boardFrom(this.jobs, this.now()));
  }

  private save() {
    const jobs = this.jobs.map((j) => ({ ...j, history: j.history.map((h) => ({ ...h })) }));
    writePrivate(this.file, { jobs });
  }

  private restore() {
    const raw = readPrivate(this.file);
    const jobs = raw && typeof raw === 'object' ? (raw as { jobs?: unknown }).jobs : undefined;
    if (!Array.isArray(jobs)) return;
    const parsed = jobs.filter(isJob).map((j) => {
      j.history = Array.isArray(j.history) ? j.history.slice(-MAX_HISTORY) : [];
      j.contentHash = contentHash(j);
      return j;
    });
    const active = parsed.filter((j) => j.status === 'open' || j.status === 'claimed' || j.status === 'needs_approval').slice(0, MAX_ACTIVE);
    const done = parsed.filter((j) => j.status === 'done').slice(-MAX_DONE);
    this.jobs = [...active, ...done];
  }
}

function fail(status: number, error: string): PoolFail {
  return { ok: false, status, error };
}

function asActor(actor: PoolActor): PoolActor | undefined {
  const id = actorId(actor?.id);
  const label = displayName(actor?.label) || id;
  if (!id) return undefined;
  return { id, label };
}

function fresh(job: PoolJob, seen: SeenJob): boolean {
  return job.status === seen.state && job.updatedAt === seen.updatedAt;
}

/** Poster, completer, current claimer, or anyone who held the claim. Compared by account id, never by display name. */
function touchedBy(job: PoolJob, id: string): boolean {
  if (job.postedBy === id || job.doneBy === id || job.claim?.by === id) return true;
  return job.history.some((h) => h.by === id);
}

function clampLease(leaseMs: number | undefined): number {
  if (leaseMs === undefined) return LEASE_MS;
  if (!Number.isFinite(leaseMs)) return LEASE_MS;
  return Math.min(LEASE_MS, Math.max(1, Math.floor(leaseMs)));
}

function when(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Date.parse(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function cleanTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const t = displayName(item).slice(0, 40);
    if (t) out.push(t);
    if (out.length >= 8) break;
  }
  return out;
}

function isJob(v: unknown): v is PoolJob {
  if (!v || typeof v !== 'object') return false;
  const j = v as PoolJob;
  return typeof j.id === 'string' && typeof j.title === 'string' && typeof j.status === 'string' && typeof j.updatedAt === 'number';
}

export { emptyBoard };
