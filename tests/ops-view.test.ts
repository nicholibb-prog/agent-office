// Sparkline geometry and the ops page staying free of a seasonal theme.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { notWiredHtml, sparkPath } from '../src/shared/ops.js';

const root = path.join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

test('sparkPath is empty for no points, flat for one, and scaled into the box', () => {
  assert.equal(sparkPath([], 100, 40), '');
  assert.equal(sparkPath([5], 80, 20), 'M 0 10 L 80 10');
  assert.equal(sparkPath([0, 100], 100, 10), 'M 0 10 L 100 0');
  const pathD = sparkPath([0, 50, 100], 100, 40);
  const nums = [...pathD.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  assert.ok(nums.length >= 6);
  for (let i = 0; i < nums.length; i += 2) {
    assert.ok(nums[i]! >= 0 && nums[i]! <= 100);
    assert.ok(nums[i + 1]! >= 0 && nums[i + 1]! <= 40);
  }
});

test('a not-wired tile has no digits', () => {
  const html = notWiredHtml('missing');
  assert.match(html, /not wired/);
  assert.match(html, /missing/);
  assert.equal(/\d/.test(html), false);
  assert.equal(/\d/.test(notWiredHtml('path refused')), false);
});

test('the ops page does not load a seasonal theme', () => {
  const ts = read('src/client/ops.ts');
  const html = read('src/client/ops.html');
  const css = read('src/client/ops.css');
  assert.doesNotMatch(ts, /halloween|christmas|features\/.*theme/i);
  assert.doesNotMatch(html, /halloween|christmas/i);
  assert.doesNotMatch(css, /halloween|christmas/i);
  assert.doesNotMatch(ts, /from ['"]three(?:\/[^'"]*)?['"]/);
  assert.match(html, /theme-color" content="#14161a"/);
  assert.match(ts, /textContent/);
  assert.equal(ts.includes('innerHTML'), false);
  assert.match(ts, /RAM_WARN_PCT/);
  assert.match(ts, /RAM_STOP_PCT/);
  assert.match(ts, /kind: 'warn'/);
  assert.match(ts, /kind: 'stop'/);
  assert.doesNotMatch(ts, /mark:\s*70|ram > 70|ramLimitPct/);
});
