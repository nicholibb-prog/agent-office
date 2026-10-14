// Local crew: a fixed roster, a talk thread, a desk card, and idle-only movement.
import type * as THREE from 'three';
import { DESK_BY_ID } from '../../../shared/layout.js';
import { CREW_PRIVATE_NOTE, chooseAgency, talkLocked, talkSendError, threadPrivateNote } from '../../../shared/hq.js';
import { keepOnLock, loadFailNote } from '../../../shared/privacy-view.js';
import type { Ctx } from '../../core/context';
import { modalOpen } from '../../ui/dom';
import { store } from '../../state';
import { placeCrew } from './agency';
import { HttpError, getJson, openDesk, openOutbox, openRoster, openTalk, postJson, seatLabel, type DeskCardView, type SeatRow, type TalkLine } from './ui';

export interface HqDeps {
  workerViews: ReadonlyMap<string, { deskId: string; model: { root: THREE.Object3D } }>;
  walkThen(at: { x: number; y?: number; z: number }, what: string, then: () => void, face?: { x: number; z: number }): void;
}

const NEAR = 2.5;

export function installHq(ctx: Ctx, deps: HqDeps) {
  let rows: SeatRow[] = [];
  let roster: { paint: (rows: SeatRow[]) => void; close: () => void } | null = null;
  const talking = new Set<string>();
  let timer = 0;

  async function loadRoster() {
    const data = await getJson<{ seats: SeatRow[] }>('/api/bridge/roster');
    rows = data.seats;
    roster?.paint(rows);
    return rows;
  }

  function rowOf(seat: string) {
    return rows.find((r) => r.seat === seat);
  }

  function closeRoster() {
    const open = roster;
    roster = null;
    open?.close();
  }

  function go(row: SeatRow) {
    const desk = row.deskId ? DESK_BY_ID.get(row.deskId) : undefined;
    if (!desk) return;
    closeRoster();
    deps.walkThen({ x: desk.x, z: desk.z }, `${seatLabel(row)}'s desk`, () => {});
  }

  async function talk(row: SeatRow) {
    talking.add(row.seat);
    let lines: TalkLine[] = [];
    let name = seatLabel(row);
    let chip = row.chip;
    let note: string | null = null;
    let locked = false;
    type TalkGet = { messages: TalkLine[]; private?: boolean; name?: string; chip?: string; okkin?: { chip: string } };
    const fetchThread = () => getJson<TalkGet>(`/api/bridge/talk?seat=${encodeURIComponent(row.seat)}`);
    try {
      const data = await fetchThread();
      lines = data.messages;
      note = threadPrivateNote(row.seat, data);
      locked = talkLocked(data);
      if (data.name) name = data.name;
      chip = data.okkin?.chip ?? data.chip ?? chip;
    } catch (err) {
      lines = [];
      note = loadFailNote(err instanceof HttpError ? err.status : undefined, 'Could not load the thread.');
    }
    closeRoster();
    let poll = 0;
    /** Reload: after an unlock, or every 20 s; an idle-timeout lock keeps the last lines under the note. */
    const reload = () =>
      fetchThread()
        .then((data) => {
          const privateNote = threadPrivateNote(row.seat, { messages: [], private: true }) ?? CREW_PRIVATE_NOTE;
          const view = keepOnLock(lines, { private: data.private, items: data.messages }, privateNote);
          lines = view.items;
          chip = data.okkin?.chip ?? data.chip ?? chip;
          panel.paint(lines, chip, view.note);
          if (talkLocked(data)) panel.lock();
          else panel.unlock();
        })
        .catch((err) => panel.paint(lines, chip, loadFailNote(err instanceof HttpError ? err.status : undefined, 'Could not load the thread.')));
    const panel = openTalk(row.seat, lines, chip, (text) => {
      void postJson<{ messages?: TalkLine[]; chip?: string; okkin?: { chip: string }; error?: string }>('/api/bridge/talk', { seat: row.seat, text }).then((res) => {
        if (res.status === 403) return panel.lock(talkSendError(403));
        if (res.status === 401) return panel.say(loadFailNote(401, ''));
        if (res.status !== 200) return panel.say(talkSendError(res.status, res.body.error));
        const nextChip = res.body.okkin?.chip ?? res.body.chip ?? chip;
        lines = res.body.messages ?? lines;
        panel.paint(lines, nextChip, null);
        void loadRoster().catch(() => undefined);
      });
    }, () => {
      talking.delete(row.seat);
      clearInterval(poll);
    }, name, note, locked, { onUnlock: () => void reload() });
    poll = window.setInterval(() => void reload(), 20_000);
    panel.focus();
  }

  async function desk(row: SeatRow) {
    let card: DeskCardView = { task: 'No task yet', milestone: 'No milestone yet', link: '', condition: 'quiet', actions: [], needs: 'Nothing asked' };
    try {
      const data = await getJson<{ card: DeskCardView }>(`/api/bridge/desk?seat=${encodeURIComponent(row.seat)}`);
      card = data.card;
    } catch {
      /* the empty card stays */
    }
    openDesk(row.seat, card, seatLabel(row));
  }

  async function showRoster() {
    try {
      await loadRoster();
    } catch {
      rows = [];
    }
    const panel = openRoster(rows, {
      go,
      talk: (row) => void talk(row),
      desk: (row) => void desk(row),
      outbox: () => {
        closeRoster();
        const names = Object.fromEntries(rows.map((r) => [r.seat, r.name]));
        const show = () =>
          void getJson<{ items?: { title?: string; text?: string; at?: string; seat?: string | null }[]; private?: boolean }>('/api/bridge/kavi-outbox')
            .then((data) => openOutbox(data, { names, onUnlock: show }))
            .catch((err) => openOutbox(null, { failNote: loadFailNote(err instanceof HttpError ? err.status : undefined, 'Could not load the outbox.') }));
        show();
      },
      switchModel: (name) => {
        void postJson('/api/bridge/okkin/model', { model: name }).then(() => loadRoster().catch(() => undefined));
      },
    }, () => {
      roster = null;
    });
    roster = panel;
  }

  function nearestCrew(): SeatRow | null {
    let best: SeatRow | null = null;
    let dist = NEAR;
    for (const w of store.workers.values()) {
      if (w.kind !== 'crew') continue;
      const seat = w.id.startsWith('crew-') ? w.id.slice(5) : '';
      const row = rowOf(seat) ?? { seat, index: 0, deskId: w.deskId, chip: w.status, age: '', task: w.task?.name ?? '', live: false };
      const desk = DESK_BY_ID.get(w.deskId);
      if (!desk) continue;
      const d = Math.hypot(ctx.player.pos.x - desk.x, ctx.player.pos.z - desk.z);
      if (d < dist) {
        dist = d;
        best = row;
      }
    }
    return best;
  }

  ctx.keys.bind({
    code: 'KeyY',
    when: () => !modalOpen(),
    run() {
      const near = nearestCrew();
      if (near) void talk(near);
      else void showRoster();
    },
  });

  ctx.ticks.add('world', () => {
    const now = Date.now();
    if (now - timer > 8000) {
      timer = now;
      void loadRoster().catch(() => undefined);
    }
    const world = ctx.world();
    const onOffice = world.group === ctx.office.group;
    const meetingOn = onOffice && store.meeting.current?.status === 'running';
    for (const row of rows) {
      const view = deps.workerViews.get(`crew-${row.seat}`);
      const desk = view ? world.desks.get(view.deskId) : undefined;
      if (!view || !desk) continue;
      const idleClear = row.chip === 'idle' && !row.live && !talking.has(row.seat);
      const agency = chooseAgency({
        idleClear,
        seatIndex: row.index,
        now,
        meetingOn,
        hoop: onOffice && !!ctx.office.hoop,
        arcade: onOffice && !!ctx.office.cabinet,
      });
      placeCrew({ scene: ctx.scene, root: view.model.root, seat: desk.seatAnchor, agency, index: row.index, now });
    }
  });
}
