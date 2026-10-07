// Reads and writes the gitignored HQ files the unblock queue and morning digest are built from.
// Titles and states only. A body, essay, or note on a record is dropped.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildDigest,
  collectItems,
  digestHasLines,
  fileBlock,
  fileItem,
  headlineFor,
  liveBlock,
  mergeBlocks,
  sinceOf,
  type BoardItem,
  type Brief,
  type LiveTask,
  type LiveWorker,
  type Decision,
  type SeatBook,
} from '../../shared/hq-brief.js';
import { loadHqLocal, type HqLocal } from '../workers/crew.js';

const ANSWER_CAP = 40;

export type Answered = { id: string; answer: 'yes' | 'no'; at: number; by: string };

type NeedsFile = { updatedAt?: string; blocks?: unknown[]; answered?: Answered[] };
type BoardFile = { updatedAt?: string; items?: unknown[] };

export function hqPaths(dataDir: string) {
  return {
    needs: path.join(dataDir, 'unblock.json'),
    board: path.join(dataDir, 'board-status.json'),
    visit: path.join(dataDir, 'last-visit.json'),
    local: path.join(dataDir, 'workers.json'),
  };
}

function readJson(file: string): unknown {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function writeJson(file: string, body: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(body, null, 2) + '\n', { mode: 0o600 });
}

export function bookOf(hq: HqLocal): SeatBook {
  return { seats: hq.seats, crewKeysLower: hq.crewKeysLower };
}

export function loadBook(dataDir: string): { hq: HqLocal; book: SeatBook } {
  const hq = loadHqLocal(hqPaths(dataDir).local);
  return { hq, book: bookOf(hq) };
}

function readAnswered(raw: unknown): Answered[] {
  const items = raw && typeof raw === 'object' ? (raw as NeedsFile).answered : undefined;
  if (!Array.isArray(items)) return [];
  const out: Answered[] = [];
  for (const a of items) {
    if (!a || (a.answer !== 'yes' && a.answer !== 'no') || typeof a.id !== 'string' || typeof a.at !== 'number') continue;
    out.push({ id: a.id, answer: a.answer, at: a.at, by: typeof a.by === 'string' ? a.by : '' });
  }
  return out.slice(-ANSWER_CAP);
}

export function readBlocks(dataDir: string, book: SeatBook): Decision[] {
  const raw = readJson(hqPaths(dataDir).needs) as NeedsFile | null;
  if (!raw || !Array.isArray(raw.blocks)) return [];
  return raw.blocks.map((b) => fileBlock(b, book)).filter((b): b is Decision => !!b);
}

export function readItems(dataDir: string, book: SeatBook): BoardItem[] {
  const raw = readJson(hqPaths(dataDir).board) as BoardFile | null;
  if (!raw || !Array.isArray(raw.items)) return [];
  return raw.items.map((b) => fileItem(b, book)).filter((b): b is BoardItem => !!b);
}

export function readVisit(dataDir: string): number | undefined {
  const raw = readJson(hqPaths(dataDir).visit) as { at?: unknown } | null;
  return raw && typeof raw.at === 'number' ? raw.at : undefined;
}

function storedBlock(b: Decision) {
  return { id: b.id, seat: b.seat, title: b.title, kind: b.kind, actionable: true as const, at: b.at, workerId: b.workerId };
}

export function saveBlocks(dataDir: string, rawBlocks: unknown[]): number {
  const { book } = loadBook(dataDir);
  const prev = readJson(hqPaths(dataDir).needs);
  const blocks = rawBlocks.map((b) => fileBlock(b, book)).filter((b): b is Decision => !!b);
  writeJson(hqPaths(dataDir).needs, {
    updatedAt: new Date().toISOString(),
    blocks: blocks.map(storedBlock),
    answered: readAnswered(prev),
  });
  return blocks.length;
}

export function saveItems(dataDir: string, rawItems: unknown[]): number {
  const { book } = loadBook(dataDir);
  const items = rawItems.map((b) => fileItem(b, book)).filter((b): b is BoardItem => !!b);
  writeJson(hqPaths(dataDir).board, { updatedAt: new Date().toISOString(), items });
  return items.length;
}

/** Drops a file block and remembers who tapped. Returns whether that id was in the file. */
export function answerBlock(dataDir: string, id: string, answer: 'yes' | 'no', at: number, by: string): boolean {
  const { book } = loadBook(dataDir);
  const prev = readJson(hqPaths(dataDir).needs) as NeedsFile | null;
  const blocks = readBlocks(dataDir, book);
  const hit = blocks.some((b) => b.id === id);
  const answered = [...readAnswered(prev), { id, answer, at, by: by.slice(0, 80) }].slice(-ANSWER_CAP);
  writeJson(hqPaths(dataDir).needs, {
    updatedAt: new Date().toISOString(),
    blocks: blocks.filter((b) => b.id !== id).map(storedBlock),
    answered,
  });
  return hit;
}

export function markSeen(dataDir: string, at: number) {
  writeJson(hqPaths(dataDir).visit, { at });
}

export function readBrief(dataDir: string, workers: readonly LiveWorker[], tasks: readonly LiveTask[], requestedSince: number | undefined, now: number): Brief {
  const { hq, book } = loadBook(dataDir);
  const live = workers.map((w) => liveBlock(w, book)).filter((b): b is Decision => !!b);
  const blocks = mergeBlocks(readBlocks(dataDir, book), live);
  const items = collectItems(readItems(dataDir, book), workers, tasks, book);
  const since = sinceOf(requestedSince, readVisit(dataDir), now);
  return { headline: headlineFor(hq.humanMapsTo), blocks, digest: buildDigest(items, since, now) };
}

export { digestHasLines };
