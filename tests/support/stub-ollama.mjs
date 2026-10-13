// A stand-in Ollama for the power switch's end-to-end test: listens on 127.0.0.1:11434 only, knows the
// five loft models, and keeps a loaded list that /api/generate fills (and keep_alive 0 empties).
// Writes its pid next to argv[2] so the stub OFF script can stop it.
import { createServer } from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';
const pidFile = process.argv[2];
const TAGS = ['qwen3.5:4b', 'okkin:latest', 'qwen3.5:9b', 'ornith-1.5:9b', 'hf.co/ornith-ai/Ornith-1.5-35B-A3B-GGUF:Q4_K_M'];
const loaded = new Set();
const json = (res, body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {};
    if (req.url === '/api/tags') return json(res, { models: TAGS.map((name) => ({ name, model: name, size: 1 })) });
    if (req.url === '/api/ps') return json(res, { models: [...loaded].map((name) => ({ name, model: name, size_vram: 1024 * 1024 * 1024 })) });
    if (req.url === '/api/version') return json(res, { version: 'stub' });
    if (req.url === '/api/generate') {
      if (pidFile) appendFileSync(`${pidFile}.calls`, `${JSON.stringify({ model: body.model, keep_alive: body.keep_alive, options: body.options })}\n`);
      if (body.keep_alive === 0) loaded.delete(body.model); else loaded.add(body.model);
      return json(res, { model: body.model, response: '', done: true, eval_count: 1, eval_duration: 1e7 });
    }
    res.writeHead(404); res.end('{}');
  });
}).listen(11434, '127.0.0.1', () => { if (pidFile) writeFileSync(pidFile, String(process.pid)); });
