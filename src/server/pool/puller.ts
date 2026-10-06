/**
 * Okkin auto-pull. The pool claims a job, then hands it to an injected runner.
 * The runner is supplied by the caller. This module does not start a run.
 */
export interface PullJob {
  id: string;
  title: string;
  level: number;
}

/** What runs a job after the pool has claimed it. Wired in by a later change. */
export interface PullRunner {
  /** False while a run is in flight. A working bot must not be handed another job. */
  idle(): boolean;
  take(job: PullJob): void;
}

export interface WorkPuller {
  readonly id: string;
  idle(): boolean;
  take(job: PullJob): void;
}

/** No run. Used until a caller injects a runner. */
const quiet: PullRunner = {
  idle: () => true,
  take() {},
};

export function createOkkinPuller(runner: PullRunner = quiet): WorkPuller {
  return {
    id: 'okkin',
    idle: () => runner.idle(),
    take(job) {
      runner.take(job);
    },
  };
}
