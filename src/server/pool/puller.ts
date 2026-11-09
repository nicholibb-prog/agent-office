/**
 * Okkin auto-pull. The pool claims a job, then hands it to an injected runner.
 * A future runner must not be given code, send, money, or network tools.
 * This module does not start a run and does not talk to a model.
 */
export interface PullJob {
  id: string;
  title: string;
  level: number;
}

/** What runs a job after the pool has claimed it. Supplied by the caller. */
export interface PullRunner {
  /** False while a run is in flight. A working bot must not be handed another job. */
  idle(): boolean;
  take(job: PullJob): void;
}

export interface WorkPuller {
  /** Caller id the pool claims as. Comes from the pool policy, not from a name. */
  readonly id: string;
  readonly label: string;
  /** True only when a runner was injected. Auto-pull refuses a puller that is not armed. */
  readonly armed: boolean;
  idle(): boolean;
  take(job: PullJob): void;
}

const quiet: PullRunner = {
  idle: () => true,
  take() {},
};

/**
 * `runner` is required before auto-pull will start. Omitting it leaves the puller unarmed,
 * so the no-op handoff cannot claim jobs on a timer.
 */
export function createOkkinPuller(runner?: PullRunner, actor: { id: string; label: string } = { id: 'okkin', label: 'okkin' }): WorkPuller {
  const run = runner ?? quiet;
  return {
    id: actor.id,
    label: actor.label,
    armed: runner !== undefined,
    idle: () => run.idle(),
    take(job) {
      run.take(job);
    },
  };
}
