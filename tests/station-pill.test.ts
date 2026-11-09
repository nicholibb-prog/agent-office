import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bubbleFor, taskChip } from '../src/client/world/character/worker-badges';

describe('task card pill', () => {
  it('shows a pill only for a status it knows', () => {
    assert.equal(taskChip('idle')?.[0], '💬 READY');
    assert.equal(taskChip('bogus'), undefined);
    assert.equal(taskChip('toString'), undefined);
  });
  it('a board agent card (no status of its own) is keyed apart from a real READY one', () => {
    const t = { name: 'Ask me about PRs', summary: 'I sum up PRs' };
    const real = bubbleFor('idle', false, t as never, undefined, false).key;
    const station = bubbleFor('idle', false, { ...t, noStatus: true } as never, undefined, false).key;
    assert.notEqual(real, station);
    assert.ok(station.startsWith('true|'));
  });
});
