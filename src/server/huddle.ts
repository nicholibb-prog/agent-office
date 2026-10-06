// The meeting-room huddle for one floor: roster, agenda, decision log, and idle workers joining.
// Turns go through SeatBoard. This file does not spawn a CLI and does not mark anyone WORKING.

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { applyBotStep, addDecision, addOccupant, inviteWorker, openHuddle, removeOccupant, setShared, type Huddle } from '../shared/huddle.js';
import { MEETING_SEAT } from '../shared/seat-provider.js';
import { emptyHuddleFloor, type HuddleFloorState } from '../shared/protocol/huddle.js';
import type { WorkerInfo } from '../shared/protocol.js';
import type { SeatBoard } from './seat-provider.js';

const PAST_MAX = 20;
const BOT_COOLDOWN_MS = 60_000;

export class HuddleRoom {
  private view: HuddleFloorState = emptyHuddleFloor();
  private timer: ReturnType<typeof setInterval>;
  private cooldownUntil = 0;
  private readonly file: string;

  constructor(
    private floorId: string,
    dataDir: string,
    private seats: SeatBoard,
    private deps: { workers: () => WorkerInfo[]; emit: (state: HuddleFloorState) => void },
  ) {
    this.file = path.join(dataDir, 'huddle.json');
    this.load();
    this.timer = setInterval(() => void this.tick(), 12_000);
    this.timer.unref?.();
    void this.seats.probe(true).then(() => this.publish());
  }

  state(): HuddleFloorState {
    return this.snapshot();
  }

  publish(): void {
    const state = this.snapshot();
    this.deps.emit(state);
  }

  enter(peer: { id: string; name: string }): void {
    const actor = { kind: 'peer' as const, id: peer.id, name: peer.name.slice(0, 32) };
    const now = Date.now();
    if (!this.view.current) this.view.current = openHuddle(actor, now, this.nid());
    else this.view.current = addOccupant(this.view.current, actor);
    this.save();
    this.publish();
  }

  leave(peerId: string): void {
    if (!this.view.current) return;
    this.applyRemove(removeOccupant(this.view.current, 'peer', peerId));
  }

  invite(peerId: string, workerId: string): string | undefined {
    const h = this.view.current;
    if (!h) return 'Walk into the meeting room first';
    const info = this.deps.workers().find((w) => w.id === workerId);
    if (!info) return 'No such worker';
    const result = inviteWorker(h, peerId, { id: info.id, name: info.name, status: info.status, acked: info.acked });
    if (!result.ok) return result.error;
    this.view.current = result.huddle;
    this.save();
    this.publish();
    return undefined;
  }

  agenda(peerId: string, agenda: string, context: string): string | undefined {
    const h = this.view.current;
    if (!h) return 'Walk into the meeting room first';
    const result = setShared(h, peerId, agenda, context);
    if (!result.ok) return result.error;
    this.view.current = result.huddle;
    this.save();
    this.publish();
    return undefined;
  }

  decide(peerId: string, text: string, owner: string, needsNick: boolean): string | undefined {
    const h = this.view.current;
    if (!h) return 'Walk into the meeting room first';
    const result = addDecision(h, peerId, { id: this.nid(), text, owner, needsNick, at: Date.now() });
    if (!result.ok) return result.error;
    this.view.current = result.huddle;
    this.save();
    this.publish();
    return undefined;
  }

  close(peerId: string): string | undefined {
    const h = this.view.current;
    if (!h) return undefined;
    if (!h.occupants.some((o) => o.kind === 'peer' && o.id === peerId)) return 'Walk into the meeting room first';
    this.archive({ ...h, status: 'closed' });
    this.view.current = null;
    this.cooldownUntil = Date.now() + BOT_COOLDOWN_MS;
    this.save();
    this.publish();
    return undefined;
  }

  /** Send the shared agenda to the seat's provider. No canned text, no WORKING mark. */
  async send(peerId: string): Promise<string | undefined> {
    const h = this.view.current;
    if (!h || !h.occupants.some((o) => o.kind === 'peer' && o.id === peerId)) return 'Walk into the meeting room first';
    const text = [h.agenda, h.context].map((s) => s.trim()).filter(Boolean).join('\n\n');
    const gate = this.seats.decide(this.floorId, MEETING_SEAT, text);
    if (gate.action === 'blocked') return gate.message;
    if (gate.action === 'queued') {
      this.publish();
      return undefined;
    }
    if (gate.action === 'ollama') {
      const result = await this.seats.runOllama(this.floorId, MEETING_SEAT, text);
      this.publish();
      return result.ok ? undefined : result.message;
    }
    return 'That seat is set to a CLI. Nothing was started from the huddle.';
  }

  onWorker(w: WorkerInfo): void {
    if (!this.view.current) return;
    const step = applyBotStep(this.view.current, [{ id: w.id, name: w.name, status: w.status, acked: w.acked }], () => undefined, Date.now(), this.nid);
    if (step.act !== 'leave') return;
    this.view.current = step.huddle;
    if (step.closed) this.archive(step.closed);
    this.save();
    this.publish();
  }

  onWorkerGone(workerId: string): void {
    if (!this.view.current) return;
    this.applyRemove(removeOccupant(this.view.current, 'worker', workerId));
  }

  shutdown(): void {
    clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    await this.seats.probe(false);
    const now = Date.now();
    const workers = this.deps.workers().map((w) => ({ id: w.id, name: w.name, status: w.status, acked: w.acked }));
    const step = applyBotStep(this.view.current, workers, (ids) => ids.slice().sort()[0], now, () => this.nid());
    if (step.act === 'none') return;
    if (step.act === 'start' && now < this.cooldownUntil) return;
    if (step.act === 'start') this.cooldownUntil = now + BOT_COOLDOWN_MS;
    this.view.current = step.huddle;
    if (step.closed) this.archive(step.closed);
    this.save();
    this.publish();
  }

  private applyRemove(next: { open: Huddle | null; closed?: Huddle }): void {
    if (next.open === this.view.current && !next.closed) return;
    this.view.current = next.open;
    if (next.closed) this.archive(next.closed);
    this.save();
    this.publish();
  }

  private archive(closed: Huddle): void {
    this.view.past = [closed, ...this.view.past].slice(0, PAST_MAX);
  }

  private snapshot(): HuddleFloorState {
    return {
      current: this.view.current,
      past: this.view.past,
      seats: this.seats.faces(this.floorId),
      cli: this.seats.cli,
      ollama: this.seats.clientView(),
      defaultProvider: this.seats.ollama === 'ready' && this.seats.settings.model ? 'ollama' : 'bridge',
    };
  }

  private nid(): string {
    return randomBytes(8).toString('hex');
  }

  private load(): void {
    try {
      if (!existsSync(this.file)) return;
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as HuddleFloorState;
      if (raw && (raw.current === null || raw.current?.id)) this.view.current = raw.current ?? null;
      if (Array.isArray(raw?.past)) this.view.past = raw.past.slice(0, PAST_MAX);
    } catch {
      /* start empty */
    }
  }

  private save(): void {
    const body = JSON.stringify({ current: this.view.current, past: this.view.past }, null, 2) + '\n';
    writeFileSync(this.file, body, { mode: 0o600 });
  }
}
