// Origin URLs must not carry credentials into the office. `git remote get-url` applies insteadOf
// and can return user:token@host. The floor sends project.remote to every signed-in browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { whyCloneFailed } from '../src/server/clone.js';
import { projectInfo } from '../src/server/floor.js';
import { originRepo, redactUserinfo, sanitizeRemoteUrl } from '../src/server/git/remote-url.js';
import { loadConfig } from '../src/server/config.js';
import { startServer } from '../src/server/server.js';
import { gitError } from '../src/server/worktrees.js';
import { projectView } from '../src/server/ws/handlers/floors.js';
import { normalizeRepo } from '../src/shared/floors.js';
import type { ServerMsg } from '../src/shared/protocol.js';

const FAKE = 'ghs_FAKE_TOKEN_remote_url_test';
const TOKEN_URL = `https://x-access-token:${FAKE}@github.com/acme/api.git`;

/** True when text still carries URL userinfo or the fixture token. The text itself is not reported. */
function leaks(text: string): boolean {
  return text.includes(FAKE) || /x-access-token/i.test(text) || /:\/\/[^/\s]+@/.test(text) || /[^/\s]+:[^/\s]+@[^/\s]+:/.test(text);
}

function assertClean(label: string, value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  assert.equal(leaks(text), false, `${label} includes remote userinfo`);
}

function checkout(t: { after(fn: () => void): void }, url: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-remote-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', url]);
  writeFileSync(path.join(dir, 'README.md'), '# api\n');
  execFileSync('git', ['-C', dir, 'add', '.']);
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-qm', 'init']);
  return dir;
}

/** Points https://github.com/ at a URL that contains the fixture token, in this repo only. */
function rewriteWithToken(dir: string) {
  execFileSync('git', ['-C', dir, 'config', `url.https://x-access-token:${FAKE}@github.com/.insteadOf`, 'https://github.com/']);
}

test('https userinfo and scp-style remotes become owner/repo or host/path', () => {
  assert.equal(sanitizeRemoteUrl(TOKEN_URL), 'acme/api');
  assert.equal(sanitizeRemoteUrl('https://user:pass@github.com/acme/api.git'), 'acme/api');
  assert.equal(sanitizeRemoteUrl('https://user:pass@github.com/acme/api/issues/3'), 'acme/api');
  assert.equal(sanitizeRemoteUrl('ssh://git:pass@github.com/acme/api.git'), 'acme/api');
  assert.equal(sanitizeRemoteUrl('git@github.com:acme/api.git'), 'acme/api');
  assert.equal(sanitizeRemoteUrl(`token-user:${FAKE}@github.com:acme/api.git`), 'acme/api');
  assert.equal(sanitizeRemoteUrl('https://user:pass@gitlab.example.com/group/repo.git'), 'gitlab.example.com/group/repo');
  assert.equal(sanitizeRemoteUrl('git@gitlab.example.com:group/repo.git'), 'gitlab.example.com/group/repo');
  assert.equal(sanitizeRemoteUrl('acme/api'), 'acme/api');
  assert.equal(sanitizeRemoteUrl('https://gitlab.example.com/not-github'), 'gitlab.example.com/not-github');
  assert.equal(sanitizeRemoteUrl(''), undefined);
  assertClean('sanitized remotes', [
    sanitizeRemoteUrl(TOKEN_URL),
    sanitizeRemoteUrl(`token-user:${FAKE}@github.com:acme/api.git`),
    sanitizeRemoteUrl('https://user:pass@gitlab.example.com/group/repo.git'),
  ]);
});

test('originRepo matches a GitHub URL that carries userinfo', () => {
  const token = 'x'.repeat(180);
  const longUrl = `https://x-access-token:${token}@github.com/acme/api.git`;
  assert.ok(longUrl.length > 200);
  assert.equal(normalizeRepo(TOKEN_URL), 'acme/api');
  assert.equal(normalizeRepo(longUrl), 'acme/api');
  assert.equal(normalizeRepo('https://user:p%40ss@github.com/acme/api.git'), 'acme/api');
  assert.equal(normalizeRepo('https://github.com/acme/api.git'), 'acme/api');
  assert.equal(normalizeRepo('https://github.com/acme/api/issues/12'), 'acme/api');
  assert.equal(normalizeRepo('git@github.com:acme/api.git'), 'acme/api');
  assert.equal(normalizeRepo('ssh://git@github.com/acme/api.git'), 'acme/api');
  assert.equal(normalizeRepo(`ssh://git:${FAKE}@github.com/acme/api.git`), 'acme/api');
  assert.equal(normalizeRepo(`token-user:${FAKE}@github.com:acme/api.git`), 'acme/api');
  assert.equal(normalizeRepo('acme/api'), 'acme/api');
  assert.equal(normalizeRepo('https://github.com.evil.com/acme/api'), undefined);
  assert.equal(normalizeRepo('https://evil.com/github.com/acme/api'), undefined);
  assert.equal(normalizeRepo('https://user:pass@gitlab.com/acme/api.git'), undefined);
  assertClean('normalized repo', normalizeRepo(TOKEN_URL));
});

test('error text keeps the host and drops userinfo', () => {
  const line = `fatal: unable to access '${TOKEN_URL}/': The requested URL returned error: 403`;
  assert.equal(redactUserinfo(line), "fatal: unable to access 'https://github.com/acme/api.git/': The requested URL returned error: 403");
  assert.equal(gitError({ stderr: `${line}\n` }), "fatal: unable to access 'https://github.com/acme/api.git/': The requested URL returned error: 403");
  const clone = whyCloneFailed(`${line}\n`);
  assert.match(clone, /github\.com\/acme\/api\.git/);
  assertClean('clone failure', clone);
  assertClean('scp userinfo', redactUserinfo(`could not read from ${'token-user'}:${FAKE}@github.com:acme/api.git`));
});

test('a remote rewritten with insteadOf never reaches projectView', (t) => {
  const dir = checkout(t, 'https://github.com/acme/api.git');
  rewriteWithToken(dir);
  const prevGlobal = process.env.GIT_CONFIG_GLOBAL;
  const prevSystem = process.env.GIT_CONFIG_SYSTEM;
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_SYSTEM = '/dev/null';
  t.after(() => {
    if (prevGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = prevGlobal;
    if (prevSystem === undefined) delete process.env.GIT_CONFIG_SYSTEM;
    else process.env.GIT_CONFIG_SYSTEM = prevSystem;
  });

  const rewritten = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: dir, encoding: 'utf8' }).trim();
  assert.equal(rewritten.includes(FAKE), true, 'the fixture did not rewrite the remote');
  const info = projectInfo(dir, 'api', 'claude', []);
  const view = projectView({} as never, { project: info } as never);
  assert.equal(info.remote, 'acme/api');
  assert.equal(view?.remote, 'acme/api');
  assert.equal(originRepo(dir), 'acme/api');
  assertClean('projectInfo', info);
  assertClean('projectView', view);
});

test('a checkout whose saved remote URL contains userinfo still matches owner/repo', (t) => {
  const dir = checkout(t, TOKEN_URL);
  assert.equal(originRepo(dir), 'acme/api');
  const info = projectInfo(dir, 'api', 'claude', []);
  assert.equal(info.remote, 'acme/api');
  assertClean('stored userinfo remote', info);
  const scp = checkout(t, `token-user:${FAKE}@github.com:acme/api.git`);
  assert.equal(originRepo(scp), 'acme/api');
  assert.equal(projectInfo(scp, 'api', 'claude', []).remote, 'acme/api');
  assertClean('stored scp userinfo', projectInfo(scp, 'api', 'claude', []));
});

test('a member session is not sent remote userinfo', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-office-member-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'project');
  const home = path.join(root, 'home');
  const publicDir = path.join(root, 'public');
  const bin = path.join(root, 'bin');
  for (const d of [project, home, publicDir, path.join(publicDir, 'assets'), bin]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(project, 'README.md'), '# api\n');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project });
  execFileSync('git', ['add', '.'], { cwd: project });
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-qm', 'init'], { cwd: project });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/api.git'], { cwd: project });
  rewriteWithToken(project);
  for (const page of ['index', 'login', 'claim', 'join', 'lite']) writeFileSync(path.join(publicDir, `${page}.html`), `<!doctype html><title>${page}</title>`);
  writeFileSync(path.join(publicDir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(path.join(publicDir, 'assets', 'app.js'), 'export {};\n');
  const claude = path.join(bin, 'claude');
  writeFileSync(claude, '#!/bin/sh\nexit 0\n');
  chmodSync(claude, 0o755);

  const port = await new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const address = s.address() as net.AddressInfo;
      s.close(() => resolve(address.port));
    });
  });
  const cfg = loadConfig([project, '--home', home, '--projects', path.join(root, 'projects'), '--port', String(port), '--password', 'remote-url-test', '--no-open', '--weather', 'clear', '--agent', claude]);
  const office = await startServer(cfg, { publicDir });
  t.after(() => office.shutdown());
  const base = `http://127.0.0.1:${port}`;

  const post = (p: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0];

  const adminLogin = await post('/api/login', { password: 'remote-url-test' });
  assert.equal(adminLogin.status, 200);
  const adminCookie = cookieOf(adminLogin);

  const inbox: ServerMsg[] = [];
  const open = (cookie: string) =>
    new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?name=Host`, { headers: { cookie, origin: base } });
      ws.on('message', (raw) => inbox.push(JSON.parse(raw.toString())));
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
    });
  const waitFor = async (pred: () => boolean) => {
    const until = Date.now() + 8000;
    while (!pred()) {
      if (Date.now() > until) throw new Error('timed out waiting for a message');
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  const admin = await open(adminCookie);
  await waitFor(() => inbox.some((m) => m.t === 'welcome'));
  admin.send(JSON.stringify({ t: 'accounts.invite', name: 'Member', role: 'member' }));
  await waitFor(() => inbox.some((m) => m.t === 'accounts.invited'));
  const invite = inbox.find((m) => m.t === 'accounts.invited');
  assert.equal(invite?.t, 'accounts.invited');
  const token = invite.t === 'accounts.invited' ? invite.invite?.token : undefined;
  assert.ok(token);
  admin.close();

  const joined = await post('/api/join', { token, password: 'member-pass-1' });
  assert.equal(joined.status, 200, await joined.clone().text());
  inbox.length = 0;
  const member = await open(cookieOf(joined));
  await waitFor(() => inbox.some((m) => m.t === 'welcome'));
  await new Promise((r) => setTimeout(r, 400));
  const welcome = inbox.find((m) => m.t === 'welcome');
  assert.equal(welcome?.t, 'welcome');
  if (welcome?.t === 'welcome') {
    assert.equal(welcome.me.admin, false);
    assert.equal(welcome.me.account?.role, 'member');
    assert.equal(welcome.project?.remote, 'acme/api');
  }
  for (const m of inbox) assert.equal(leaks(JSON.stringify(m)), false, `${m.t} includes remote userinfo`);
  member.close();
});
