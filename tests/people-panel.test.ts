// Item 18: the People button's panel is the only presence list; no separate "In the office" box.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../src/client/index.html', import.meta.url), 'utf8');

test('no "In the office" list box; one People panel, outside the side column', () => {
  assert.ok(!/<h3>\s*In the office/.test(html), 'old heading is gone');
  assert.equal(html.match(/id="people-panel"/g)?.length, 1);
  assert.equal(html.match(/id="people"/g)?.length, 1, 'one list, which renderPeople fills (click = walk over)');
  const side = html.slice(html.indexOf('<aside class="side">'), html.indexOf('</aside>'));
  assert.ok(!side.includes('people-panel'), 'not a sidebar box any more');
  assert.match(html, /<h3>People /);
});
