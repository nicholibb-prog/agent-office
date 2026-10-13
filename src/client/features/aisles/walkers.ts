/**
 * Workers up out of their seats, strolling the aisles (see logic.ts for who may, and index.ts for
 * when). Each hops down beside its chair, walks the nav grid's route between the desks to a spot or
 * two in the aisle, stands there a moment, and walks back and hops into its seat. Every step goes
 * through stepToward (player/collide.ts), the same collision the Bridge NPC walks with, so a walker
 * slides along a desk or a wall and never through it; one that can't get on turns for home, and one
 * that can't get home is put straight back in its seat.
 *
 * Light on the machine: a fixed row of slots (the cap), plain loops, scratch vectors made once, and
 * nothing allocated per frame. Routes are planned only when a walker sets off for somewhere new.
 */
import * as THREE from 'three';
import type { Pt } from '../../../shared/nav';
import type { DeskDef } from '../../../shared/layout';
import { stepToward, type Body } from '../../player/collide';
import type { Collider } from '../../world/types';
import { AMBLE, pauseFor } from './logic';

/** What it takes of a worker's model to walk it about (Worker has all of it). */
export interface StrollModel {
  root: THREE.Object3D;
  walking: boolean;
  gait: number;
  stopDancing(): void;
}

/** What it takes of a seat (DeskView has all of it). */
export interface StrollSeat {
  def: DeskDef;
  seatAnchor: THREE.Object3D;
}

/** The routes it walks (NavGrid has all of them). */
export interface StrollNav {
  wayFrom(seat: DeskDef, to: Pt): Pt[];
  wayTo(from: Pt, seat: DeskDef): Pt[];
  route(from: Pt, to: Pt): Pt[];
}

/** Seconds hopping down off its seat, or up onto it. */
const HOP = 0.5;
/** A worker's feet are this far above its origin (see world/court.ts). */
const FEET = 0.07;
/** Close enough to a corner of its route to head for the next. */
const ARRIVE = 0.08;
/** Seconds making next to no headway before it gives up on where it's going. */
const STUCK_S = 0.75;

type Phase = 'down' | 'walk' | 'pause' | 'up';

interface Walker {
  id: string;
  model: StrollModel;
  seat: StrollSeat;
  phase: Phase;
  way: Pt[];
  next: number;
  /** The spots it means to stop at, and which it's on. */
  stops: Pt[];
  stop: number;
  homeward: boolean;
  hop: number;
  from: THREE.Vector3;
  body: Body;
  heading: number;
  /** Seconds left standing at a spot. */
  wait: number;
  stuck: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Strollers {
  private readonly slots: (Walker | null)[];
  private readonly tmp = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly turn = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();

  constructor(
    /** Where walkers stand while they're up (the office's group, which sits at the world's origin). */
    private readonly parent: () => THREE.Object3D,
    /** What's in the way: the office's walls, desks and furniture, as the player bumps into them. */
    private readonly colliders: () => Collider[],
    private readonly nav: () => StrollNav,
    readonly cap: number,
    private readonly rng: () => number = Math.random,
  ) {
    this.slots = new Array<Walker | null>(Math.max(0, cap)).fill(null);
  }

  /** How many are up right now. */
  get count(): number {
    let n = 0;
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i]) n++;
    return n;
  }

  /** Whether `id` is up out of its seat. */
  away(id: string): boolean {
    return this.slotOf(id) >= 0;
  }

  /** Where `id` stands, if it's up (a copy, for tests and hints; not for the frame loop). */
  where(id: string): { x: number; z: number; phase: Phase } | undefined {
    const w = this.slots[this.slotOf(id)];
    return w ? { x: w.body.pos.x, z: w.body.pos.z, phase: w.phase } : undefined;
  }

  /**
   * Gets `id` up from `seat` to stroll to `stops` and back. False (and it stays put) when the cap
   * is reached, it's up already, or there's nowhere to go.
   */
  start(id: string, model: StrollModel, seat: StrollSeat, stops: Pt[]): boolean {
    if (!stops.length || this.away(id)) return false;
    const free = this.slots.indexOf(null);
    if (free < 0) return false;
    const way = this.nav().wayFrom(seat.def, stops[0]);
    if (way.length < 2) return false;
    model.stopDancing();
    const root = model.root;
    const from = root.getWorldPosition(new THREE.Vector3());
    root.getWorldScale(this.scale);
    root.getWorldQuaternion(this.turn);
    const heading = this.euler.setFromQuaternion(this.turn, 'YXZ').y;
    const parent = this.parent();
    parent.add(root);
    root.position.copy(from);
    parent.worldToLocal(root.position);
    root.rotation.set(0, heading, 0);
    root.scale.setScalar(this.scale.x);
    const body: Body = { pos: new THREE.Vector3(way[0][0], 0, way[0][1]), colliders: this.colliders(), grounded: false, stepOffset: 0 };
    this.slots[free] = { id, model, seat, phase: 'down', way, next: 0, stops, stop: 0, homeward: false, hop: 0, from, body, heading, wait: 0, stuck: 0 };
    return true;
  }

  /** Puts `id` straight back in its seat, no walking: it has work, it's watched, or the office closed. */
  seat(id: string) {
    const i = this.slotOf(id);
    if (i >= 0) this.sitDown(i);
  }

  /** Everyone straight back in their seats. */
  seatAll() {
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i]) this.sitDown(i);
  }

  /** Back in their seats, at once, every walker `keep` says no to. */
  seatUnless(keep: (id: string, model: StrollModel) => boolean) {
    for (let i = 0; i < this.slots.length; i++) {
      const w = this.slots[i];
      if (w && !keep(w.id, w.model)) this.sitDown(i);
    }
  }

  /** Lets go, without touching their models, of every walker `alive` says has been taken away (there's no seat to put it back in). */
  forgetUnless(alive: (id: string, model: StrollModel) => boolean) {
    for (let i = 0; i < this.slots.length; i++) {
      const w = this.slots[i];
      if (w && !alive(w.id, w.model)) this.slots[i] = null;
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.slots.length; i++) {
      const w = this.slots[i];
      if (w) this.step(i, w, dt);
    }
  }

  private slotOf(id: string): number {
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i]?.id === id) return i;
    return -1;
  }

  private step(i: number, w: Walker, dt: number) {
    const root = w.model.root;
    const pos = w.body.pos;
    if (w.phase === 'down' || w.phase === 'up') {
      // A little hop down off the seat into the aisle, or up from beside the chair onto it.
      w.hop = Math.min(1, w.hop + dt / HOP);
      const to = w.phase === 'down' ? this.tmp.set(w.way[0][0], -FEET, w.way[0][1]) : w.seat.seatAnchor.getWorldPosition(this.tmp);
      root.position.lerpVectors(w.from, to, w.hop);
      root.position.y += Math.sin(w.hop * Math.PI) * 0.3;
      this.parent().worldToLocal(root.position);
      const face = w.phase === 'up' ? w.seat.def.rotY + Math.PI : w.heading;
      root.rotation.y += wrap(face - root.rotation.y) * Math.min(1, dt * 8);
      if (w.hop < 1) return;
      if (w.phase === 'up') return this.sitDown(i);
      w.phase = 'walk';
      w.next = 1;
      w.model.walking = true;
      return;
    }
    if (w.phase === 'pause') {
      w.wait -= dt;
      if (w.wait <= 0) this.setOff(w);
      return;
    }
    const target = w.way[w.next];
    const dx = target[0] - pos.x;
    const dz = target[1] - pos.z;
    if (Math.hypot(dx, dz) < ARRIVE) {
      w.next++;
      if (w.next >= w.way.length) this.arrive(i, w);
      return;
    }
    const step = AMBLE * dt;
    const moved = stepToward(w.body, target[0], target[1], step);
    // Making next to no headway: something's in the way that the route didn't know about.
    if (moved < step * 0.15) {
      w.stuck += dt;
      if (w.stuck > STUCK_S) this.giveUp(i, w);
    } else w.stuck = 0;
    w.heading = Math.atan2(dx, dz);
    root.position.set(pos.x, pos.y - FEET, pos.z);
    this.parent().worldToLocal(root.position);
    root.rotation.y += wrap(w.heading - root.rotation.y) * Math.min(1, dt * 8);
  }

  /** At the end of its route: beside its chair, to hop up, or at a spot, to stand a while. */
  private arrive(i: number, w: Walker) {
    w.model.walking = false;
    if (w.homeward) {
      w.phase = 'up';
      w.hop = 0;
      w.from.copy(w.model.root.position);
      this.parent().localToWorld(w.from);
      return;
    }
    w.phase = 'pause';
    w.wait = pauseFor(this.rng);
  }

  /** On from where it stands: to the next spot, or home. */
  private setOff(w: Walker) {
    const here: Pt = [w.body.pos.x, w.body.pos.z];
    w.stop++;
    if (w.stop < w.stops.length) w.way = this.nav().route(here, w.stops[w.stop]);
    else {
      w.homeward = true;
      w.way = this.nav().wayTo(here, w.seat.def);
    }
    w.next = 1;
    w.stuck = 0;
    w.phase = 'walk';
    w.model.walking = true;
  }

  /** Can't get where it's going without going through something: home instead, or if it was going home, straight into its seat. */
  private giveUp(i: number, w: Walker) {
    if (w.homeward) return this.sitDown(i);
    w.stop = w.stops.length;
    this.setOff(w);
  }

  /** Back in its seat: from here on it's where every worker sits. */
  private sitDown(i: number) {
    const w = this.slots[i];
    if (!w) return;
    this.slots[i] = null;
    const root = w.model.root;
    w.model.walking = false;
    w.model.gait = 1;
    w.seat.seatAnchor.add(root);
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scale.setScalar(1);
  }
}
