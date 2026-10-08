// Rhine research battle traits (server/sim/content/rhine.js) — proves the three "no garrison installer" effectKeys are
// implemented in the research/device layer, not missing installers. The garrison records (RHINE_IFRIT_INHERITANCE,
// RHINE_MAYER_RESEARCH, RHINE_SARIA_HEALING in data/garrisons.json) carry the UI text; the live battle numbers are set
// by rhine.js's refresh loop:
//   • ifrit inherits 80% (normal) / 100% (elite) of the SUM of on-board research-device base ATK
//       deviceBaseAttack = rhineAttack(layers) = baseAttack(300) + layers*attackPerLayer(3) [+ mayer bonus]
//   • saria healingDealtMul = 1 + floor(layers / sariaLayerStep(3)) * sariaHealBonus(0.01 / 0.02)
//   • mayer standing in front of a device adds mayerAttack [2,4] per mayerLayerStep(5) layers to that device's ATK.
// sp_legacy/server/sim/content/rhine.js is line-identical for this loop (verified 2026-10-08).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle } from '../helpers/battleHarness.js';
import { DATA_PROFILE } from '../helpers/dataFile.mjs';
import { RHINE_BALANCE as B } from '../../shared/rhineResearch.js';

const rhineOnly = DATA_PROFILE === 'rhine';
const approx = (a, b, msg = '') => assert.ok(Math.abs(a - b) < 1e-6, `${msg} ${a} ≈ ${b}`);

/** Battle with rhineShip active at `layers`, a medical device on board, and the given ops. */
function researchBattle(layers, ops) {
  const units = [
    ...ops.map((o, i) => ({ uid: o.uid ?? i + 1, kind: 'chess', chessId: o.id, row: o.row, col: o.col })),
    { uid: 99, kind: 'token', tokenId: 'token_rhine_medical', row: 11, col: 5 },
  ];
  return makeBattle({
    units,
    players: [{
      playerId: 'p1', seat: 0, side: 'L', colOffset: 0, units,
      bonds: { rhineShip: { count: 3, active: true, tier: 1, layers } },
      research: { active: true, devices: [{ key: 'medical', tokenId: 'token_rhine_medical', uid: 99, onBoard: true, stage: 0 }] },
    }],
    enemies: [], timeLimit: 5, seed: 1,
  });
}
const buff = (u, key) => u.buffs.find((b) => b.key === key);

test('RHINE_IFRIT_INHERITANCE: 伊芙利特 inherits 80% of the summed research-device ATK (layers=12)', { skip: !rhineOnly }, () => {
  const h = researchBattle(12, [{ id: 'chess_rhine_ifrit_a', row: 10, col: 4 }]);
  h.step(1);
  const ifrit = h.b.allyUnits.find((u) => u.defId === 'chess_rhine_ifrit_a');
  const d = buff(ifrit, 'rhine:ifrit');
  assert.ok(d, 'the rhine:ifrit passive is installed');
  const deviceAtk = B.baseAttack + 12 * B.attackPerLayer;            // 300 + 36 = 336
  approx(d.mods.atkFlat, deviceAtk * B.ifritInheritance[0], `normal ifrit inherits 80% of ${deviceAtk}`);
  approx(d.mods.atkFlat, 268.8, '336 × 0.8 = 268.8');
});

test('RHINE_SARIA_HEALING: 塞雷娅 healingDealtMul grows +1% per 3 research layers (layers=12 → ×1.04)', { skip: !rhineOnly }, () => {
  const h = researchBattle(12, [{ id: 'chess_char_5_11_a', row: 10, col: 4 }]);
  h.step(1);
  const saria = h.b.allyUnits.find((u) => u.defId === 'chess_char_5_11_a');
  const d = buff(saria, 'rhine:saria');
  assert.ok(d, 'the rhine:saria passive is installed');
  const expect = 1 + Math.floor(12 / B.sariaLayerStep) * B.sariaHealBonus[0];  // 1 + 4×0.01 = 1.04
  approx(d.mods.healingDealtMul, expect, `normal saria: 1 + floor(12/3)×0.01`);
  approx(d.mods.healingDealtMul, 1.04);
});

test('RHINE_MAYER_RESEARCH: a device gains +2 ATK per 5 research layers when 梅尔 stands in front (layers=12 → +4)', { skip: !rhineOnly }, () => {
  // device at (11,5); mayer facing right at (11,4) → her front tile is (11,5)
  const h = makeBattle({
    units: [
      { uid: 1, kind: 'chess', chessId: 'chess_rhine_mayer_a', row: 11, col: 4 },
      { uid: 99, kind: 'token', tokenId: 'token_rhine_medical', row: 11, col: 5 },
    ],
    players: [{
      playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
      units: [
        { uid: 1, kind: 'chess', chessId: 'chess_rhine_mayer_a', row: 11, col: 4 },
        { uid: 99, kind: 'token', tokenId: 'token_rhine_medical', row: 11, col: 5 },
      ],
      bonds: { rhineShip: { count: 3, active: true, tier: 1, layers: 12 } },
      research: { active: true, devices: [{ key: 'medical', tokenId: 'token_rhine_medical', uid: 99, onBoard: true, stage: 0 }] },
    }],
    enemies: [], timeLimit: 5, seed: 1,
  });
  h.step(1);
  const device = h.b.allyUnits.find((u) => u.defId === 'token_rhine_medical');
  const baseNoMayer = B.baseAttack + 12 * B.attackPerLayer;          // 336
  const mayerBonus = Math.floor(12 / B.mayerLayerStep) * B.mayerAttack[0];  // floor(12/5)×2 = 4
  approx(device.s.atk, baseNoMayer + mayerBonus, `device ATK = ${baseNoMayer} + mayer front ${mayerBonus}`);
  approx(device.s.atk, 340, '336 + 4 = 340');
});
