import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isMajorFiles } from './major-files.js';

// Where the office password comes from, in order:
//   1. AGENT_OFFICE_PASSWORD (environment)
//   2. AGENT_OFFICE_PASSWORD_FILE (a path to an owner-only file; one trailing newline is trimmed)
//   3. --password <value> on the command line (deprecated: any process listing can see it)
// The value itself is never logged, printed or put in an error message.

/** Shared Major Files matcher (src/server/major-files.ts). */
export const isMajorFilesPath = (p: string): boolean => isMajorFiles(p);

export class PasswordSourceError extends Error {}

export const ARGV_DEPRECATION =
  'agent-office: --password on the command line is deprecated (visible in process listings); use AGENT_OFFICE_PASSWORD or AGENT_OFFICE_PASSWORD_FILE';

export interface PasswordSourceInput {
  env?: NodeJS.ProcessEnv;
  /** Value given with --password, if any. */
  argvPassword?: string;
  warn?: (line: string) => void;
  platform?: NodeJS.Platform;
}

export type PasswordSource = 'env' | 'file' | 'argv' | 'none';

export function readPasswordFile(file: string, platform: NodeJS.Platform = process.platform): string {
  // Refuse on the raw string first, so nothing under Major Files is ever touched.
  if (isMajorFilesPath(file)) throw new PasswordSourceError('AGENT_OFFICE_PASSWORD_FILE: refused, Major Files is off limits');
  let real: string;
  try {
    real = realpathSync(file);
  } catch {
    throw new PasswordSourceError('AGENT_OFFICE_PASSWORD_FILE: cannot be read');
  }
  if (isMajorFilesPath(real)) throw new PasswordSourceError('AGENT_OFFICE_PASSWORD_FILE: refused, Major Files is off limits');
  const st = statSync(real);
  if (!st.isFile()) throw new PasswordSourceError('AGENT_OFFICE_PASSWORD_FILE: not a regular file');
  if (platform !== 'win32' && (st.mode & 0o077) !== 0)
    throw new PasswordSourceError('AGENT_OFFICE_PASSWORD_FILE: refused, readable by group/others (chmod 600 it)');
  let text: string;
  try {
    text = readFileSync(real, 'utf8');
  } catch {
    throw new PasswordSourceError('AGENT_OFFICE_PASSWORD_FILE: cannot be read');
  }
  const value = text.replace(/\r?\n$/, '');
  if (!value) throw new PasswordSourceError('AGENT_OFFICE_PASSWORD_FILE: file is empty');
  return value;
}

export function resolvePassword(input: PasswordSourceInput = {}): { password: string; source: PasswordSource } {
  const env = input.env ?? process.env;
  if (env.AGENT_OFFICE_PASSWORD) return { password: env.AGENT_OFFICE_PASSWORD, source: 'env' };
  if (env.AGENT_OFFICE_PASSWORD_FILE)
    return { password: readPasswordFile(env.AGENT_OFFICE_PASSWORD_FILE, input.platform), source: 'file' };
  if (input.argvPassword) {
    (input.warn ?? ((l) => console.warn(l)))(ARGV_DEPRECATION);
    return { password: input.argvPassword, source: 'argv' };
  }
  return { password: '', source: 'none' };
}

/** Drop `--password <value>` / `--password=<value>` from an argv array in place (best effort; the OS may still show the launch line). */
export function scrubPasswordArgv(argv: string[]): void {
  for (let i = argv.length - 1; i >= 0; i--) {
    if (argv[i] === '--password') argv.splice(i, i + 1 < argv.length ? 2 : 1);
    else if (argv[i].startsWith('--password=')) argv.splice(i, 1);
  }
}
