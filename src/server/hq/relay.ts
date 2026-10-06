// Gitignored relay files under the office data dir (.agent-office/). Mode 0600.
// George (a separate process) syncs the outbox and inbox. This module does not know Drive ids.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EMPTY_CARD, isSeatId, outboxLine, sanitizeCard, type DeskCard, type OutboxLine, type SeatId, type TalkMessage } from '../../shared/hq.js';

type ThreadsFile = { threads: Partial<Record<SeatId, TalkMessage[]>> };
type CardsFile = { updatedAt: string; cards: Partial<Record<SeatId, DeskCard>> };

function dirMode(file: string) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
}

function writeJson(file: string, value: unknown) {
  dirMode(file);
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function outboxPath(dataDir: string) {
  return path.join(dataDir, 'chat-outbox.jsonl');
}

export function inboxPath(dataDir: string) {
  return path.join(dataDir, 'chat-inbox.jsonl');
}

function threadsPath(dataDir: string) {
  return path.join(dataDir, 'talk-threads.json');
}

function cardsPath(dataDir: string) {
  return path.join(dataDir, 'desk-cards.json');
}

/** Appends one outbox line. Returns the line, or null when there is nothing to say. Never writes a crew reply by itself. */
export function appendOutbox(dataDir: string, input: { kind: OutboxLine['kind']; role: OutboxLine['role']; text: string; at: number; seat?: string }): OutboxLine | null {
  const line = outboxLine(input);
  if (!line) return null;
  const file = outboxPath(dataDir);
  dirMode(file);
  appendFileSync(file, JSON.stringify(line) + '\n', { mode: 0o600 });
  return line;
}

/** A player line from T-chat or a talk thread. There is no automatic crew reply. */
export function notePlayerChat(dataDir: string, input: { text: string; at: number; seat?: string; kind?: OutboxLine['kind'] }): { reply: null; line: OutboxLine | null } {
  const line = appendOutbox(dataDir, { kind: input.kind ?? (input.seat ? 'talk' : 'tchat'), role: 'player', text: input.text, at: input.at, seat: input.seat });
  return { reply: null, line };
}

export function readThread(dataDir: string, seat: SeatId): TalkMessage[] {
  const file = readJson<ThreadsFile>(threadsPath(dataDir), { threads: {} });
  return file.threads[seat] ?? [];
}

export function appendThread(dataDir: string, seat: SeatId, message: TalkMessage): TalkMessage[] {
  const file = readJson<ThreadsFile>(threadsPath(dataDir), { threads: {} });
  const prev = file.threads[seat] ?? [];
  const next = [...prev, message].slice(-80);
  file.threads[seat] = next;
  writeJson(threadsPath(dataDir), file);
  return next;
}

export function readCards(dataDir: string): Partial<Record<SeatId, DeskCard>> {
  return readJson<CardsFile>(cardsPath(dataDir), { updatedAt: '', cards: {} }).cards;
}

export function writeCard(dataDir: string, seat: SeatId, raw: unknown): DeskCard {
  const file = readJson<CardsFile>(cardsPath(dataDir), { updatedAt: '', cards: {} });
  const card = sanitizeCard(raw);
  file.cards[seat] = card;
  file.updatedAt = new Date().toISOString();
  writeJson(cardsPath(dataDir), file);
  return card;
}

export function cardFor(dataDir: string, seat: SeatId): DeskCard {
  return readCards(dataDir)[seat] ?? EMPTY_CARD;
}

/**
 * Applies inbox lines a sync process dropped. Only well-formed bot lines for a generic seat are kept.
 * Okkin is skipped: Okkin speaks through Ollama, not an inbox file. Nothing is invented.
 */
export function ingestInbox(dataDir: string): number {
  const file = inboxPath(dataDir);
  if (!existsSync(file)) return 0;
  const cursorFile = path.join(dataDir, 'chat-inbox.offset');
  let offset = 0;
  try {
    if (existsSync(cursorFile)) offset = Number(readFileSync(cursorFile, 'utf8')) || 0;
  } catch {
    offset = 0;
  }
  let raw = '';
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return 0;
  }
  if (offset > raw.length) offset = 0;
  const slice = raw.slice(offset);
  let applied = 0;
  for (const row of slice.split('\n')) {
    if (!row.trim()) continue;
    let parsed: Partial<OutboxLine> | null = null;
    try {
      parsed = JSON.parse(row) as Partial<OutboxLine>;
    } catch {
      continue;
    }
    if (parsed?.v !== 1 || parsed.role !== 'bot' || typeof parsed.text !== 'string' || !parsed.seat || !isSeatId(parsed.seat)) continue;
    if (parsed.seat === 'okkin') continue;
    const at = Date.parse(String(parsed.at ?? ''));
    appendThread(dataDir, parsed.seat, {
      id: `in-${applied}-${Number.isFinite(at) ? at : 0}`,
      role: 'bot',
      text: parsed.text.slice(0, 500),
      at: Number.isFinite(at) ? at : Date.now(),
    });
    applied++;
  }
  try {
    writeFileSync(cursorFile, String(raw.length), { mode: 0o600 });
  } catch {
    /* the next read retries */
  }
  return applied;
}
