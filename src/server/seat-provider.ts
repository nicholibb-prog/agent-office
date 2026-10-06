// Seat providers for the meeting room and the three front desks.
// Ollama when it answers and a model is set; otherwise the bridge outbox. A missing CLI does not spawn.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DESKS } from '../shared/layout.js';
import {
  NEEDS_NICK,
  OFFLINE,
  QUEUED_FOR_CREW,
  defaultSeatProvider,
  frontDeskIds,
  isPluggableSeat,
  latestCrewReply,
  seatTurnTitle,
  appendSeatTurn,
  type CliPresence,
  type OutboxItem,
  type OllamaHealth,
  type SeatProviderId,
} from '../shared/seat-provider.js';
import type { OllamaClientView, SeatFace } from '../shared/protocol/huddle.js';
import { createOllamaClient, loadOllamaFile, type OllamaClient, type OllamaFetch } from './ollama.js';

export type SeatDecision =
  | { action: 'blocked'; message: string }
  | { action: 'queued' }
  | { action: 'ollama' }
  | { action: 'cli' };

function detectCli(): CliPresence {
  const has = (bin: string) => {
    try {
      execFileSync('which', [bin], { stdio: 'ignore', timeout: 1500 });
      return true;
    } catch {
      return false;
    }
  };
  return { claude: has('claude'), grok: has('grok'), 'cursor-agent': has('cursor-agent') };
}

function bridgeOutboxWritable(dir: string): boolean {
  try {
    return existsSync(dir) && statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

export class SeatBoard {
  readonly cli: CliPresence;
  readonly client: OllamaClient;
  ollama: OllamaHealth = 'offline';
  /** False when the bridge outbox directory cannot be written. */
  bridgeUp: boolean;
  private choices = new Map<string, SeatProviderId>();
  private replies = new Map<string, string>();
  private probedAt = 0;
  private readonly outboxFile: string;
  private readonly replyFile: string;

  constructor(
    private dataDir: string,
    private deps: { detect?: () => CliPresence; fetchImpl?: OllamaFetch; now?: () => number; env?: { OLLAMA_URL?: string; OKKIN_MODEL?: string } } = {},
  ) {
    this.cli = (deps.detect ?? detectCli)();
    this.client = createOllamaClient({
      env: deps.env ?? { OLLAMA_URL: process.env.OLLAMA_URL, OKKIN_MODEL: process.env.OKKIN_MODEL },
      file: loadOllamaFile(dataDir),
      fetchImpl: deps.fetchImpl,
    });
    this.bridgeUp = bridgeOutboxWritable(dataDir);
    this.outboxFile = path.join(dataDir, 'kavi-outbox.json');
    this.replyFile = path.join(dataDir, 'seat-replies.json');
    this.loadReplies();
    if (this.client.settings.refused) this.ollama = 'offline';
  }

  get settings() {
    return this.client.settings;
  }

  /** Model name and ready/offline. No URL and no response body. */
  clientView(): OllamaClientView {
    return { model: this.settings.model, state: this.ollama };
  }

  providerFor(seatId: string): SeatProviderId {
    return this.choices.get(seatId) ?? defaultSeatProvider(this.ollama, !!this.settings.model);
  }

  setProvider(seatId: string, provider: SeatProviderId): void {
    if (!isPluggableSeat(seatId, DESKS)) return;
    this.choices.set(seatId, provider);
  }

  async probe(force = false): Promise<void> {
    const now = (this.deps.now ?? Date.now)();
    if (!force && this.probedAt && now - this.probedAt < 5_000) return;
    this.probedAt = now;
    if (this.settings.refused || !this.settings.url) {
      this.ollama = 'offline';
      return;
    }
    this.ollama = await this.client.probe();
  }

  /** What to do with a turn. Does not invent a reply. Bridge queues; ollama is only a plan. */
  decide(floorId: string, seatId: string, text: string): SeatDecision {
    const provider = this.providerFor(seatId);
    const clean = text.trim();
    if (provider === 'ollama') {
      if (this.settings.refused || this.ollama !== 'ready' || !this.settings.model) return { action: 'blocked', message: OFFLINE };
      if (!clean) return { action: 'blocked', message: 'Write a task. Nothing was sent.' };
      return { action: 'ollama' };
    }
    if (provider === 'bridge') {
      if (!this.bridgeUp) return { action: 'blocked', message: NEEDS_NICK };
      if (!clean) return { action: 'blocked', message: 'Write a task. Nothing was sent.' };
      if (!this.queue(floorId, seatId, clean)) return { action: 'blocked', message: NEEDS_NICK };
      return { action: 'queued' };
    }
    if (!this.cli[provider]) return { action: 'blocked', message: NEEDS_NICK };
    return { action: 'cli' };
  }

  queue(floorId: string, seatId: string, text: string): boolean {
    try {
      const items = appendSeatTurn(this.readOutbox(), floorId, seatId, text, new Date().toISOString());
      this.writeOutbox(items);
      return true;
    } catch {
      this.bridgeUp = false;
      return false;
    }
  }

  async runOllama(floorId: string, seatId: string, text: string): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
    await this.probe(true);
    if (this.providerFor(seatId) !== 'ollama') return { ok: false, message: OFFLINE };
    if (this.settings.refused || this.ollama !== 'ready' || !this.settings.model) return { ok: false, message: OFFLINE };
    const result = await this.client.chat(text);
    if (!result.ok) return { ok: false, message: OFFLINE };
    this.replies.set(`${floorId}:${seatId}`, result.text);
    this.persistReplies();
    return { ok: true, text: result.text };
  }

  faces(floorId: string): SeatFace[] {
    const ids = [ 'meeting-room' as const, ...frontDeskIds(DESKS) ];
    const items = this.readOutbox();
    return ids.map((id) => {
      const provider = this.providerFor(id);
      const crew = latestCrewReply(items, floorId, id);
      const reply = this.replies.get(`${floorId}:${id}`) ?? crew?.text ?? null;
      return { id, provider, label: this.label(floorId, id, provider, items), reply };
    });
  }

  private label(floorId: string, id: string, provider: SeatProviderId, items: OutboxItem[]): string {
    if (provider === 'ollama' && (this.settings.refused || this.ollama !== 'ready' || !this.settings.model)) return OFFLINE;
    if (provider !== 'ollama' && provider !== 'bridge' && !this.cli[provider]) return NEEDS_NICK;
    if (provider === 'bridge') {
      if (!this.bridgeUp) return NEEDS_NICK;
      return items.some((it) => it.title === seatTurnTitle(floorId, id)) ? QUEUED_FOR_CREW : 'bridge';
    }
    return provider;
  }

  private readOutbox(): OutboxItem[] {
    try {
      if (!existsSync(this.outboxFile)) return [];
      const raw = JSON.parse(readFileSync(this.outboxFile, 'utf8')) as { items?: OutboxItem[] };
      return Array.isArray(raw.items) ? raw.items : [];
    } catch {
      return [];
    }
  }

  private writeOutbox(items: OutboxItem[]): void {
    writeFileSync(this.outboxFile, JSON.stringify({ items, note: 'crew picks up via local connector' }, null, 2) + '\n', { mode: 0o600 });
  }

  private loadReplies(): void {
    try {
      if (!existsSync(this.replyFile)) return;
      const raw = JSON.parse(readFileSync(this.replyFile, 'utf8')) as { replies?: Record<string, string> };
      for (const [k, v] of Object.entries(raw.replies ?? {})) if (typeof v === 'string' && v.trim()) this.replies.set(k, v);
    } catch {
      /* ignore a bad file */
    }
  }

  private persistReplies(): void {
    const replies = Object.fromEntries(this.replies);
    writeFileSync(this.replyFile, JSON.stringify({ replies }, null, 2) + '\n', { mode: 0o600 });
  }
}
