import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/server/config.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = path.join(import.meta.dirname, '..');

test('the office and the dev server default to 127.0.0.1, and npm run dev does not open a LAN host', (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'agent-office-bind-'));
  const previousPort = process.env.PORT;
  delete process.env.PORT;
  t.after(() => {
    rmSync(home, { recursive: true, force: true });
    if (previousPort === undefined) delete process.env.PORT;
    else process.env.PORT = previousPort;
  });
  const cfg = loadConfig(['--home', home, '--password', 'x']);
  assert.equal(cfg.host, '127.0.0.1');
  assert.equal(cfg.port, 4600);

  const vite = readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
  assert.match(vite, /host:\s*'127\.0\.0\.1'/);
  assert.match(vite, /port:\s*5173/);
  assert.match(vite, /http:\/\/127\.0\.0\.1:4600/);
  assert.doesNotMatch(vite, /host:\s*(?:true|'0\.0\.0\.0'|"0\.0\.0\.0")/);

  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts: { dev: string } };
  assert.match(pkg.scripts.dev, /--port 4600/);
  assert.doesNotMatch(pkg.scripts.dev, /0\.0\.0\.0/);
  assert.doesNotMatch(pkg.scripts.dev, /--host/);

  const hooks = readFileSync(path.join(root, 'src/server/hooks/server.ts'), 'utf8');
  assert.match(hooks, /listen\(port,\s*'127\.0\.0\.1'/);
});
