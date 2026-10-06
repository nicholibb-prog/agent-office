import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  EMPTY_BOOK,
  FIRST_WINDOW_MS,
  LINE_CAP,
  acceptSeat,
  ageLabel,
  answerKey,
  buildDigest,
  collectItems,
  fileBlock,
  fileItem,
  headlineFor,
  liveBlock,
  mergeBlocks,
  seatKey,
  sinceOf,
  workerItems,
  type LiveTask,
  type LiveWorker,
  type SeatBook,
} from '../src/shared/hq-brief.js';
import { answerBlock, readBrief, saveBlocks, saveItems } from '../src/server/hq/brief.js';
import { loadHqLocal } from '../src/server/workers/crew.js';

const book: SeatBook = {
  seats: { 'desk-1': 'seat-a', 'local-label': 'seat-b' },
  crewKeysLower: ['seat-a', 'seat-b'],
};

function desk(partial: Partial<LiveWorker> & Pick<LiveWorker, 'id' | 'status'>): LiveWorker {
  return {
    deskId: 'desk-1',
    name: 'local-label',
    createdAt: 1_000,
    ...partial,
  };
}

test('seat key comes from the local book; an unmapped name becomes the desk id', () => {
  assert.equal(seatKey('local-label', 'desk-9', book), 'seat-b');
  assert.equal(seatKey('someone', 'desk-1', book), 'seat-a');
  assert.equal(seatKey('someone', 'desk-4', EMPTY_BOOK), 'desk-4');
  assert.equal(seatKey('someone', undefined, EMPTY_BOOK), 'seat');
  assert.equal(acceptSeat('seat-a', EMPTY_BOOK), 'seat-a');
  assert.equal(acceptSeat('person', EMPTY_BOOK), null);
});

test('age is always a short count, including the first minute', () => {
  assert.equal(ageLabel(0, 5_000), '5s');
  assert.equal(ageLabel(0, 90_000), '1m');
  assert.equal(ageLabel(0, 3_600_000), '1h');
  assert.equal(ageLabel(0, 3 * 86_400_000), '3d');
});

test('yes and no are the permission keys, nothing else', () => {
  assert.equal(answerKey('yes'), '1');
  assert.equal(answerKey('no'), '2');
});

test('the strip headline is a local token or a fixed phrase', () => {
  assert.equal(headlineFor(''), 'Needs a decision');
  assert.equal(headlineFor('operator'), 'Needs operator');
  assert.equal(headlineFor('Has A Space'), 'Needs a decision');
});

test('only an actionable yes/no or talk block is queued', () => {
  const yes = fileBlock({ id: 'b1', seat: 'seat-a', title: 'Approve npm test', kind: 'yesno', actionable: true, at: 50 }, book);
  assert.deepEqual(yes, { id: 'b1', seat: 'seat-a', title: 'Approve npm test', kind: 'yesno', at: 50, workerId: undefined });
  assert.equal(fileBlock({ id: 'b2', seat: 'seat-a', title: 'Approve npm test', kind: 'yesno', actionable: false, at: 50 }, book), null);
  assert.equal(fileBlock({ id: 'b3', seat: 'seat-a', title: 'A note', kind: 'note', actionable: true, at: 50 }, book), null);
  assert.equal(fileBlock({ id: 'b4', seat: 'seat-a', title: 'Approve', kind: 'yesno', actionable: true, at: 50, essay: 'a long writeup' }, book), null);
  assert.equal(fileBlock({ id: 'b5', seat: 'seat-a', title: 'line\nbreak', kind: 'talk', actionable: true, at: 50 }, book), null);
  assert.equal(fileBlock({ id: 'b6', seat: 'seat-a', title: 'x'.repeat(81), kind: 'talk', actionable: true, at: 50 }, book), null);
  assert.equal(fileBlock({ id: 'b7', seat: 'not-a-seat', title: 'Open the login', kind: 'talk', actionable: true, at: 50 }, book)?.seat, 'seat');
});

test('a live desk is a block only while it needs input, with a short ask', () => {
  const ask = liveBlock(desk({ id: 'w1', status: 'needs_input', activity: 'Wants permission: Bash: npm test', waitingSince: 40 }), book);
  assert.equal(ask?.kind, 'yesno');
  assert.equal(ask?.seat, 'seat-a');
  assert.equal(liveBlock(desk({ id: 'w1b', deskId: 'desk-9', status: 'needs_input', activity: 'Not logged in', waitingSince: 40 }), book)?.seat, 'seat-b');
  assert.equal(ask?.title, 'Wants permission: Bash: npm test');
  assert.notEqual(ask?.seat, 'local-label');
  assert.equal(liveBlock(desk({ id: 'w2', status: 'working', activity: 'Wants permission: Bash: npm test' }), book), null);
  assert.equal(liveBlock(desk({ id: 'w3', status: 'needs_input', activity: 'x'.repeat(201) }), book), null);
  assert.equal(liveBlock(desk({ id: 'w4', status: 'idle' }), book), null);
  const talk = liveBlock(desk({ id: 'w5', status: 'needs_input', activity: 'Not logged in', waitingSince: 10 }), book);
  assert.equal(talk?.kind, 'talk');
});

test('live rows replace a file row for the same worker, oldest wait first', () => {
  const file = fileBlock({ id: 'b1', seat: 'seat-a', title: 'Approve npm test', kind: 'yesno', actionable: true, at: 10, workerId: 'w1' }, book)!;
  const other = fileBlock({ id: 'b2', seat: 'seat-b', title: 'Sign in', kind: 'talk', actionable: true, at: 5 }, book)!;
  const live = liveBlock(desk({ id: 'w1', status: 'needs_input', activity: 'Wants permission: Bash: npm test', waitingSince: 30 }), book)!;
  const merged = mergeBlocks([file, other], [live]);
  assert.deepEqual(merged.map((b) => b.id), ['b2', 'live:w1']);
});

test('morning delta is newest first, grouped by seat, and capped', () => {
  const now = 10_000;
  const since = 100;
  const items = [];
  for (let i = 0; i < LINE_CAP + 2; i++) {
    items.push({ id: `d${i}`, seat: i % 2 ? 'seat-b' : 'seat-a', title: `done ${i}`, state: 'done' as const, at: 200 + i });
  }
  items.push({ id: 'old', seat: 'seat-a', title: 'already seen', state: 'done' as const, at: 50 });
  items.push({ id: 'run', seat: 'seat-a', title: 'Ship the queue', state: 'progress' as const, at: 900 });
  items.push({ id: 'blk', seat: 'seat-b', title: 'Approve npm test', state: 'blocked' as const, at: 800 });
  const digest = buildDigest(items, since, now);
  assert.equal(digest.done.capped, true);
  assert.equal(digest.done.seats.reduce((n, s) => n + s.lines.length, 0), LINE_CAP);
  assert.equal(digest.done.seats[0].lines[0].title, `done ${LINE_CAP + 1}`);
  assert.deepEqual(digest.progress.seats.map((s) => s.seat), ['seat-a']);
  assert.deepEqual(digest.blocked.seats.map((s) => s.seat), ['seat-b']);
  assert.equal(digest.done.seats.some((s) => s.lines.some((l) => l.title === 'already seen')), false);
  const seats = digest.done.seats.map((s) => s.seat);
  assert.deepEqual(seats, [...new Set(seats)]);
  for (const group of digest.done.seats) {
    const times = group.lines.map((l) => l.at);
    assert.deepEqual(times, [...times].sort((a, b) => b - a));
  }
});

test('desks and queue tasks become status lines; idle and essays do not', () => {
  const workers: LiveWorker[] = [
    desk({ id: 'w1', status: 'done', taskName: 'Ship the queue', waitingSince: 500 }),
    desk({ id: 'w2', status: 'working', taskName: 'Board titles', lastInputAt: 600 }),
    desk({ id: 'w3', status: 'needs_input', activity: 'Not logged in', waitingSince: 700 }),
    desk({ id: 'w4', status: 'idle', activity: 'sitting' }),
    desk({ id: 'w5', status: 'working', activity: 'x'.repeat(201), lastInputAt: 800 }),
  ];
  const tasks: LiveTask[] = [
    { id: 't1', title: 'Write the notes', status: 'done', addedAt: 1, finishedAt: 900, workerId: 'w1' },
    { id: 't2', title: 'Still queued', status: 'queued', addedAt: 2 },
    { id: 't3', title: 'y'.repeat(90), status: 'running', addedAt: 3, startedAt: 4 },
  ];
  const items = collectItems(
    [fileItem({ id: 'f1', seat: 'seat-b', title: 'Review the diff', state: 'blocked', at: 650 }, book)!],
    workers,
    tasks,
    book,
  );
  const states = items.map((i) => `${i.state}:${i.seat}:${i.title}`);
  assert.ok(states.includes('done:seat-a:Ship the queue'));
  assert.ok(states.includes('progress:seat-a:Board titles'));
  assert.ok(states.includes('blocked:seat-a:Not logged in'));
  assert.ok(states.includes('done:seat-a:Write the notes'));
  assert.ok(states.includes('blocked:seat-b:Review the diff'));
  assert.equal(states.some((s) => s.includes('sitting') || s.includes('Still queued') || s.includes('yyyy')), false);
  assert.equal(workerItems(desk({ id: 'idle', status: 'idle' }), book).length, 0);
  const digest = buildDigest(items, 100, 1_000);
  assert.ok(digest.progress.seats.some((s) => s.lines.some((l) => l.title === 'Board titles')));
});

test('since is the later stamp, or the last twelve hours when nobody has visited', () => {
  assert.equal(sinceOf(undefined, undefined, 50_000), 50_000 - FIRST_WINDOW_MS);
  assert.equal(sinceOf(10, 40, 50_000), 40);
  assert.equal(sinceOf(80, 40, 50_000), 80);
});

test('files keep actionable blocks and status lines, and a tap removes the block', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hq-brief-'));
  try {
    writeFileSync(
      path.join(dir, 'hq-local.json'),
      JSON.stringify({
        crewKeysLower: ['seat-a'],
        seats: { 'desk-1': 'seat-a', 'real name': 'not a seat' },
        humanMapsTo: 'operator',
      }),
    );
    const hq = loadHqLocal(path.join(dir, 'workers.json'));
    assert.equal(hq.seats['desk-1'], 'seat-a');
    assert.equal(hq.seats['real name'], undefined);
    assert.equal(hq.humanMapsTo, 'operator');

    const accepted = saveBlocks(dir, [
      { id: 'b1', seat: 'seat-a', title: 'Approve npm test', kind: 'yesno', actionable: true, at: 20 },
      { id: 'nope', seat: 'seat-a', title: 'A diary', kind: 'yesno', actionable: true, at: 20, body: 'pages of it' },
      { id: 'idle', title: 'nothing', kind: 'talk', actionable: false, at: 20 },
    ]);
    assert.equal(accepted, 1);
    assert.equal(saveItems(dir, [
      { id: 'i1', seat: 'seat-a', title: 'Ship the queue', state: 'done', at: 30 },
      { id: 'i2', seat: 'seat-a', title: 'essay', state: 'done', at: 30, note: 'long' },
    ]), 1);

    const now = 1_000;
    const brief = readBrief(
      dir,
      [desk({ id: 'w1', status: 'needs_input', activity: 'Not logged in', waitingSince: 40 })],
      [],
      10,
      now,
    );
    assert.equal(brief.headline, 'Needs operator');
    assert.deepEqual(brief.blocks.map((b) => b.title), ['Approve npm test', 'Not logged in']);
    assert.ok(brief.blocks.every((b) => b.seat === 'seat-a'));
    assert.equal(brief.digest.done.seats[0].lines[0].title, 'Ship the queue');
    assert.equal(brief.digest.blocked.seats[0].lines[0].title, 'Not logged in');

    assert.equal(answerBlock(dir, 'b1', 'yes', 60), true);
    const after = readBrief(dir, [], [], 10, now);
    assert.equal(after.blocks.length, 0);
    const disk = JSON.parse(readFileSync(path.join(dir, 'unblock.json'), 'utf8')) as { answered: { answer: string }[]; blocks: unknown[] };
    assert.equal(disk.blocks.length, 0);
    assert.deepEqual(disk.answered.map((a) => a.answer), ['yes']);
    assert.equal(JSON.stringify(disk).includes('chat'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
