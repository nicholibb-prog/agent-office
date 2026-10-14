// Data labels (funnel #3, #28): one label per task, from the source allow-list only, never from the
// task text. Unknown or unlisted means `private`. config/data-classes.json is committed and public:
// it holds public repo names and generic source names only.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Label, Task } from './types.js';

export interface DataClasses {
  public: string[];
  private: string[];
  secret: string[];
  /** Sources holding student data (Preply etc.): private, and held unless C6 is on. */
  student: string[];
}

export function parseDataClasses(json: string): DataClasses {
  const raw = JSON.parse(json) as Record<string, unknown>;
  const list = (k: string) => {
    const v = raw[k];
    if (v === undefined) return [];
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && x.trim())) throw new Error(`data-classes: ${k} must be a list of names`);
    return (v as string[]).map((x) => x.trim().toLowerCase());
  };
  return { public: list('public'), private: list('private'), secret: list('secret'), student: list('student') };
}

export function loadDataClasses(file = path.resolve('config/data-classes.json')): DataClasses {
  try {
    return parseDataClasses(readFileSync(file, 'utf8'));
  } catch {
    // Unreadable config: nothing is public (fail closed).
    return { public: [], private: [], secret: [], student: [] };
  }
}

const keyOf = (t: Pick<Task, 'repo' | 'source'>) => [t.repo, t.source].filter((x): x is string => !!x).map((x) => x.trim().toLowerCase());

/**
 * The task's label. The most restrictive listing wins (secret > private > public); a task is public
 * only when every one of its repo/source names is on the public list. `task.label` is ignored.
 */
export function classify(task: Pick<Task, 'repo' | 'source'>, classes: DataClasses): Label {
  const keys = keyOf(task);
  if (!keys.length) return 'private';
  if (keys.some((k) => classes.secret.includes(k))) return 'secret';
  if (keys.some((k) => classes.private.includes(k) || classes.student.includes(k))) return 'private';
  return keys.every((k) => classes.public.includes(k)) ? 'public' : 'private';
}

export function isStudentSource(task: Pick<Task, 'repo' | 'source'>, classes: DataClasses): boolean {
  return keyOf(task).some((k) => classes.student.includes(k));
}
