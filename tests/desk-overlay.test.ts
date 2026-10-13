import test from 'node:test';
import assert from 'node:assert/strict';
import { paintDesk, workerDesktop, type DeskFace } from '../src/client/features/workers/desktop.js';
import { clearViewScreen, deskClick, markViewScreen, viewScreenId, type ScreenNode } from '../src/client/features/workers/screenhit.js';
import type { ScreenState } from '../src/client/state/store.js';

function node(parent: ScreenNode | null = null): { userData: { viewScreen?: unknown }; parent: ScreenNode | null } {
  return { userData: {}, parent };
}

test('a click on a laptop names that worker, and the desk around it does not', () => {
  const desk = node();
  const laptop = node(desk);
  markViewScreen(laptop, 'w-shell');
  const screen = node(laptop);
  assert.equal(viewScreenId(screen), 'w-shell');
  assert.equal(viewScreenId(desk), null);
  const blank = node();
  blank.userData.viewScreen = '';
  const num = node();
  num.userData.viewScreen = 4;
  assert.equal(viewScreenId(blank), null);
  assert.equal(viewScreenId(num), null);
  clearViewScreen(laptop);
  assert.equal(viewScreenId(screen), null);
});

test('only a laptop you are close enough to enlarges; E is the other path', () => {
  assert.equal(deskClick('w1', true), 'enlarge');
  assert.equal(deskClick('w1', false), 'use');
  assert.equal(deskClick(null, true), 'use');
  assert.equal(deskClick(null, false), 'use');
});

type Op = { kind: 'fillRect' | 'fillText'; args: unknown[] };

function paint(face: DeskFace) {
  const ops: Op[] = [];
  const ctx = {
    fillStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
    globalAlpha: 1,
    save() {},
    restore() {},
    fillRect(...args: unknown[]) { ops.push({ kind: 'fillRect', args }); },
    fillText(...args: unknown[]) { ops.push({ kind: 'fillText', args }); },
  } as unknown as CanvasRenderingContext2D;
  paintDesk(ctx, 1600, 900, face);
  return ops;
}

const T = 1_700_000_000_000;

function screen(text: string): ScreenState {
  return { cols: 20, rows: 2, lines: [[[text, -1, -1, 0]]], cursor: [0, 0], version: 1 };
}

test('shells and agents paint the same working desktop, and it keeps moving', () => {
  const shell = workerDesktop({ kind: 'shell', status: 'working', name: 'sh', activity: 'npm test' }, screen('ok'), T, T);
  const agent = workerDesktop({ kind: 'agent', status: 'working', name: 'Byte', activity: 'editing' }, screen('ok'), T, T);
  assert.equal(shell.pace, 'working');
  assert.equal(shell.chip, 'WORKING');
  assert.equal(agent.pace, 'working');
  assert.equal(agent.chip, 'WORKING');
  assert.deepEqual(shell.lines, ['ok']);
  assert.notDeepEqual(paint(shell), paint(workerDesktop({ kind: 'shell', status: 'working', name: 'sh', activity: 'npm test' }, screen('ok'), T + 600, T + 600)));

  const idle = workerDesktop({ kind: 'shell', status: 'idle', name: 'sh' }, undefined, T, T);
  const idleLater = workerDesktop({ kind: 'agent', status: 'idle', name: 'Byte' }, undefined, T + 600, T + 600);
  assert.equal(idle.pace, 'calm');
  assert.equal(idle.chip, 'idle');
  assert.equal(idleLater.pace, 'calm');
  assert.deepEqual(paint(idle), paint({ ...idle, now: T + 600 }));
  assert.notDeepEqual(paint(shell).filter((op) => op.kind === 'fillText').map((op) => op.args[0]), paint(idle).filter((op) => op.kind === 'fillText').map((op) => op.args[0]));
});

test('an empty screen uses the stand-in line, and a recent keystroke wakes an idle shell', () => {
  assert.deepEqual(workerDesktop({ kind: 'shell', status: 'offline', name: 'Nap' }, undefined, T, T).lines, ['💤 Nap is asleep — press R to restart']);
  assert.deepEqual(workerDesktop({ kind: 'agent', status: 'offline', name: 'Nap' }, undefined, T, T).lines, ['💤 Nap is asleep — press R to resume']);
  assert.equal(workerDesktop({ kind: 'shell', status: 'idle', name: 'sh', lastInput: { at: T - 1000 } }, undefined, T, T).pace, 'working');
  assert.equal(workerDesktop({ kind: 'agent', status: 'needs_input', name: 'Byte' }, undefined, T, T).chip, 'NEEDS YOU');
  const stillA = workerDesktop({ kind: 'agent', status: 'working', name: 'Byte' }, undefined, T, T, true);
  const stillB = workerDesktop({ kind: 'agent', status: 'working', name: 'Byte' }, undefined, T + 600, T + 600, true);
  assert.deepEqual(paint(stillA), paint(stillB));
});
