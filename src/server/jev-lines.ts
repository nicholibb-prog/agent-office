import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

// Lines an agent added in its own worktree, against the commit that worktree was cut from.
// Local git only. The result is a number; the path never leaves this function.

const SHA = /^[0-9a-f]{7,64}$/i;
const MAX_UNTRACKED = 200;
const MAX_FILE_BYTES = 1_000_000;

/** Additions in `git diff --numstat` output. A binary file (`-`) counts as nothing. */
export function addedFromNumstat(text: string): number {
  let n = 0;
  for (const line of text.split('\n')) {
    if (!line) continue;
    const add = line.split('\t', 1)[0];
    if (!add || add === '-') continue;
    const v = Number(add);
    if (Number.isFinite(v) && v > 0) n += Math.floor(v);
  }
  return n;
}

function git(args: string[], cwd: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, encoding: 'utf8', timeout: 15_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }, (err, stdout) => {
      if (err && !stdout) return resolve(undefined);
      resolve(stdout ?? '');
    });
  });
}

/** Lines in one untracked file, or 0 when it isn't a small text file. */
async function untrackedLines(cwd: string, file: string): Promise<number> {
  if (!file || file.startsWith('/') || file.split(/[/\\]/).includes('..')) return 0;
  try {
    const full = path.join(cwd, file);
    const st = await stat(full);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return 0;
    const text = await readFile(full, 'utf8');
    if (text.includes('\0')) return 0;
    if (!text) return 0;
    return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  } catch {
    return 0;
  }
}

/**
 * Lines added since `base` in `cwd`, untracked files included. Undefined when git could not say,
 * so the caller keeps the last count.
 */
export async function gitAddedLines(cwd: string, base: string): Promise<number | undefined> {
  if (!SHA.test(base)) return undefined;
  const diff = await git(['diff', '--numstat', base], cwd);
  if (diff === undefined) return undefined;
  let n = addedFromNumstat(diff);
  const untracked = await git(['ls-files', '--others', '--exclude-standard'], cwd);
  if (untracked) {
    for (const file of untracked.split('\n').filter(Boolean).slice(0, MAX_UNTRACKED)) n += await untrackedLines(cwd, file);
  }
  return Math.min(1_000_000, n);
}
