// Spec case 17 + funnel §8: the build fails if any file other than cloudSend imports a provider
// client, imports a provider SDK, or names a provider host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkProviderImports } from '../scripts/check-provider-imports.js';

test('the repo passes the provider-import check', () => {
  assert.deepEqual(checkProviderImports(process.cwd()), []);
});

test('17. a bypass file fails the check (client import, SDK import, host call)', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ao-prov-'));
  try {
    mkdirSync(path.join(root, 'src', 'server', 'router'), { recursive: true });
    writeFileSync(path.join(root, 'src', 'server', 'router', 'cloud-send.ts'), "import { httpChat } from './provider-clients.js';\n");
    writeFileSync(path.join(root, 'src', 'server', 'sneaky.ts'), "import { httpChat } from './router/provider-clients.js';\n");
    writeFileSync(path.join(root, 'src', 'server', 'sdk.ts'), "import OpenAI from 'openai';\n");
    writeFileSync(path.join(root, 'src', 'server', 'host.ts'), "await fetch('https://api.' + 'x' && 'https://api.deepseek.com/chat/completions');\n");
    const bad = checkProviderImports(root);
    assert.ok(bad.some((b) => b.startsWith('src/server/sneaky.ts') && b.includes('provider-clients')));
    assert.ok(bad.some((b) => b.startsWith('src/server/sdk.ts') && b.includes('openai')));
    assert.ok(bad.some((b) => b.startsWith('src/server/host.ts') && b.includes('api.deepseek.com')));
    assert.ok(!bad.some((b) => b.startsWith('src/server/router/cloud-send.ts')), 'cloudSend itself may import the clients');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
