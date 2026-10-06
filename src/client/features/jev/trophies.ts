import * as THREE from 'three';
import { DESK_SIZE } from '../../../shared/layout';
import type { JevTrophy } from '../../../shared/jev';
import { mesh, toon } from '../../world/toon';
import type { DeskView } from '../../world/types';

const GOLD = '#ffd166';
const CUP = '#c9a227';

/**
 * A milestone cup on a desk. Stub: a small gold cup on the desktop, one per trophy,
 * offset so several can share a desk. No animation and no network.
 */
export function spawnTrophyStub(parent: THREE.Object3D, label: string, index: number): THREE.Group {
  const group = new THREE.Group();
  group.name = `jev-trophy-${label}`;
  group.position.set(0.72 - index * 0.18, DESK_SIZE.height, 0.28);
  const gold = toon(GOLD);
  const cup = toon(CUP);
  group.add(mesh(new THREE.CylinderGeometry(0.045, 0.03, 0.07, 8), gold, 0, 0.07, 0, false));
  group.add(mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.02, 8), cup, 0, 0.11, 0, false));
  group.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.04, 6), gold, 0, 0.02, 0, false));
  group.add(mesh(new THREE.BoxGeometry(0.09, 0.012, 0.06), cup, 0, 0.008, 0, false));
  parent.add(group);
  return group;
}

/** Puts the board's cups on the desks that earned them, and takes away the ones that no longer qualify. */
export function syncTrophies(desks: ReadonlyMap<string, DeskView>, trophies: readonly JevTrophy[], spawned: Map<string, THREE.Group>) {
  const want = new Map<string, { trophy: JevTrophy; index: number }>();
  const perDesk = new Map<string, number>();
  for (const trophy of trophies) {
    const index = perDesk.get(trophy.deskId) ?? 0;
    perDesk.set(trophy.deskId, index + 1);
    want.set(`${trophy.deskId}:${trophy.milestone}`, { trophy, index });
  }
  for (const [key, group] of spawned) {
    if (want.has(key)) continue;
    group.removeFromParent();
    spawned.delete(key);
  }
  for (const [key, { trophy, index }] of want) {
    if (spawned.has(key)) continue;
    const desk = desks.get(trophy.deskId);
    if (!desk) continue;
    spawned.set(key, spawnTrophyStub(desk.group, trophy.label, index));
  }
}
