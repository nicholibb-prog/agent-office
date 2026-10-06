import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GH_FAILED, GH_NOT_FOUND, GH_NOT_LOGGED_IN, ghBoardHint, ghListsBlock } from '../src/shared/protocol.js';
import { GH_WINDOWS_FALLBACK, GitHub, gh, ghSpawnFailure, resolveGhBinary } from '../src/server/github.js';
import { classifyGhError, loadIssueBoard, loadPullBoard, type GhBoardRunner } from '../src/server/github-boards.js';
import type { GhIssue, GhPull, GhState } from '../src/shared/protocol.js';

const issue = {
  number: 12,
  title: 'Real issue',
  state: 'OPEN',
  url: 'https://github.com/acme/app/issues/12',
  author: { login: 'octocat' },
  labels: [{ name: 'bug', color: 'd73a4a' }],
  assignees: [{ login: 'hubot' }],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  body: 'from gh',
  comments: [{ id: 1 }],
};

const pull = {
  number: 7,
  title: 'Real pull',
  state: 'OPEN',
  isDraft: true,
  url: 'https://github.com/acme/app/pull/7',
  author: { login: 'octocat' },
  labels: [],
  reviewDecision: '',
  headRefName: 'office/real',
  baseRefName: 'main',
  createdAt: '2026-01-03T00:00:00Z',
  updatedAt: '2026-01-04T00:00:00Z',
  additions: 3,
  deletions: 1,
  statusCheckRollup: [],
  body: 'from gh',
  closingIssuesReferences: [{ number: 12 }],
};

test('gh resolves GH_PATH, then PATH, then the Windows install path', () => {
  const dir = '/opt/gh-cli';
  const onPath = path.join(dir, 'gh');
  const exe = path.join(dir, 'gh.exe');
  assert.equal(resolveGhBinary({ env: { GH_PATH: '/opt/override/gh', PATH: dir }, isFile: (p) => p === '/opt/override/gh' || p === onPath }), '/opt/override/gh');
  assert.equal(resolveGhBinary({ env: { GH_PATH: '/missing/gh', PATH: dir }, isFile: (p) => p === onPath }), onPath);
  assert.equal(resolveGhBinary({ env: { PATH: dir }, isFile: (p) => p === exe }), exe);
  assert.equal(resolveGhBinary({ env: { PATH: '' }, isFile: (p) => p === GH_WINDOWS_FALLBACK }), GH_WINDOWS_FALLBACK);
  assert.equal(resolveGhBinary({ env: { PATH: dir, GH_PATH: '' }, isFile: () => false }), undefined);
  // A directory at the Windows fallback is not a match, even when the path exists.
  assert.equal(resolveGhBinary({ env: { PATH: '' }, isFile: (p) => p === GH_WINDOWS_FALLBACK ? false : false }), undefined);
});

test('GH_PATH, PATH, and the Windows fallback match only a regular file', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'gh-lookup-'));
  try {
    const folder = path.join(root, 'not-a-binary');
    mkdirSync(folder);
    const bindir = path.join(root, 'bin');
    mkdirSync(bindir);
    mkdirSync(path.join(bindir, 'gh'));
    const exe = path.join(bindir, 'gh.exe');
    writeFileSync(exe, '');
    const real = path.join(root, 'real-gh');
    writeFileSync(real, '');
    assert.equal(resolveGhBinary({ env: { GH_PATH: folder, PATH: '' } }), undefined);
    assert.equal(resolveGhBinary({ env: { PATH: bindir } }), exe);
    assert.equal(resolveGhBinary({ env: { GH_PATH: path.join(bindir, 'gh'), PATH: bindir } }), exe);
    assert.equal(resolveGhBinary({ env: { GH_PATH: real, PATH: '' } }), real);
    assert.equal(resolveGhBinary({ env: { GH_PATH: folder, PATH: root } }), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('gh() fails closed with gh not found when no binary resolves, and when the file is missing', async () => {
  await assert.rejects(() => gh(['auth', 'status'], process.cwd(), 5_000, undefined, () => undefined), { message: GH_NOT_FOUND });
  await assert.rejects(() => gh(['auth', 'status'], process.cwd(), 5_000, undefined, () => '/no/such/gh-binary'), { message: GH_NOT_FOUND });
});

test('a gh spawn error other than ENOENT is gh failed and does not echo the path', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'gh-spawn-'));
  const bin = path.join(root, 'gh');
  writeFileSync(bin, '');
  chmodSync(bin, 0o644);
  const secret = '/opt/secret/GitHub CLI/gh.exe';
  try {
    await assert.rejects(
      () => gh(['auth', 'status'], root, 5_000, undefined, () => bin),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, GH_FAILED);
        assert.equal(err.message.includes(bin), false);
        assert.equal(err.message.includes(root), false);
        assert.doesNotMatch(err.message, /EACCES|EPERM|ENOEXEC|spawn/);
        return true;
      },
    );
    assert.equal(ghSpawnFailure({ code: 'EACCES', message: `spawn ${secret} EACCES` } as NodeJS.ErrnoException), GH_FAILED);
    assert.equal(ghSpawnFailure({ code: 'ENOENT' } as NodeJS.ErrnoException), GH_NOT_FOUND);
    const leaked = new Error(`spawn ${secret} EACCES`);
    assert.equal(classifyGhError(leaked), GH_FAILED);
    assert.equal(classifyGhError(leaked).includes(secret), false);
    assert.equal(classifyGhError(new Error(`Command failed: ${secret} auth status\nYou are not logged into any GitHub hosts. Run gh auth login to authenticate.`)), GH_NOT_LOGGED_IN);
    const boom: GhBoardRunner = async () => {
      throw new Error(`spawn ${secret} EACCES`);
    };
    const board = await loadIssueBoard(boom, '/repo');
    assert.equal(board.error, GH_FAILED);
    assert.equal(board.error?.includes('secret'), false);
    assert.equal(board.error?.includes(secret), false);
    assert.deepEqual(board.items, []);
    assert.equal(ghListsBlock({ error: GH_FAILED }, { error: GH_NOT_LOGGED_IN }), GH_FAILED);
    assert.equal(ghListsBlock({ error: GH_NOT_FOUND }, { error: GH_FAILED }), GH_NOT_FOUND);
    assert.match(ghBoardHint(GH_FAILED), /could not be started/i);
    assert.equal(ghBoardHint(GH_FAILED).includes(secret), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a missing gh is gh not found, and a failed gh auth status is gh not logged in', async () => {
  let listed = false;
  const missing: GhBoardRunner = async () => {
    throw new Error('spawn gh ENOENT');
  };
  const signedOut: GhBoardRunner = async (args) => {
    if (args[0] === 'auth') throw new Error('You are not logged into any GitHub hosts. Run gh auth login to authenticate.');
    listed = true;
    return '[]';
  };
  const issues = await loadIssueBoard(missing, '/repo');
  const pulls = await loadPullBoard(missing, '/repo');
  assert.equal(issues.error, GH_NOT_FOUND);
  assert.deepEqual(issues.items, []);
  assert.equal(pulls.error, GH_NOT_FOUND);
  assert.deepEqual(pulls.items, []);
  assert.equal(ghBoardHint(GH_NOT_FOUND).includes('GH_PATH'), true);
  const out = await loadIssueBoard(signedOut, '/repo');
  const prs = await loadPullBoard(signedOut, '/repo');
  assert.equal(out.error, GH_NOT_LOGGED_IN);
  assert.deepEqual(out.items, []);
  assert.equal(prs.error, GH_NOT_LOGGED_IN);
  assert.equal(listed, false);
  assert.notEqual(GH_NOT_FOUND, GH_NOT_LOGGED_IN);
  assert.equal(ghListsBlock(issues, prs), GH_NOT_FOUND);
  assert.equal(ghListsBlock({ error: GH_NOT_LOGGED_IN }, { error: GH_NOT_LOGGED_IN }), GH_NOT_LOGGED_IN);
});

test('a signed-in gh parses issue and pull lists and does not invent cards when the repo is missing', async () => {
  const calls: string[][] = [];
  const ok: GhBoardRunner = async (args) => {
    calls.push(args);
    if (args[0] === 'auth') return '';
    if (args[0] === 'issue' && args.includes('open')) return JSON.stringify([issue]);
    if (args[0] === 'pr' && args.includes('open')) return JSON.stringify([pull]);
    return '[]';
  };
  const issues = await loadIssueBoard(ok, '/repo');
  const pulls = await loadPullBoard(ok, '/repo');
  assert.equal(issues.error, undefined);
  assert.equal(issues.items.length, 1);
  assert.equal(issues.items[0].number, 12);
  assert.equal(issues.items[0].title, 'Real issue');
  assert.equal(issues.items[0].author, 'octocat');
  assert.equal(issues.items[0].labels[0].name, 'bug');
  assert.equal(issues.items[0].labels[0].color, '#d73a4a');
  assert.deepEqual(issues.items[0].assignees, ['hubot']);
  assert.equal(issues.items[0].comments, 1);
  assert.equal(pulls.items.length, 1);
  assert.equal(pulls.items[0].title, 'Real pull');
  assert.equal(pulls.items[0].isDraft, true);
  assert.deepEqual(pulls.items[0].closes, [12]);
  assert.ok(calls.some((args) => args[0] === 'auth' && args[1] === 'status'));
  assert.ok(calls.some((args) => args[0] === 'issue' && args[1] === 'list'));
  assert.ok(calls.some((args) => args[0] === 'pr' && args[1] === 'list'));

  const lost: GhBoardRunner = async (args) => {
    if (args[0] === 'auth') return '';
    throw new Error("gh can't find this repository on GitHub (check the remote and access)");
  };
  const empty = await loadIssueBoard(lost, '/repo');
  assert.deepEqual(empty.items, []);
  assert.notEqual(empty.error, GH_NOT_FOUND);
  assert.notEqual(empty.error, GH_NOT_LOGGED_IN);
  assert.match(empty.error ?? '', /repository/);
});

test('boards that already had cards drop them when gh auth status fails', async () => {
  let loggedIn = true;
  const calls: string[][] = [];
  const run: GhBoardRunner = async (args) => {
    calls.push(args);
    if (args[0] === 'auth') {
      if (!loggedIn) throw new Error('You are not logged into any GitHub hosts. Run gh auth login to authenticate.');
      return '';
    }
    if (args[0] === 'issue' && args.includes('open')) return JSON.stringify([issue]);
    if (args[0] === 'pr' && args.includes('open')) return JSON.stringify([pull]);
    return '[]';
  };
  const issues: GhState<GhIssue>[] = [];
  const pulls: GhState<GhPull>[] = [];
  const g = new GitHub('/repo', (s) => issues.push(s), (s) => pulls.push(s), run);
  await g.refresh();
  assert.equal(issues.at(-1)?.items[0]?.title, 'Real issue');
  assert.equal(issues.at(-1)?.error, undefined);
  assert.equal(pulls.at(-1)?.items[0]?.number, 7);
  const mark = calls.length;
  loggedIn = false;
  await g.refresh();
  assert.deepEqual(issues.at(-1)?.items, []);
  assert.equal(issues.at(-1)?.error, GH_NOT_LOGGED_IN);
  assert.deepEqual(pulls.at(-1)?.items, []);
  assert.equal(pulls.at(-1)?.error, GH_NOT_LOGGED_IN);
  assert.ok(calls.slice(mark).every((args) => args[0] === 'auth'));
  assert.equal(await g.sessionError(), GH_NOT_LOGGED_IN);
});
