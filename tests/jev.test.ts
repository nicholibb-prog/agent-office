import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { JevStore } from '../src/server/jev.js';
import { agentsOnFloor, watchJev } from '../src/server/jev-watch.js';
import { addedFromNumstat, gitAddedLines } from '../src/server/jev-lines.js';
import { applyBreakroomIdle, boardFrom, cleanAgents, cleanJevName, decayedScore, finishedTasks, inBreakroom, mergeAgents, pullRequestsOf, rankAgents, rawScore, seedAgents, trophiesFor, type JevAgent, type LiveAgent } from '../src/shared/jev.js';

const lou = (): JevAgent => ({ id: 'lou', name: 'Lounge Lou', lines: 300, prs: 4, tasks: 4, breakroomMinutes: 0, deskId: 'desk-15' });

test('rank is lines plus pull requests and tasks, and breakroom idle cuts it in half each half hour', () => {
  const fresh = lou();
  assert.equal(rawScore(fresh), 600);
  assert.equal(decayedScore(rawScore(fresh), 0), 600);
  assert.equal(Math.round(decayedScore(rawScore(fresh), 90)), 75);
  const ranked = rankAgents([fresh, applyBreakroomIdle(fresh, 90)]);
  assert.equal(ranked[0].score, 600);
  assert.equal(ranked[1].score, 75);
  assert.equal(ranked[0].rank, 1);
});

test('the seeded board puts the lounge idler below people with less raw work', () => {
  const rows = rankAgents(seedAgents());
  const names = rows.map((r) => r.name);
  assert.deepEqual(names, ['Ada Lines', 'Pip Merges', 'Tasker', 'Lounge Lou', 'Nib']);
  assert.ok(rows.find((r) => r.name === 'Lounge Lou')!.score < rows.find((r) => r.name === 'Tasker')!.score);
});

test('a desk earns a cup at 100 lines, a first PR, or 5 tasks', () => {
  const ada = seedAgents()[0];
  assert.deepEqual(trophiesFor(ada).map((t) => t.milestone), ['lines-100', 'pr-1']);
  assert.deepEqual(trophiesFor({ ...ada, deskId: '../secret' }), []);
  assert.equal(trophiesFor({ id: 'n', name: 'Nib', lines: 1, prs: 0, tasks: 1, breakroomMinutes: 0 }).length, 0);
});

test('names that look like paths or tokens are dropped', () => {
  assert.equal(cleanJevName('Ada Lines'), 'Ada Lines');
  assert.equal(cleanJevName('/home/me/project'), '');
  assert.equal(cleanJevName('https://example.com'), '');
  assert.equal(cleanJevName('ghp_secretvalue'), '');
  assert.equal(cleanJevName('sk-live-key'), '');
  const cleaned = cleanAgents({
    agents: [
      { id: 'ok', name: 'Ok', lines: 1, prs: 0, tasks: 0, breakroomMinutes: 0, deskId: 'desk-1', cwd: '/tmp/secret' },
      { id: '../x', name: 'Bad', lines: 9, prs: 9, tasks: 9, breakroomMinutes: 0 },
    ],
  });
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0].name, 'Ok');
  assert.equal(JSON.stringify(cleaned[0]).includes('/tmp'), false);
});

test('the lounge is the breakroom, and the desks are not', () => {
  assert.equal(inBreakroom(10.5, 0), true);
  assert.equal(inBreakroom(-6, 2), false);
});

const ada = (lines: number): LiveAgent => ({ id: 'a1b2c3d4e5f6', name: 'Ada Lines', lines, prs: 2, tasks: 4, deskId: 'desk-12' });
const pip = (lines: number): LiveAgent => ({ id: 'b1b2c3d4e5f6', name: 'Pip Merges', lines, prs: 6, tasks: 3, deskId: 'desk-13' });

test('a floor with no file ranks nobody, and what it saves has no paths or secrets', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-jev-'));
  try {
    const store = new JevStore(dir);
    const file = path.join(dir, 'jev-metrics.json');
    assert.equal(store.board().rows.length, 0);
    assert.equal(store.observe([ada(10)], '2026-10-06'), true);
    assert.equal(store.observe([pip(500), ada(10)], '2026-10-06'), false);
    assert.equal(store.board().rows[0].name, 'Ada Lines');
    assert.equal(store.board().rankedOn, '2026-10-06');
    assert.equal(store.observe([pip(500), ada(1)], '2026-10-07'), true);
    assert.equal(store.board().rows[0].name, 'Pip Merges');
    assert.ok(store.board().rows.some((r) => r.name === 'Ada Lines'));
    const text = readFileSync(file, 'utf8');
    const saved = JSON.parse(text) as { agents: JevAgent[]; pending: JevAgent[]; rankedOn: string };
    assert.equal(text.includes(dir), false);
    assert.equal(/\bghp_|\bsk-|\bAKIA|\bgithub_pat_/.test(text), false);
    assert.equal(saved.rankedOn, '2026-10-07');
    for (const agent of [...saved.agents, ...saved.pending]) {
      assert.deepEqual(Object.keys(agent).sort(), ['breakroomMinutes', 'deskId', 'id', 'lines', 'name', 'prs', 'tasks']);
    }
    const louAgent: LiveAgent = { id: 'c1b2c3d4e5f6', name: 'Lounge Lou', lines: 300, prs: 4, tasks: 4, breakroomMinutes: 90, deskId: 'desk-15' };
    assert.equal(store.observe([louAgent], '2026-10-08'), true);
    assert.equal(store.noteBreakroom('c1b2c3d4e5f6', 30), true);
    const again = new JevStore(dir).board();
    const louRow = again.rows.find((r) => r.name === 'Lounge Lou')!;
    assert.equal(louRow.breakroomMinutes, 120);
    assert.ok(louRow.score < 600);
    assert.equal(store.noteBreakroom('nope', 5), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an old sample board is dropped, and an agent sent home still counts the next night', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-jev-'));
  try {
    writeFileSync(path.join(dir, 'jev-metrics.json'), JSON.stringify({ agents: seedAgents() }));
    const store = new JevStore(dir);
    assert.equal(store.board().rows.length, 0);
    assert.equal(store.observe([ada(10), pip(20)], '2026-10-06'), true);
    assert.equal(store.observe([pip(20)], '2026-10-07'), true);
    assert.deepEqual(store.board().rows.map((r) => r.name).sort(), ['Ada Lines', 'Pip Merges']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pull requests and finished tasks count every agent, and a shell does not', () => {
  assert.equal(pullRequestsOf({ pr: { number: 1 }, pastPrs: [2], repos: [{ pr: { number: 3 } }, {}] }), 3);
  assert.equal(finishedTasks('w', [{ workerId: 'w', status: 'done', outcome: 'killed' }, { workerId: 'w', status: 'done', outcome: 'done' }], { status: 'done', hasTask: true }), 1);
  assert.equal(finishedTasks('w', [], { status: 'done', hasTask: true }), 1);
  const merged = mergeAgents([], [
    { id: 'ok', name: 'Ok', lines: 5, prs: 0, tasks: 0 },
    { id: '../x', name: 'Bad', lines: 9, prs: 9, tasks: 9 },
    { id: 'shell', name: '/tmp/secret', lines: 9, prs: 0, tasks: 0 },
  ]);
  assert.deepEqual(merged.map((a) => a.name), ['Ok']);
});

test('added lines are the additions in a numstat, and in a worktree', async () => {
  assert.equal(addedFromNumstat('2\t1\ta.ts\n-\t-\tbin\n3\t0\tb.ts\n'), 5);
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-jev-git-'));
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' } });
    git('init', '-q');
    writeFileSync(path.join(dir, 'a.txt'), 'one\n');
    git('add', 'a.txt');
    git('commit', '-q', '-m', 'base');
    const base = git('rev-parse', 'HEAD').trim();
    writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\nthree\n');
    mkdirSync(path.join(dir, 'sub'));
    writeFileSync(path.join(dir, 'sub', 'b.txt'), 'new\nfile\n');
    assert.equal(await gitAddedLines(dir, base), 4);
    assert.equal(await gitAddedLines(dir, 'not-a-sha'), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the floor comparison skips shells and sums each worktree', async () => {
  const floor = {
    dir: '/proj',
    workers: {
      list: () => [
        { id: 'a1b2c3d4e5f6', name: 'Ada Lines', kind: 'agent', deskId: 'desk-1', status: 'done', task: { name: 'Fix' }, pr: { number: 4 }, pastPrs: [], worktree: { path: 'wt', base: 'abc1234' }, repos: [{ path: 'other', base: 'def5678', pr: { number: 5 } }] },
        { id: 'b1b2c3d4e5f6', name: 'Shell', kind: 'shell', deskId: 'desk-2', status: 'idle' },
      ],
    },
    queue: { state: () => ({ tasks: [{ workerId: 'a1b2c3d4e5f6', status: 'done', outcome: 'done' }] }) },
  };
  const seen: string[] = [];
  const agents = await agentsOnFloor(floor, async (cwd) => {
    seen.push(cwd);
    return cwd.endsWith('wt') ? 10 : 3;
  });
  assert.deepEqual(seen, ['/proj/wt', '/proj/other']);
  assert.equal(agents.length, 1);
  assert.equal(agents[0].lines, 13);
  assert.equal(agents[0].prs, 2);
  assert.equal(agents[0].tasks, 1);
});

test('the watch publishes the first agents, then waits for the next day', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-jev-watch-'));
  try {
    const store = new JevStore(dir);
    let day = '2026-10-06';
    let lines = 10;
    const emitted: string[] = [];
    const watch = watchJev(store, {
      load: async () => [ada(lines)],
      emit: (board) => emitted.push(`${board.rankedOn}:${board.rows[0]?.name}:${board.rows[0]?.score}`),
      now: () => {
        const [y, m, d] = day.split('-').map(Number);
        return new Date(y, m - 1, d, 12, 0, 0);
      },
      countMs: 60_000,
    });
    await watch.roll();
    assert.equal(emitted.length, 1);
    assert.match(emitted[0], /^2026-10-06:Ada Lines:/);
    lines = 999;
    await watch.roll();
    assert.equal(emitted.length, 1);
    assert.equal(store.board().rows[0].lines, 10);
    day = '2026-10-07';
    await watch.roll();
    assert.equal(emitted.length, 2);
    assert.equal(store.board().rankedOn, '2026-10-07');
    assert.equal(store.board().rows[0].lines, 999);
    watch.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
