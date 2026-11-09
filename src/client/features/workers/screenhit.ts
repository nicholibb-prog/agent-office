// Which mesh a click landed on. The desk under a laptop is still what E uses; only a click on the
// laptop itself (this marker, walking up from the hit) enlarges its desktop.

export function markViewScreen(node: { userData: { viewScreen?: unknown } }, workerId: string) {
  node.userData.viewScreen = workerId;
}

export function clearViewScreen(node: { userData: { viewScreen?: unknown } }) {
  delete node.userData.viewScreen;
}

export interface ScreenNode {
  readonly userData: { readonly viewScreen?: unknown };
  readonly parent: ScreenNode | null;
}

/** The worker whose laptop `node` belongs to, if the ray hit that laptop rather than the desk around it. */
export function viewScreenId(node: ScreenNode | null): string | null {
  for (let o = node; o; o = o.parent) {
    const id = o.userData.viewScreen;
    if (typeof id === 'string' && id) return id;
  }
  return null;
}

/**
 * What a click does. A laptop in reach enlarges. Anything else, including a laptop you have not
 * walked up to, is the desk's own use — the same path as the E key, which never calls this.
 */
export function deskClick(screenId: string | null, near: boolean): 'enlarge' | 'use' {
  return screenId && near ? 'enlarge' : 'use';
}
