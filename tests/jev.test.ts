import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  JEV_MILESTONE_SCORE,
  applyAdd,
  parseJevLine,
  rankBoard,
  rankScore,
  seedAgents,
} from '../src/shared/jev.js';
import { JevStore } from '../src/server/jev/store.js';
import { paintJevBoard } from '../src/client/features/jev/paint.js';

function tempDir(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'jev-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('seeded agents rank Nova, Quill, then Bramble, and break-room time pulls a score down', () => {
  const board = rankBoard(seedAgents(), '2026-01-15T12:00:00.000Z');
  assert.deepEqual(
    board.rankings.map((row) => row.agentId),
    ['nova', 'quill', 'bramble'],
  );
  assert.equal(board.rankings[0].rank, 1);
  assert.equal(board.rankings[0].rankScore, 4322);
  assert.equal(board.rankings[1].rankScore, 1900);
  assert.equal(board.rankings[2].rankScore, 10);
  assert.ok(board.rankings[0].rankScore >= JEV_MILESTONE_SCORE);
  assert.ok(board.rankings[1].rankScore >= JEV_MILESTONE_SCORE);
  assert.ok(board.rankings[2].rankScore < JEV_MILESTONE_SCORE);

  const quiet = rankScore({ linesWritten: 100, prsMerged: 0, tasksFinished: 0, breakroomSeconds: 0 });
  const resting = rankScore({ linesWritten: 100, prsMerged: 0, tasksFinished: 0, breakroomSeconds: 1000 });
  assert.equal(quiet, 100);
  assert.equal(resting, 0);
});

test('a negative delta cannot push a count below zero, and only new work refreshes lastActiveAt', () => {
  const [bramble] = seedAgents().slice(2);
  const next = applyAdd(bramble, { linesWritten: -10_000 }, '2026-04-01T00:00:00.000Z');
  assert.equal(next.linesWritten, 0);
  assert.equal(next.lastActiveAt, bramble.lastActiveAt);
  const worked = applyAdd(bramble, { prsMerged: 1 }, '2026-04-01T00:00:00.000Z');
  assert.equal(worked.prsMerged, 1);
  assert.equal(worked.lastActiveAt, '2026-04-01T00:00:00.000Z');
});

test('a metric line is accepted, and a path, a token, or Major Files is refused whole', () => {
  const ok = parseJevLine('jev agent=nova name="Nova" desk=desk-1 lines=+12 prs=+1 tasks=+1 breakroom=+30');
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.agentId, 'nova');
    assert.equal(ok.displayName, 'Nova');
    assert.equal(ok.deskId, 'desk-1');
    assert.deepEqual(ok.add, { linesWritten: 12, prsMerged: 1, tasksFinished: 1, breakroomSeconds: 30 });
  }
  for (const line of [
    'jev agent=nova lines=+1 /home/someone/.ssh/id_rsa',
    'jev agent=nova lines=+1 ghp_abcdefghijklmnop',
    'jev agent=nova name="see Major Files" lines=+4',
    'jev agent=nova name="api key is here" lines=+1',
  ]) {
    const refused = parseJevLine(line);
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.reason, 'redacted');
  }
});

test('the JSON file is seeded, a delta sticks, a hand edit is re-read, and a secret name is dropped', (t) => {
  const dir = tempDir(t);
  const now = '2026-03-01T00:00:00.000Z';
  const store = new JevStore(dir, () => now);
  const saved = JSON.parse(readFileSync(store.path, 'utf8')) as { agents: { agentId: string; rankScore: number }[] };
  assert.deepEqual(
    saved.agents.map((agent) => agent.agentId),
    ['nova', 'quill', 'bramble'],
  );
  assert.equal(saved.agents[0].rankScore, 4322);

  const added = store.add({ agentId: 'nova', add: { linesWritten: 10, prsMerged: 1 } });
  assert.equal(typeof added, 'object');
  const reopened = new JevStore(dir, () => '2026-03-02T00:00:00.000Z');
  const nova = reopened.board().rankings.find((row) => row.agentId === 'nova');
  assert.equal(nova?.linesWritten, 1850);
  assert.equal(nova?.prsMerged, 4);

  const raw = JSON.parse(readFileSync(store.path, 'utf8')) as {
    agents: { agentId: string; linesWritten: number; prsMerged: number; tasksFinished: number; breakroomSeconds: number; rankScore: number; displayName: string }[];
  };
  const row = raw.agents.find((agent) => agent.agentId === 'nova')!;
  row.linesWritten = 10;
  row.prsMerged = 0;
  row.tasksFinished = 0;
  row.breakroomSeconds = 0;
  row.rankScore = 1;
  raw.agents.push({ agentId: 'leak', displayName: 'my token', linesWritten: 9, prsMerged: 0, tasksFinished: 0, breakroomSeconds: 0, rankScore: 9 });
  writeFileSync(store.path, JSON.stringify(raw));
  const later = new Date(Date.now() + 10_000);
  utimesSync(store.path, later, later);

  const board = reopened.board();
  const edited = board.rankings.find((agent) => agent.agentId === 'nova');
  assert.equal(edited?.rankScore, 10);
  assert.equal(edited?.linesWritten, 10);
  assert.equal(
    board.rankings.some((agent) => agent.agentId === 'leak'),
    false,
  );
  assert.doesNotMatch(readFileSync(store.path, 'utf8'), /token/);
});

test('ingesting a redacted line does not change the file, and a plain line does', (t) => {
  const dir = tempDir(t);
  const store = new JevStore(dir, () => '2026-05-01T00:00:00.000Z');
  const before = readFileSync(store.path, 'utf8');
  const refused = store.ingest('jev agent=nova lines=+5 ~/secrets/major-files.txt');
  assert.equal(refused.ok, false);
  assert.equal(readFileSync(store.path, 'utf8'), before);
  const accepted = store.ingest('jev agent=bramble lines=+5');
  assert.equal(accepted.ok, true);
  if (accepted.ok) {
    const bramble = accepted.board.rankings.find((row) => row.agentId === 'bramble');
    assert.equal(bramble?.linesWritten, 425);
  }
});

test('the board face names the seeded agents and skips a row that looks like a path', () => {
  const ops: { kind: string; args: unknown[] }[] = [];
  const ctx = {
    fillStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
    fillRect() {},
    beginPath() {},
    arc() {},
    fill() {},
    fillText(...args: unknown[]) {
      ops.push({ kind: 'fillText', args });
    },
  } as unknown as CanvasRenderingContext2D;
  const board = rankBoard(seedAgents(), '2026-01-15T12:00:00.000Z');
  board.rankings.push({
    agentId: 'path',
    displayName: '/tmp/secret',
    linesWritten: 1,
    prsMerged: 0,
    tasksFinished: 0,
    breakroomSeconds: 0,
    lastActiveAt: '2026-01-15T12:00:00.000Z',
    rankScore: 1,
    rank: 4,
  });
  paintJevBoard(ctx, 1024, 640, board);
  const text = ops.map((op) => String(op.args[0]));
  assert.ok(text.includes('Nova'));
  assert.ok(text.includes('Quill'));
  assert.ok(text.includes('Bramble'));
  assert.equal(text.some((line) => line.includes('/tmp')), false);
});
