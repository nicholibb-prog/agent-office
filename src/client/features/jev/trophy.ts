// A low-poly gold cup. The board stands one beside itself; placeTrophyOnDesk parents another to a
// desk when a milestone fires and that agent names a desk.
import * as THREE from 'three';
import { JEV_MILESTONE_SCORE } from '../../../shared/jev';
import { DESK_SIZE } from '../../../shared/layout';
import { mesh, toon } from '../../world/toon';
import type { DeskView } from '../../world/types';

const GOLD = '#e6b422';

/** The cup, standing on the floor of its own group (the base is at y = 0). */
export function buildTrophy(): THREE.Group {
  const cup = new THREE.Group();
  cup.name = 'jev-trophy';
  const gold = toon(GOLD, { emissive: '#5c4308' });
  const dark = toon('#8a6a12');
  cup.add(mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.045, 8), dark, 0, 0.022, 0, false));
  cup.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.03, 8), gold, 0, 0.055, 0, false));
  cup.add(mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.11, 6), gold, 0, 0.12, 0, false));
  cup.add(mesh(new THREE.CylinderGeometry(0.085, 0.045, 0.13, 8), gold, 0, 0.24, 0, false));
  const rim = mesh(new THREE.TorusGeometry(0.085, 0.012, 6, 10), gold, 0, 0.3, 0, false);
  rim.rotation.x = Math.PI / 2;
  cup.add(rim);
  for (const side of [-1, 1]) {
    const handle = mesh(new THREE.TorusGeometry(0.04, 0.01, 5, 8), gold, side * 0.105, 0.24, 0, false);
    handle.rotation.y = Math.PI / 2;
    cup.add(handle);
  }
  return cup;
}

/**
 * Parents a cup to `desk`, on the desktop at the worker's left, clear of the laptop.
 * Desk ids that aren't a normal desk (a bean bag, a lectern) still get the cup in that group's space:
 * where it should sit on those seats is left for a later pass.
 */
export function placeTrophyOnDesk(desk: DeskView): THREE.Group {
  const cup = buildTrophy();
  cup.scale.setScalar(0.7);
  cup.position.set(-DESK_SIZE.width / 2 + 0.28, DESK_SIZE.height, 0.18);
  desk.group.add(cup);
  return cup;
}

/**
 * Keeps one cup per agent on the desks of `rankings` that have reached the milestone and named a desk.
 * `placed` is this world's cups, keyed by agent id. An agent with no deskId is skipped.
 */
export function syncDeskTrophies(
  desks: ReadonlyMap<string, DeskView>,
  rankings: readonly { agentId: string; deskId?: string; rankScore: number }[],
  placed: Map<string, THREE.Group>,
): void {
  const want = new Map<string, string>();
  for (const row of rankings) {
    if (row.deskId && row.rankScore >= JEV_MILESTONE_SCORE) want.set(row.agentId, row.deskId);
  }
  for (const [id, cup] of placed) {
    if (want.get(id) !== cup.userData.deskId) {
      cup.removeFromParent();
      placed.delete(id);
    }
  }
  for (const [id, deskId] of want) {
    if (placed.has(id)) continue;
    const desk = desks.get(deskId);
    if (!desk) continue;
    const cup = placeTrophyOnDesk(desk);
    cup.userData.deskId = deskId;
    placed.set(id, cup);
  }
}
