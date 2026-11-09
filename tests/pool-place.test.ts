// The work-pool poster and board stay clear of the floor plan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { placementProblems } from '../src/shared/pool-place.js';

test('the poster and the board do not overlap the floor plan', () => {
  assert.deepEqual(placementProblems(), []);
});

test('the pool art does not borrow another game\'s name', () => {
  const root = path.join(import.meta.dirname, '../src');
  const files = [
    'shared/pool.ts',
    'shared/pool-place.ts',
    'client/features/work-pool/badges.ts',
    'client/features/work-pool/world.ts',
    'client/features/work-pool/index.ts',
  ];
  for (const file of files) {
    const text = readFileSync(path.join(root, file), 'utf8');
    assert.equal(/\bCall of Duty\b/i.test(text), false, file);
    assert.equal(/\bCoD\b/.test(text), false, file);
  }
  const badge = path.join(root, 'client/features/work-pool');
  for (const name of readdirSync(badge)) {
    const full = path.join(badge, name);
    if (!statSync(full).isFile()) continue;
    assert.equal(/\.(png|jpe?g|gif|webp|svg)$/i.test(name), false, name);
  }
});
