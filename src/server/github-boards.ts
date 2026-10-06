// Issues and pull requests for the floor boards. Every list goes through `gh` in the checkout.
// If gh cannot be found, or `gh auth status` fails, the boards get an empty logged-out state.
// Nothing here invents cards.
import type { GhIssue, GhLabel, GhPull, GhState } from '../shared/protocol.js';
import { GH_FAILED, GH_NOT_FOUND, GH_NOT_LOGGED_IN } from '../shared/protocol.js';

/** The office's `gh` (see github.ts), or a stand-in in tests. */
export interface GhBoardRunner {
  (args: string[], cwd: string, timeout?: number, env?: Record<string, string>): Promise<string>;
}

const ISSUE_FIELDS = 'number,title,state,url,author,labels,assignees,createdAt,updatedAt,body,comments';
const PULL_FIELDS = 'number,title,state,isDraft,url,author,labels,reviewDecision,headRefName,headRefOid,baseRefName,createdAt,updatedAt,additions,deletions,statusCheckRollup,body,closingIssuesReferences';

export function emptyBoard<T>(error: string, fetchedAt = Date.now()): GhState<T> {
  return { items: [], error, fetchedAt, loading: false };
}

/** Node's spawn and "Command failed" lines name the binary. They never reach the client. */
function withoutSpawnLeak(msg: string): string {
  const lines = msg.split('\n').filter((line) => !/^Command failed:/.test(line));
  return lines
    .map((line) => {
      if (!/^spawn(?:Sync)?\s+\S/.test(line)) return line;
      return /\bENOENT\b/.test(line) && !/[\\/]/.test(line) ? 'ENOENT' : GH_FAILED;
    })
    .join('\n');
}

/** Maps a failed `gh` call onto the honest board states, or leaves a specific gh error as it is. */
export function classifyGhError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  if (raw === GH_NOT_FOUND || raw === GH_NOT_LOGGED_IN || raw === GH_FAILED) return raw;
  const msg = withoutSpawnLeak(raw);
  if (msg.trim() === GH_FAILED) return GH_FAILED;
  if (/ENOENT|not installed|spawn gh\b|^gh not found$/i.test(msg)) return GH_NOT_FOUND;
  if (/auth login|not logged in|authentication|sign-in stopped|bad credentials|HTTP 401/i.test(msg)) return GH_NOT_LOGGED_IN;
  const trimmed = msg.trim();
  // A path to the gh binary must not ride out on an otherwise specific error.
  if (!trimmed || /[\\/][^\s]*gh(?:\.exe)?\b/i.test(trimmed)) return GH_FAILED;
  return trimmed;
}

/**
 * Proves the office gh session before any list. Missing binary stays "gh not found".
 * A spawn that found gh but could not start it stays "gh failed".
 * Any other failed `gh auth status` is "gh not logged in": the boards do not guess.
 */
export async function ghSessionBlock(run: GhBoardRunner, cwd: string): Promise<string | undefined> {
  try {
    await run(['auth', 'status'], cwd, 15_000);
    return undefined;
  } catch (err) {
    const msg = classifyGhError(err);
    if (msg === GH_NOT_FOUND || msg === GH_FAILED) return msg;
    return GH_NOT_LOGGED_IN;
  }
}

function labels(raw: any[]): GhLabel[] {
  return (raw ?? []).map((l) => ({ name: String(l.name), color: `#${l.color ?? '888888'}` }));
}

function checksOf(rollup: any[]): GhPull['checks'] {
  if (!rollup?.length) return 'none';
  let pending = false;
  for (const c of rollup) {
    const concl = String(c.conclusion ?? c.state ?? '').toUpperCase();
    const status = String(c.status ?? '').toUpperCase();
    if (['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(concl)) return 'fail';
    if (status && status !== 'COMPLETED') pending = true;
    if (concl === 'PENDING' || concl === 'EXPECTED') pending = true;
  }
  return pending ? 'pending' : 'pass';
}

export function parseIssues(openJson: string, closedJson: string): GhIssue[] {
  return [...JSON.parse(openJson), ...JSON.parse(closedJson)].map((i: any) => ({
    number: i.number,
    title: i.title,
    state: i.state,
    url: i.url,
    author: i.author?.login ?? '',
    labels: labels(i.labels),
    assignees: (i.assignees ?? []).map((a: any) => a.login),
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    body: String(i.body ?? '').slice(0, 4000),
    comments: Array.isArray(i.comments) ? i.comments.length : Number(i.comments ?? 0),
  }));
}

export function parsePulls(openJson: string, mergedJson: string, closedJson: string): GhPull[] {
  const seen = new Set<number>();
  const all = [...JSON.parse(openJson), ...JSON.parse(mergedJson), ...JSON.parse(closedJson)].filter((p: any) => !seen.has(p.number) && seen.add(p.number));
  return all.map((p: any) => ({
    number: p.number,
    title: p.title,
    state: p.state,
    isDraft: !!p.isDraft,
    url: p.url,
    author: p.author?.login ?? '',
    labels: labels(p.labels),
    reviewDecision: p.reviewDecision ?? '',
    headRefName: p.headRefName,
    headRefOid: typeof p.headRefOid === 'string' ? p.headRefOid : undefined,
    baseRefName: p.baseRefName,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    additions: p.additions ?? 0,
    deletions: p.deletions ?? 0,
    checks: checksOf(p.statusCheckRollup),
    body: String(p.body ?? '').slice(0, 4000),
    closes: (p.closingIssuesReferences ?? []).map((r: any) => Number(r.number)).filter((n: number) => Number.isInteger(n) && n > 0),
  }));
}

export async function loadIssueBoard(run: GhBoardRunner, cwd: string): Promise<GhState<GhIssue>> {
  const block = await ghSessionBlock(run, cwd);
  if (block) return emptyBoard(block);
  try {
    const [open, closed] = await Promise.all([
      run(['issue', 'list', '--state', 'open', '--limit', '300', '--json', ISSUE_FIELDS], cwd),
      run(['issue', 'list', '--state', 'closed', '--limit', '40', '--json', ISSUE_FIELDS], cwd),
    ]);
    return { items: parseIssues(open, closed), fetchedAt: Date.now(), loading: false };
  } catch (err) {
    return emptyBoard(classifyGhError(err));
  }
}

export async function loadPullBoard(run: GhBoardRunner, cwd: string): Promise<GhState<GhPull>> {
  const block = await ghSessionBlock(run, cwd);
  if (block) return emptyBoard(block);
  try {
    const [open, merged, closed] = await Promise.all([
      run(['pr', 'list', '--state', 'open', '--limit', '150', '--json', PULL_FIELDS], cwd),
      run(['pr', 'list', '--state', 'merged', '--limit', '30', '--json', PULL_FIELDS], cwd),
      run(['pr', 'list', '--state', 'closed', '--limit', '40', '--json', PULL_FIELDS], cwd),
    ]);
    return { items: parsePulls(open, merged, closed), fetchedAt: Date.now(), loading: false };
  } catch (err) {
    return emptyBoard(classifyGhError(err));
  }
}
