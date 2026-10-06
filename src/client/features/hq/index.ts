// Local crew: a fixed roster, a talk thread, a desk card, and idle-only movement.
import type * as THREE from 'three';
import { DESK_BY_ID } from '../../../shared/layout.js';
import { chooseAgency } from '../../../shared/hq.js';
import type { Ctx } from '../../core/context';
import { modalOpen } from '../../ui/dom';
import { store } from '../../state';
import { placeCrew } from './agency';
import { getJson, openDesk, openRoster, openTalk, postJson, seatLabel, type DeskCardView, type SeatRow, type TalkLine } from './ui';

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
    try {
      const data = await getJson<{ messages: TalkLine[]; name?: string; chip?: string; okkin?: { chip: string } }>(`/api/bridge/talk?seat=${encodeURIComponent(row.seat)}`);
      lines = data.messages;
      if (data.name) name = data.name;
      chip = data.okkin?.chip ?? data.chip ?? chip;
    } catch {
      lines = [];
    }
    closeRoster();
    const panel = openTalk(row.seat, lines, chip, (text) => {
      void postJson<{ messages?: TalkLine[]; chip?: string; okkin?: { chip: string } }>('/api/bridge/talk', { seat: row.seat, text }).then((res) => {
        const nextChip = res.body.okkin?.chip ?? res.body.chip ?? chip;
        panel.paint(res.body.messages ?? lines, nextChip);
        void loadRoster().catch(() => undefined);
      });
    }, () => talking.delete(row.seat), name);
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
