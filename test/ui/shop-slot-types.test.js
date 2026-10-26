import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partitionShopSlots } from '../../public/js/ui/gameLogic/shop.js';

test('special refresh can put an operator in the equipment position without losing its purchase index', () => {
  const slots = Array.from({ length: 6 }, (_, i) => ({ kind: 'chess', id: `chess_${i}` }));
  const result = partitionShopSlots(slots, { chess: 5, item: 1 });
  assert.equal(result.itemSlots.length, 0);
  assert.deepEqual(result.chessSlots.map(x => x.i), [0, 1, 2, 3, 4, 5]);
  assert.equal(result.chessSlots[5].s, slots[5]);
});
test('empty upgraded equipment slots retain layout; actual item goods retain their type', () => {
  const slots = [{ kind: 'chess' }, { kind: 'item' }, null];
  const result = partitionShopSlots(slots, { chess: 2, item: 1 });
  assert.deepEqual(result.chessSlots.map(x => x.i), [0]);
  assert.deepEqual(result.itemSlots.map(x => x.i), [1, 2]);
});
test('legacy frames without layout preserve kind and empty chess positions', () => {
  const result = partitionShopSlots([null, { kind: 'item', sold: true }]);
  assert.deepEqual(result.chessSlots.map(x => x.i), [0]);
  assert.deepEqual(result.itemSlots.map(x => x.i), [1]);
});
