import test from 'node:test';
import assert from 'node:assert/strict';
import { deskFace, KEYSTROKE_MS, paintDesk, screenLines, type DeskFace } from '../src/client/features/workers/desktop.js';
import type { ScreenState } from '../src/client/state/store.js';
import { noteShellOutput, SHELL_QUIET_MS, shellQuiet } from '../src/server/workers/presence.js';
import type { Worker } from '../src/server/workers/types.js';
import type { WorkerStatus } from '../src/shared/protocol.js';

type Op = { kind: 'fillRect' | 'fillText'; args: unknown[] };

function canvasSpy() {
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
  return { ctx, ops };
}

function face(over: Partial<DeskFace> & Pick<DeskFace, 'pace' | 'chip' | 'now'>): DeskFace {
  return { name: 'Byte', lines: ['const live = true', 'paint the desk', 'status follows the worker'], activity: 'editing laptop.ts', ...over };
}

const SAME_SECOND = 1_700_000_000_000;

function paint(over: Partial<DeskFace> & Pick<DeskFace, 'pace' | 'chip' | 'now'>) {
  const { ctx, ops } = canvasSpy();
  paintDesk(ctx, 1024, 680, face(over));
  return ops;
}

test('desk pace follows working, needs-input, idle and a recent keystroke', () => {
  assert.deepEqual(deskFace('working', undefined, 10_000), { pace: 'working', chip: 'WORKING' });
  assert.deepEqual(deskFace('starting', undefined, 10_000), { pace: 'working', chip: 'STARTING' });
  assert.deepEqual(deskFace('needs_input', undefined, 10_000), { pace: 'attention', chip: 'NEEDS YOU' });
  assert.deepEqual(deskFace('idle', undefined, 10_000), { pace: 'calm', chip: 'idle' });
  assert.deepEqual(deskFace('done', undefined, 10_000), { pace: 'calm', chip: 'done' });
  assert.deepEqual(deskFace('offline', undefined, 10_000), { pace: 'calm', chip: 'asleep' });
  assert.deepEqual(deskFace('idle', 10_000 - 1000, 10_000), { pace: 'working', chip: 'WORKING' });
  assert.deepEqual(deskFace('idle', 10_000 - KEYSTROKE_MS, 10_000), { pace: 'calm', chip: 'idle' });
  assert.deepEqual(deskFace('exited', 10_000 - 100, 10_000), { pace: 'calm', chip: 'asleep' });
});

test('screen lines keep the tail of the terminal and drop blank rows', () => {
  const s: ScreenState = {
    cols: 20,
    rows: 4,
    lines: [[['   ', -1, -1, 0]], [['hello', -1, -1, 0]], undefined as unknown as ScreenState['lines'][number], [['world  ', -1, -1, 0]]],
    cursor: [0, 0],
    version: 1,
  };
  assert.deepEqual(screenLines(s), ['hello', 'world']);
  assert.deepEqual(screenLines(undefined), []);
});

test('a working desktop changes between frames and a calm one does not', () => {
  const workingA = paint({ pace: 'working', chip: 'WORKING', now: SAME_SECOND });
  const workingB = paint({ pace: 'working', chip: 'WORKING', now: SAME_SECOND + 600 });
  assert.notDeepEqual(workingA, workingB);
  assert.ok(workingA.some((op) => op.kind === 'fillText' && op.args[0] === 'WORKING'));

  const calmA = paint({ pace: 'calm', chip: 'idle', now: SAME_SECOND });
  const calmB = paint({ pace: 'calm', chip: 'idle', now: SAME_SECOND + 600 });
  assert.deepEqual(calmA, calmB);
  assert.ok(calmA.some((op) => op.kind === 'fillText' && op.args[0] === 'idle'));
  assert.notDeepEqual(workingA.filter((op) => op.kind === 'fillText').map((op) => op.args[0]), calmA.filter((op) => op.kind === 'fillText').map((op) => op.args[0]));
});

test('needs-you blinks its cursor without scrolling, and reduced motion holds one working pose', () => {
  const on = paint({ pace: 'attention', chip: 'NEEDS YOU', now: SAME_SECOND });
  const off = paint({ pace: 'attention', chip: 'NEEDS YOU', now: SAME_SECOND + 600 });
  assert.notEqual(on.filter((op) => op.kind === 'fillRect').length, off.filter((op) => op.kind === 'fillRect').length);
  const texts = (ops: Op[]) => ops.filter((op) => op.kind === 'fillText').map((op) => op.args[0]);
  assert.deepEqual(texts(on), texts(off));

  const stillA = paint({ pace: 'working', chip: 'WORKING', now: SAME_SECOND, still: true });
  const stillB = paint({ pace: 'working', chip: 'WORKING', now: SAME_SECOND + 600, still: true });
  assert.deepEqual(stillA, stillB);
  assert.notDeepEqual(stillA, paint({ pace: 'calm', chip: 'idle', now: SAME_SECOND, still: true }));
});

function shell(kind: 'shell' | 'agent', status: WorkerStatus): Worker {
  return { info: { kind, status } } as Worker;
}

test('shell output marks a sitting shell working, and silence sends it back to idle', () => {
  const sitting = shell('shell', 'idle');
  assert.equal(noteShellOutput(sitting, 1_000), 'working');
  assert.equal(sitting.outputAt, 1_000);
  const busy = shell('shell', 'working');
  busy.outputAt = 1_000;
  assert.equal(noteShellOutput(busy, 2_000), undefined);
  assert.equal(busy.outputAt, 2_000);
  assert.equal(shellQuiet(busy, 2_000 + SHELL_QUIET_MS - 1), undefined);
  assert.equal(shellQuiet(busy, 2_000 + SHELL_QUIET_MS), 'idle');

  const agent = shell('agent', 'idle');
  assert.equal(noteShellOutput(agent, 5_000), undefined);
  assert.equal(agent.outputAt, undefined);
  const agentBusy = shell('agent', 'working');
  agentBusy.outputAt = 0;
  assert.equal(shellQuiet(agentBusy, SHELL_QUIET_MS + 1), undefined);

  const asking = shell('shell', 'needs_input');
  assert.equal(noteShellOutput(asking, 3_000), undefined);
  assert.equal(asking.outputAt, 3_000);
});
