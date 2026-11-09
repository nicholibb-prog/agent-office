import test from 'node:test';
import assert from 'node:assert/strict';
import { boardEmptyNote, GH_FAILED, GH_NOT_FOUND, GH_NOT_LOGGED_IN } from '../src/shared/protocol.js';

test('a repo with issues turned off gets a calm line, never the raw GitHub error', () => {
  const raw = 'GraphQL: the repo has disabled issues (repository.issues)';
  const note = boardEmptyNote('issues', { error: raw });
  assert.equal(note, 'Issues are turned off for this repo');
  assert.equal(note.includes('disabled'), false);
});

test('any other failure is a generic line: no raw text, paths or tokens leak onto a board', () => {
  const raw = 'exec /home/someone/.local/bin/gh: HTTP 502 token=ghp_fake123';
  for (const kind of ['issues', 'pulls'] as const) {
    const note = boardEmptyNote(kind, { error: raw });
    assert.match(note, /^Couldn't load (issues|pull requests) right now$/);
    for (const e of [GH_FAILED, GH_NOT_FOUND, GH_NOT_LOGGED_IN]) assert.equal(boardEmptyNote(kind, { error: e }).includes(e), false);
  }
});

test('no error: loading, then a plain empty state', () => {
  assert.equal(boardEmptyNote('issues', { loading: true }), 'Loading…');
  assert.equal(boardEmptyNote('issues', { fetchedAt: 1 }), 'No open issues');
  assert.equal(boardEmptyNote('pulls', { fetchedAt: 1 }), 'No open PRs');
});
