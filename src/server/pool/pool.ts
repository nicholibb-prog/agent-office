import { randomBytes } from 'node:crypto';
import {
  LEASE_MS,
  boardFrom,
  botName,
  claimRefusal,
  displayName,
  emptyBoard,
  enforcedLevel,
  isDan,
  showsWorking,
  unsafeText,
  type PoolBoard,
  type PoolJob,
  type SeenJob,
} from '../../shared/pool.js';
import { CallerBook } from './callers.js';
import { poolPath, readPrivate, writePrivate } from './persist.js';
import { createOkkinPuller, type WorkPuller } from './puller.js';

export interface PoolEvents {
  update?(board: PoolBoard): void;
  /** working only with a live heartbeat. idle when the claim has none. needs_input is the floor's to keep. */
  presence?(name: string, desired: 'working' | 'idle'): void;
}

export type PoolFail = { ok: false; status: number; error: string };
export type PoolOk<T> = { ok: true; value: T } | PoolFail;

const MAX_JOBS = 200;
const TITLE_MAX = 120;
const BODY_MAX = 4000;

export class WorkPool {
  private jobs: PoolJob[] = [];
  private file: string;
  private callers: CallerBook;
  private now: () => number;
  private timer?: ReturnType<typeof setInterval>;
  private puller?: WorkPuller;
  /** Bots we last told the office were working, so a stalled claim can return them to idle. */
  private working = new Set<string>();

  constructor(
    dataDir: string,
    private events: PoolEvents = {},
    opts: { now?: () => number; autoPull?: boolean; puller?: WorkPuller } = {},
  ) {
    this.file = poolPath(dataDir, 'work-pool.json');
    this.callers = new CallerBook(dataDir);
    this.now = opts.now ?? Date.now;
    this.restore();
    if (opts.autoPull) {
      this.puller = opts.puller ?? createOkkinPuller();
      this.timer = setInterval(() => this.tick(), 5_000);
      this.timer.unref?.();
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  registerCaller(name: unknown) {
    return this.callers.register(name);
  }

  callerName(token: string): string | undefined {
    return this.callers.nameFor(token);
  }

  board(): PoolBoard {
    this.sweep();
    return boardFrom(this.jobs, this.now());
  }

  get(id: string): PoolJob | undefined {
    this.sweep();
    return this.jobs.find((j) => j.id === id);
  }

  post(input: { title: unknown; body: unknown; level?: unknown; targetBot?: unknown; tags?: unknown; notBefore?: unknown }, postedBy: string): PoolOk<PoolJob> {
    const title = displayName(input.title).slice(0, TITLE_MAX);
    const body = typeof input.body === 'string' ? input.body.replace(/\r\n?/g, '\n').trim().slice(0, BODY_MAX) : '';
    const by = displayName(postedBy);
    if (!title) return fail(400, 'title required');
    if (!body) return fail(400, 'body required');
    if (!by) return fail(400, 'caller identity required');
    const tags = cleanTags(input.tags);
    const text = `${title}\n${body}\n${tags.join(' ')}`;
    if (unsafeText(text) || unsafeText(by)) return fail(400, 'that text cannot be stored');
    if (this.jobs.filter((j) => j.status !== 'done').length >= MAX_JOBS) return fail(400, 'the pool is full');
    const target = displayName(input.targetBot);
    if (target && unsafeText(target)) return fail(400, 'that text cannot be stored');
    const notBefore = when(input.notBefore);
    if (input.notBefore !== undefined && input.notBefore !== null && notBefore === undefined) return fail(400, 'notBefore must be a time');
    const now = this.now();
    const job: PoolJob = {
      id: randomBytes(6).toString('hex'),
      title,
      body,
      level: enforcedLevel(input.level, text),
      ...(target ? { targetBot: target } : {}),
      postedBy: by,
      createdAt: now,
      updatedAt: now,
      ...(notBefore !== undefined ? { notBefore } : {}),
      tags,
      status: 'open',
      history: [],
    };
    this.jobs.push(job);
    this.changed();
    return { ok: true, value: job };
  }

  claim(id: string, byRaw: string, leaseMs?: number): PoolOk<PoolJob> {
    this.sweep();
    const by = displayName(byRaw);
    if (!by) return fail(400, 'caller identity required');
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return fail(404, 'no such job');
    if (job.status !== 'open') return fail(409, 'job is not open');
    const now = this.now();
    if (job.notBefore !== undefined && now < job.notBefore) return fail(409, 'not open yet');
    const why = claimRefusal(job.level, by, job.targetBot);
    if (why) return fail(403, why);
    if (this.liveClaim(by, now)) return fail(409, 'finish or release the job you already hold');
    const lease = clampLease(leaseMs);
    job.status = 'claimed';
    job.claim = { by, at: now, leaseUntil: now + lease, leaseMs: lease };
    job.history.push({ by, at: now, leaseUntil: now + lease });
    this.touch(job, now);
    this.syncPresence();
    this.changed();
    return { ok: true, value: job };
  }

  heartbeat(id: string, byRaw: string): PoolOk<PoolJob> {
    this.sweep();
    const by = displayName(byRaw);
    const job = this.jobs.find((j) => j.id === id);
    if (!job?.claim || job.status !== 'claimed') return fail(409, 'no live claim');
    if (botName(job.claim.by) !== botName(by)) return fail(403, 'only the claimer can heartbeat');
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

  release(id: string, byRaw: string): PoolOk<PoolJob> {
    this.sweep();
    const job = this.jobs.find((j) => j.id === id);
    if (!job?.claim || job.status !== 'claimed') return fail(409, 'no live claim');
    if (botName(job.claim.by) !== botName(byRaw)) return fail(403, 'only the claimer can release');
    this.endClaim(job, 'released');
    this.changed();
    return { ok: true, value: job };
  }

  /** Levels 1–5 become done. Levels 6–7 become needs approval. The pool never runs the action. */
  complete(id: string, byRaw: string): PoolOk<PoolJob> {
    this.sweep();
    const job = this.jobs.find((j) => j.id === id);
    if (!job?.claim || job.status !== 'claimed') return fail(409, 'no live claim');
    if (botName(job.claim.by) !== botName(byRaw)) return fail(403, 'only the claimer can complete');
    const now = this.now();
    const by = job.claim.by;
    this.endClaim(job, 'completed');
    job.doneBy = by;
    job.completedAt = now;
    if (job.level >= 6) {
      job.status = 'needs_approval';
      job.approval = job.level >= 7 ? 'nick-yes' : 'dan-pass';
    } else {
      job.status = 'done';
    }
    this.touch(job, now);
    this.changed();
    return { ok: true, value: job };
  }

  /**
   * Level 6 only. The actor must already be Dan. This records the pass and leaves the job
   * in needs approval for a human Nick yes. It does not mark the job done.
   */
  danPass(id: string, actorRaw: string, seen: SeenJob): PoolOk<PoolJob> {
    this.sweep();
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return fail(404, 'no such job');
    if (!fresh(job, seen)) return fail(409, 'stale');
    if (!isDan(actorRaw)) return fail(403, 'only Dan can record a Dan pass');
    if (job.status !== 'needs_approval' || job.level !== 6 || job.approval !== 'dan-pass') return fail(409, 'job is not waiting on a Dan pass');
    const now = this.now();
    job.danPass = { by: displayName(actorRaw), at: now };
    job.approval = 'nick-yes';
    this.touch(job, now);
    this.changed();
    return { ok: true, value: job };
  }

  /**
   * Human Nick yes. The approver name is the office session, passed in by the route.
   * Level 6 must already have a Dan pass. Level 7 is Nick yes from the start.
   */
  nickYes(id: string, approverRaw: string, seen: SeenJob): PoolOk<PoolJob> {
    this.sweep();
    const approver = displayName(approverRaw);
    if (!approver) return fail(401, 'human session required');
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return fail(404, 'no such job');
    if (!fresh(job, seen)) return fail(409, 'stale');
    if (job.status !== 'needs_approval' || (job.level !== 6 && job.level !== 7)) return fail(409, 'job is not waiting on approval');
    if (job.level === 6 && !job.danPass) return fail(403, 'Dan pass is required');
    if (job.approval !== 'nick-yes') return fail(409, 'job is not waiting on a Nick yes');
    const now = this.now();
    job.status = 'done';
    job.approvedBy = approver;
    job.approval = 'nick-yes';
    this.touch(job, now);
    this.changed();
    return { ok: true, value: job };
  }

  /** Next job this bot may claim. Refuses while they are WORKING or already hold a claim. */
  pull(byRaw: string): PoolOk<PoolJob> {
    this.sweep();
    const by = displayName(byRaw);
    if (!by) return fail(400, 'caller identity required');
    const now = this.now();
    const held = this.liveClaim(by, now);
    if (held && showsWorking(held, now)) return fail(409, 'already working');
    if (held) return fail(409, 'already claimed');
    const next = this.jobs
      .filter((j) => j.status === 'open' && (j.notBefore === undefined || now >= j.notBefore) && !claimRefusal(j.level, by, j.targetBot))
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!next) return fail(404, 'nothing to pull');
    return this.claim(next.id, by);
  }

  private tick() {
    this.sweep();
    const puller = this.puller;
    if (!puller || !puller.idle()) return;
    const now = this.now();
    const held = this.liveClaim(puller.id, now);
    if (held && showsWorking(held, now)) return;
    if (held) return;
    const result = this.pull(puller.id);
    if (result.ok) puller.take({ id: result.value.id, title: result.value.title, level: result.value.level });
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

  private liveClaim(by: string, now: number): PoolJob | undefined {
    return this.jobs.find((j) => j.status === 'claimed' && j.claim && botName(j.claim.by) === botName(by) && now < j.claim.leaseUntil);
  }

  private touch(job: PoolJob, now: number) {
    job.updatedAt = Math.max(now, job.updatedAt + 1);
  }

  private syncPresence() {
    const now = this.now();
    const want = new Map<string, 'working' | 'idle'>();
    for (const job of this.jobs) {
      if (job.status !== 'claimed' || !job.claim) continue;
      const name = job.claim.by;
      want.set(botName(name), showsWorking(job, now) ? 'working' : 'idle');
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
    this.jobs = jobs.filter(isJob).slice(0, MAX_JOBS);
  }
}

function fail(status: number, error: string): PoolFail {
  return { ok: false, status, error };
}

function fresh(job: PoolJob, seen: SeenJob): boolean {
  return job.status === seen.state && job.updatedAt === seen.updatedAt;
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
