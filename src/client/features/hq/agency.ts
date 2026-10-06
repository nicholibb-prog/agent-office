// Moves an idle crew mesh. The choice of where never changes a status chip.
import * as THREE from 'three';
import { CABINET, MEETING_TABLE } from '../../../shared/layout.js';
import { HOOP } from '../../../shared/hoop.js';
import type { Agency } from '../../../shared/hq.js';

const spot = new THREE.Vector3();

/** Puts a crew mesh back in its chair, or out in the room, without touching its status. */
export function placeCrew(input: {
  scene: THREE.Object3D;
  root: THREE.Object3D;
  seat: THREE.Object3D;
  agency: Agency;
  index: number;
  now: number;
}) {
  if (input.agency === 'seated') {
    if (input.root.parent !== input.seat) {
      input.seat.add(input.root);
      input.root.position.set(0, 0, 0);
      input.root.rotation.set(0, 0, 0);
    }
    return;
  }
  input.seat.updateWorldMatrix(true, false);
  input.seat.getWorldPosition(spot);
  const sway = Math.sin(input.now / 1000 + input.index) * 0.6;
  let x = spot.x;
  let z = spot.z;
  if (input.agency === 'aisle') {
    x += 1.4;
    z += sway;
  } else if (input.agency === 'huddle') {
    x = MEETING_TABLE.x - 1.2 + (input.index % 3) * 0.7;
    z = MEETING_TABLE.z + 1.3;
  } else if (input.agency === 'hoop') {
    x = HOOP.rim.x + 1.1;
    z = HOOP.z + (input.index % 2) * 0.5;
  } else {
    x = CABINET.x - 1.3;
    z = CABINET.z + sway * 0.3;
  }
  input.scene.add(input.root);
  input.root.position.set(x, spot.y, z);
}
