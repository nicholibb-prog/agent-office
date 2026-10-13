// The free-seat marker stays small: nothing of it (bob included) over 1 m off the floor, on any surface.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VACANCY, VACANCY_MAX_Y, vacancyLabelShown, vacancyTop, vacancyY } from '../src/shared/vacancy.js';
import { DESK_SIZE } from '../src/shared/layout.js';

test('free-seat marker is at most 1 m tall in total, on desks, lap desks and tall tables', () => {
  assert.equal(VACANCY.maxTop, 1.0);
  for (const surface of [0.45, DESK_SIZE.height, 0.8, 1.2, 2]) {
    const top = vacancyTop(vacancyY(surface));
    assert.ok(top <= 1.0 + 1e-9, `surface ${surface}: top ${top}`);
  }
  assert.ok(vacancyTop(VACANCY_MAX_Y) <= 1.0 + 1e-9);
  // Sits on the desk (its stem reaches the top), not floating high over it.
  const y = vacancyY(DESK_SIZE.height);
  assert.ok(y - VACANCY.size / 2 - VACANCY.stem <= DESK_SIZE.height + 1e-9);
  assert.ok(VACANCY.size <= 0.2);
});

test('free-seat label shows only on approach', () => {
  assert.equal(vacancyLabelShown(1, 1), true);
  assert.equal(vacancyLabelShown(2.4, 0), true);
  assert.equal(vacancyLabelShown(3, 0), false);
  assert.equal(vacancyLabelShown(10, 4), false);
});
