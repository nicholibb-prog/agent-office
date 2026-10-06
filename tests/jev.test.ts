import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JevStore } from '../src/server/jev.js';
import { applyBreakroomIdle, boardFrom, cleanAgents, cleanJevName, decayedScore, inBreakroom, rankAgents, rawScore, seedAgents, trophiesFor, type JevAgent } from '../src/shared/jev.js';

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

test('a floor with no file is seeded, and what it saves has no paths or secrets', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-jev-'));
  try {
    const store = new JevStore(dir);
    const file = path.join(dir, 'jev-metrics.json');
    const text = readFileSync(file, 'utf8');
    const saved = JSON.parse(text) as { agents: JevAgent[] };
    assert.equal(saved.agents.length, seedAgents().length);
    assert.equal(text.includes(dir), false);
    assert.equal(/\bghp_|\bsk-|\bAKIA|\bgithub_pat_/.test(text), false);
    for (const agent of saved.agents) {
      assert.deepEqual(Object.keys(agent).sort(), ['breakroomMinutes', 'deskId', 'id', 'lines', 'name', 'prs', 'tasks']);
    }
    assert.equal(store.noteBreakroom('lou', 30), true);
    const again = new JevStore(dir).board();
    const louRow = again.rows.find((r) => r.name === 'Lounge Lou')!;
    assert.equal(louRow.breakroomMinutes, 120);
    assert.ok(louRow.score < boardFrom(seedAgents()).rows.find((r) => r.name === 'Lounge Lou')!.score);
    assert.equal(store.noteBreakroom('nope', 5), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
