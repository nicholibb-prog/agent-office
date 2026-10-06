// The floor's GitHub boards: issues, pull requests, and what the office does to them.

/** A GitHub label; `color` is a CSS color ("#d73a4a"). */
export interface GhLabel {
  name: string;
  color: string;
  /** What it's for, in the repo's list of labels (the label picker's /api/gh/labels). */
  description?: string;
}

export interface GhIssue {
  number: number;
  title: string;
  state: string;
  url: string;
  author: string;
  labels: GhLabel[];
  assignees: string[];
  /** A worker in the office just took it, so it's In progress on the board before GitHub lists its assignee. */
  taken?: boolean;
  createdAt: string;
  updatedAt: string;
  body: string;
  comments: number;
}

export interface GhPull {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  url: string;
  author: string;
  labels: GhLabel[];
  reviewDecision: string;
  headRefName: string;
  /** The commit its branch is at on GitHub (for a merged PR, the last one merged). */
  headRefOid?: string;
  baseRefName: string;
  createdAt: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  checks: 'pass' | 'fail' | 'pending' | 'none';
  body: string;
  /** Issues it closes ("closes #12" in its description), as GitHub links them. */
  closes: number[];
}

export interface GhState<T> {
  items: T[];
  error?: string;
  fetchedAt: number;
  loading: boolean;
}

/** Boards show this and list nothing when `gh auth status` fails. */
export const GH_NOT_LOGGED_IN = 'gh not logged in';
/** Boards show this and list nothing when no gh binary can be found. */
export const GH_NOT_FOUND = 'gh not found';

/** The honest empty-state line, when `error` is one of the two fail-closed board states. */
export function ghBoardBlock(error?: string): typeof GH_NOT_LOGGED_IN | typeof GH_NOT_FOUND | undefined {
  if (error === GH_NOT_FOUND || error === GH_NOT_LOGGED_IN) return error;
  return undefined;
}

/** Issues and PR lists share one gh. "gh not found" wins when either side could not start gh. */
export function ghListsBlock(issues: { error?: string }, pulls: { error?: string }): typeof GH_NOT_LOGGED_IN | typeof GH_NOT_FOUND | undefined {
  if (issues.error === GH_NOT_FOUND || pulls.error === GH_NOT_FOUND) return GH_NOT_FOUND;
  if (issues.error === GH_NOT_LOGGED_IN || pulls.error === GH_NOT_LOGGED_IN) return GH_NOT_LOGGED_IN;
  return undefined;
}

/** The line under the empty-state heading. */
export function ghBoardHint(error?: string): string {
  if (error === GH_NOT_FOUND) return 'The office could not find the GitHub CLI. Set GH_PATH, or install gh and put it on PATH.';
  if (error === GH_NOT_LOGGED_IN) return 'Run gh auth login once on the office machine. Issues, pull requests, and the queue stay empty until that works.';
  return 'The server runs gh in the project directory — make sure it is installed and authenticated (gh auth login).';
}

export type GhMergeMethod = 'squash' | 'merge' | 'rebase';

/** Why an issue was closed, as GitHub records it. */
export type GhCloseReason = 'completed' | 'not planned';

/** How the repository lets pull requests be merged. */
export interface GhRepoInfo {
  nameWithOwner: string;
  methods: GhMergeMethod[];
}

/** A comment on an issue or on a PR's conversation, or a submitted review. */
export interface GhComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  url?: string;
  /** Reviews only: APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED. */
  state?: string;
}

/** A comment on a line of a PR's diff. */
export interface GhReviewComment {
  id: number;
  /** The first comment of the thread this one answers. */
  replyTo?: number;
  author: string;
  body: string;
  createdAt: string;
  url: string;
  path: string;
  /** The line it's on now, or null when the code under it changed since (outdated). */
  line: number | null;
  /** LEFT is the old file's line numbers, RIGHT the new file's. */
  side: 'LEFT' | 'RIGHT';
}

export interface GhCheck {
  name: string;
  state: 'pass' | 'fail' | 'pending' | 'skip';
  url?: string;
}

/** Everything the PR window shows beyond the board card: GET /api/gh/pull?number=N */
export interface GhPullDetail {
  number: number;
  body: string;
  state: string;
  isDraft: boolean;
  reviewDecision: string;
  headRefName: string;
  baseRefName: string;
  /** MERGEABLE, CONFLICTING or UNKNOWN (GitHub still working it out). */
  mergeable: string;
  /** CLEAN, BLOCKED, BEHIND, DIRTY, UNSTABLE, DRAFT, HAS_HOOKS or UNKNOWN. */
  mergeStateStatus: string;
  commits: number;
  comments: GhComment[];
  reviews: GhComment[];
  reviewComments: GhReviewComment[];
  checks: GhCheck[];
  repo: GhRepoInfo;
  /** Who gh is signed in as on the server, and so who comments from the office appear from ('' if unknown). */
  viewer: string;
}

/** GET /api/gh/issue?number=N */
export interface GhIssueDetail {
  number: number;
  /** OPEN or CLOSED. */
  state: string;
  body: string;
  comments: GhComment[];
  /** See GhPullDetail.viewer. */
  viewer: string;
}

/** GitHub turns away comments longer than this. */
export const GH_COMMENT_MAX = 65536;
/** Longer than any label name: GitHub stops at 50 characters, and JS counts an emoji as two. */
export const GH_LABEL_MAX = 100;

export type GitHubClientMsg =
  | { t: 'gh.refresh' }
  /** Merge a pull request; the answer comes back as gh.merged. */
  | { t: 'gh.merge'; number: number; method: GhMergeMethod; deleteBranch: boolean; auto?: boolean }
  /** Comment on an issue or a PR's conversation, as the server's gh account; answered with gh.commented. */
  | { t: 'gh.comment'; kind: 'issue' | 'pull'; number: number; body: string }
  /** Close an issue, or a pull request without merging it; the answer comes back as gh.closed. */
  | { t: 'gh.close'; kind: 'issue' | 'pull'; number: number; comment?: string; reason?: GhCloseReason; deleteBranch?: boolean }
  /** Put labels on an issue or PR and take others off, as the server's gh account; answered with gh.labeled. */
  | { t: 'gh.labels'; kind: 'issue' | 'pull'; number: number; add: string[]; remove: string[] };

export type GitHubServerMsg =
  | { t: 'gh.issues'; state: GhState<GhIssue> }
  | { t: 'gh.pulls'; state: GhState<GhPull> }
  /** Sent to whoever asked for the merge. */
  | { t: 'gh.merged'; number: number; error?: string }
  /** Sent to whoever commented: the comment as GitHub saved it, or why it wasn't. */
  | { t: 'gh.commented'; kind: 'issue' | 'pull'; number: number; comment?: GhComment; error?: string }
  /** Sent to whoever asked to close it. */
  | { t: 'gh.closed'; kind: 'issue' | 'pull'; number: number; error?: string }
  /** Sent to whoever changed them: the labels it has now, or why they didn't change. */
  | { t: 'gh.labeled'; kind: 'issue' | 'pull'; number: number; labels?: GhLabel[]; error?: string };
