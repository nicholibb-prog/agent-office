// CI check (funnel §8, Dan's spec §1): only src/server/router/cloud-send.ts may import the provider
// clients, only provider-clients.ts may name a provider host, and no file may import a provider SDK.
// Run: npx tsx scripts/check-provider-imports.ts  (tests/router-provider-imports.test.ts runs it too).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROVIDER_HOSTS = [
  'openrouter.ai', 'api.groq.com', 'integrate.api.nvidia.com', 'open.bigmodel.cn', 'api.z.ai',
  'api.deepseek.com', 'poolside.ai', 'dashscope.aliyuncs.com', 'api.x.ai', 'api.openai.com', 'api.anthropic.com',
];
export const PROVIDER_SDKS = ['openai', 'groq-sdk', '@anthropic-ai/sdk', '@openrouter/ai-sdk-provider', '@ai-sdk/openai', '@ai-sdk/groq', '@ai-sdk/deepseek', 'deepseek'];
const CLIENTS = 'src/server/router/provider-clients.ts';
const GATE = 'src/server/router/cloud-send.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(c|m)?[jt]sx?$/.test(n)) out.push(p);
  }
  return out;
}

export function checkProviderImports(root: string, dirs = ['src', 'bin', 'scripts']): string[] {
  const bad: string[] = [];
  for (const d of dirs) {
    let files: string[] = [];
    try { files = walk(path.join(root, d)); } catch { continue; }
    for (const f of files) {
      const rel = path.relative(root, f).split(path.sep).join('/');
      if (rel === 'scripts/check-provider-imports.ts') continue;
      const src = readFileSync(f, 'utf8');
      if (rel !== CLIENTS) for (const h of PROVIDER_HOSTS) if (src.includes(h)) bad.push(`${rel}: names provider host ${h}`);
      if (rel !== GATE && /from\s+['"][^'"]*provider-clients(\.js)?['"]|import\(\s*['"][^'"]*provider-clients/.test(src)) bad.push(`${rel}: imports provider-clients outside cloudSend`);
      for (const sdk of PROVIDER_SDKS) {
        const re = new RegExp(`(from\\s+|import\\(\\s*|require\\(\\s*)['"]${sdk.replace(/[/@.-]/g, (c) => '\\' + c)}(/[^'"]*)?['"]`);
        if (re.test(src)) bad.push(`${rel}: imports provider SDK ${sdk}`);
      }
    }
  }
  return bad;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bad = checkProviderImports(process.cwd());
  for (const b of bad) console.error(b);
  process.exit(bad.length ? 1 : 0);
}
