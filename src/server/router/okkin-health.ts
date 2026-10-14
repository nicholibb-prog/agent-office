// Okkin health (funnel #29, #30): a 60 s ping of the local Ollama, gated on the Okkin power switch
// (#56). While Okkin is down or switched off, private and secret tasks QUEUE; they never fall
// over to the cloud.
export const OKKIN_PING_MS = 60_000;

export class OkkinHealth {
  private up = false;
  private timer?: ReturnType<typeof setInterval>;
  private lastPing = 0;
  constructor(
    private opts: {
      probe: () => Promise<'ready' | 'offline'>;
      /** The loft power switch: OFF means Okkin is not available, whatever the probe says. */
      poweredOn?: () => boolean;
      now?: () => number;
    },
  ) {}
  async ping(): Promise<boolean> {
    this.lastPing = (this.opts.now ?? Date.now)();
    try {
      this.up = (this.opts.poweredOn?.() ?? true) && (await this.opts.probe()) === 'ready';
    } catch {
      this.up = false;
    }
    return this.up;
  }
  /** Healthy only on a recent (≤2 pings old) successful probe with the switch on. */
  ok(): boolean {
    if (!(this.opts.poweredOn?.() ?? true)) return false;
    const age = (this.opts.now ?? Date.now)() - this.lastPing;
    return this.up && age <= 2 * OKKIN_PING_MS;
  }
  start() {
    void this.ping();
    this.timer = setInterval(() => void this.ping(), OKKIN_PING_MS);
    this.timer.unref?.();
  }
  stop() { clearInterval(this.timer); }
}
