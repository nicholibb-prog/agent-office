/**
 * First frame of a boot or a spawn: the unblock strip (actionable blocks only) and, once,
 * the morning delta. Both come from the bridge files plus the desks already on the floor.
 * Yes/No types a permission key. Open talk opens the terminal. Nothing here writes a reply.
 */
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { $, toast } from '../../ui/dom';
import {
  digestHasLines,
  EMPTY_BOOK,
  liveBlock,
  liveFromInfo,
  mergeBlocks,
  type Brief,
  type Decision,
} from '../../../shared/hq-brief';
import { openDigest, Strip } from './ui';

const VISIT_KEY = 'ao.hq.lastVisit';
/** How long a tapped row stays down before it comes back, if the desk is still blocked. */
const QUIET_MS = 8_000;

export type HqBriefDeps = {
  openTalk(workerId: string): void;
};

function storedSince(): number | undefined {
  const n = Number(localStorage.getItem(VISIT_KEY));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function installHqBrief(ctx: Ctx, deps: HqBriefDeps) {
  const quietUntil = new Map<string, number>();
  let serverBlocks: Decision[] = [];
  let gotServer = false;
  let headline = 'Needs a decision';
  let digestOpened = false;
  let refetchTimer = 0;

  const strip = new Strip($('hud'), {
    yes: (b) => void answer(b, 'yes'),
    no: (b) => void answer(b, 'no'),
    talk: (b) => openTalk(b),
  });

  function liveNow(): Decision[] {
    const out: Decision[] = [];
    for (const w of store.workers.values()) {
      const b = liveBlock(liveFromInfo(w), EMPTY_BOOK);
      if (b) out.push(b);
    }
    return out;
  }

  function paint() {
    const now = Date.now();
    const live = liveNow();
    let blocks: Decision[];
    if (!gotServer) blocks = live;
    else {
      const known = new Set(serverBlocks.map((s) => s.workerId).filter((id): id is string => !!id));
      const still = serverBlocks.filter((b) => {
        if (!b.workerId) return true;
        const w = store.workers.get(b.workerId);
        return !w || w.status === 'needs_input';
      });
      const extra = live.filter((b) => !b.workerId || !known.has(b.workerId));
      blocks = mergeBlocks(still, extra);
    }
    strip.show(headline, blocks.filter((b) => (quietUntil.get(b.id) ?? 0) <= now), now);
  }

  function openTalk(b: Decision) {
    if (b.workerId) deps.openTalk(b.workerId);
    else {
      $('chat').classList.add('peek');
      ($('chat-input') as HTMLInputElement).focus();
    }
  }

  async function answer(b: Decision, which: 'yes' | 'no') {
    quietUntil.set(b.id, Date.now() + QUIET_MS);
    paint();
    try {
      const res = await fetch('/api/bridge/unblock/answer', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: b.id, answer: which, workerId: b.workerId }),
      });
      if (!res.ok) {
        quietUntil.delete(b.id);
        toast(which === 'yes' ? 'Yes did not land' : 'No did not land', 'warn');
      }
    } catch {
      quietUntil.delete(b.id);
      toast('The office did not take that', 'warn');
    }
    paint();
  }

  async function pull() {
    const since = storedSince();
    const q = since ? `?since=${since}` : '';
    let body: Brief;
    try {
      const res = await fetch(`/api/bridge/hq-brief${q}`, { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return;
      body = (await res.json()) as Brief;
    } catch {
      return;
    }
    gotServer = true;
    headline = body.headline || headline;
    serverBlocks = Array.isArray(body.blocks) ? body.blocks : [];
    paint();
    if (digestOpened) return;
    digestOpened = true;
    if (!body.digest || !digestHasLines(body.digest)) return;
    openDigest(body.digest, () => {
      const at = Date.now();
      localStorage.setItem(VISIT_KEY, String(at));
      void fetch('/api/bridge/hq-brief/seen', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ at }),
      }).catch(() => undefined);
    });
  }

  function schedule() {
    window.clearTimeout(refetchTimer);
    refetchTimer = window.setTimeout(() => void pull(), 400);
  }

  store.on('workers', () => {
    paint();
    schedule();
  });

  paint();
  void pull();
  window.setInterval(paint, 15_000);
}
