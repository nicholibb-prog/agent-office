// The stub OFF script: stops the stand-in Ollama started by stub-ollama.mjs (pid file in argv[2]).
import { readFileSync, rmSync } from 'node:fs';
try { process.kill(Number(readFileSync(process.argv[2], 'utf8')), 'SIGTERM'); rmSync(process.argv[2]); } catch {}
console.log('VRAM freed MiB: 1024\nRAM freed MiB: 0');
