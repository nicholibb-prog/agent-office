// Client view of "is this browser the owner?", shared by the Kavi send panel and the unblock strip.
// It works with or without server-side owner-only POSTs: it learns from owner reads (private flag)
// and from any 403 on an owner-only action, and a successful unlock sets it.
import { ownerFrom } from '../../shared/privacy-view.js';

let owner: boolean | null = null;
const subs = new Set<(owner: boolean | null) => void>();

export function currentOwner(): boolean | null {
  return owner;
}

export function setOwner(next: boolean | null): void {
  if (next === owner) return;
  owner = next;
  for (const f of subs) f(owner);
}

export function noteOwner(r: { status?: number; private?: boolean | null }): void {
  setOwner(ownerFrom(owner, r));
}

export function onOwner(f: (owner: boolean | null) => void): () => void {
  subs.add(f);
  return () => subs.delete(f);
}

/** Cheap owner probe: the Kavi outbox read says private:true for any non-owner session. */
export async function probeOwner(): Promise<boolean | null> {
  try {
    const r = await fetch('/api/bridge/kavi-outbox', { credentials: 'same-origin', cache: 'no-store' });
    if (r.ok) noteOwner({ private: ((await r.json()) as { private?: boolean }).private === true });
  } catch {
    /* unknown stays unknown */
  }
  return owner;
}
