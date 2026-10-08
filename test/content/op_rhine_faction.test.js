// test/content/op_rhine_faction.test.js — the Rhine-faction "保留原版行为" operators after the Rhine rework releveled
// their chess pieces (sp_legacy 上线版既定阵营改造, 非 bug): 塞雷娅 saria → chess_char_5_11_a/_b (tier3/price3, vanilla t5),
// 白面鸮 ptilopsis → chess_char_4_21_a/_b (tier3, vanilla t4) with its hidden 补位 chess_char_5_16_a/_b (tier3, vanilla t5),
// 赫默 silence → chess_char_2_02_a/_b (tier2, 三档案一致), 缪尔赛思 muelsyse → chess_char_6_11_a/_b (tier6, 一致).
//
// The upstream t3/t4/t5 coverage walks chess_char_<tier>_ prefixes, so it never exercises these releveled pieces under
// the rhine profile. This suite fields them for real in rhine and pins: (a) their chess data carries the rework's tier/
// price; (b) kitOf resolves their DEDICATED kit (not the generic fallback); (c) skills fire and 缪尔赛思's 流形 copy works;
// (d) battle invariants hold. Their Rhine research trait (garrison_rhine_*) and the copy-chain contribution by 乌啾 are
// covered on the bonds/garrisons side (片B) — here we only exercise board combat / deployment / skills.
// Run: node --test test/content/op_rhine_faction.test.js   (rhine-only; skipped under vanilla)
import { rhineTest as test } from '../helpers/profile-test.mjs';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';
import { loadDataJson as load } from '../helpers/dataFile.mjs';
import { kitOf } from '../../server/sim/content/index.js';
import { KITS_RHINE } from '../../server/sim/content/kits/index.js';

const CHESS = load('chess');
const dummy = (o = {}) => enemyRec({ key: 'enemy_dummy', hp: 1e9, speed: 0, ...o });
const DEFS = { enemies: { enemy_dummy: dummy(), enemy_armored: dummy({ key: 'enemy_armored', def: 500 }) } };

/** The rework's tier/price for each releveled piece (a = normal, b = golden). */
const EXPECT = {
  chess_char_5_11_a: { charId: 'char_202_demkni', name: '塞雷娅', tier: 3, price: 3 },
  chess_char_5_11_b: { charId: 'char_202_demkni', name: '塞雷娅', tier: 3, price: 3 },
  chess_char_4_21_a: { charId: 'char_128_plosis', name: '白面鸮', tier: 3, price: 3 },
  chess_char_4_21_b: { charId: 'char_128_plosis', name: '白面鸮', tier: 3, price: 3 },
  chess_char_5_16_a: { charId: 'char_128_plosis', name: '白面鸮', tier: 3, price: 3, hidden: true },
  chess_char_5_16_b: { charId: 'char_128_plosis', name: '白面鸮', tier: 3, price: 3, hidden: true },
  chess_char_2_02_a: { charId: 'char_108_silent', name: '赫默', tier: 2, price: 3 },
  chess_char_2_02_b: { charId: 'char_108_silent', name: '赫默', tier: 2, price: 3 },
  chess_char_6_11_a: { charId: 'char_249_mlyss', name: '缪尔赛思', tier: 6, price: 4 },
  chess_char_6_11_b: { charId: 'char_249_mlyss', name: '缪尔赛思', tier: 6, price: 4 },
};

test('chess data: the Rhine rework relevels saria/ptilopsis(+补位)/silence/muelsyse exactly as expected', () => {
  for (const [id, e] of Object.entries(EXPECT)) {
    const ch = CHESS[id];
    assert.ok(ch, `${id} exists in rhine chess.json`);
    assert.equal(ch.charId, e.charId, `${id} charId`);
    assert.equal(ch.name, e.name, `${id} name`);
    assert.equal(ch.tier, e.tier, `${id} tier`);
    assert.equal(ch.price, e.price, `${id} price`);
    assert.equal(ch.isDiy, false, `${id} is not a DIY slot`);
    if (e.hidden) assert.equal(ch.visible, false, `${id} hidden 补位`);
  }
});

test('every releveled piece resolves its DEDICATED kit (not the generic fallback) under KITS_RHINE', () => {
  const units = Object.keys(EXPECT).filter((id) => id.endsWith('_a'))
    .map((id, i) => ({ uid: i + 1, chessId: id, row: 10, col: 2 + i }));
  const h = makeBattle({ defs: DEFS, units, timeLimit: 60, autoFinish: false, seed: 5, recordEvents: false });
  h.step();
  for (const id of Object.keys(EXPECT).filter((x) => x.endsWith('_a'))) {
    const u = h.unit(id);
    assert.ok(u && u.alive, `${id} deployed alive`);
    assert.equal(u.kind, 'op', `${id} is an operator`);
    assert.equal(typeof kitOf(u.def, KITS_RHINE), 'function', `${id} resolves a dedicated kit (not generic) — skill=${u.skill?.id}`);
  }
  h.invariants();
});

test('缪尔赛思 (t6) fields and her S3 流形 水迹复制体 copies a board operator', () => {
  const units = [
    { uid: 1, chessId: 'chess_char_6_11_a', row: 10, col: 4 },
    { uid: 2, chessId: 'chess_char_5_11_a', row: 10, col: 5 }, // saria as the copy source
  ];
  const h = makeBattle({ defs: DEFS, units, timeLimit: 120, autoFinish: false, seed: 9, recordEvents: false });
  h.step();
  const m = h.unit('chess_char_6_11_a');
  assert.ok(m && m.alive, 'muelsyse deployed');
  assert.equal(m.skill?.id ?? m.skill?.skillId, 'skchr_mlyss_3', 'muelsyse on S3 深溟流形');
  // Her S3 arms a 流形 next to her; let it resolve the copy of the nearest board operator.
  h.runUntil(() => h.b.allyUnits.some((x) => x.kind === 'token' && x.defId === 'token_10030_mlyss_wtrman' && x.alive
    && x.mem?.mlyss?.from != null), 60);
  const manifold = h.b.allyUnits.find((x) => x.kind === 'token' && x.defId === 'token_10030_mlyss_wtrman' && x.alive);
  assert.ok(manifold, 'the 流形 water-clone token is on the board');
  assert.ok(manifold.mem?.mlyss, 'the 流形 carries muelsyse copy state');
  h.invariants();
});

test('赫默 (t2) carries her 医疗探机 drone token; 塞雷娅/白面鸮 field with their real heal skills', () => {
  const units = [
    { uid: 1, chessId: 'chess_char_2_02_a', row: 10, col: 3 },
    { uid: 2, chessId: 'chess_char_5_11_a', row: 10, col: 4 },
    { uid: 3, chessId: 'chess_char_4_21_a', row: 10, col: 5 },
  ];
  const h = makeBattle({ defs: DEFS, units, timeLimit: 90, autoFinish: false, seed: 11, recordEvents: false });
  h.step();
  const silent = h.unit('chess_char_2_02_a');
  assert.ok(silent && silent.alive, 'silence deployed');
  assert.ok((CHESS['chess_char_2_02_a'].tokens ?? []).includes('token_10000_silent_healrb'),
    'silence carries the 医疗探机 drone token');
  const saria = h.unit('chess_char_5_11_a');
  assert.equal(saria.skill?.id ?? saria.skill?.skillId, 'skchr_demkni_2', 'saria on S2 药物配置');
  const plosis = h.unit('chess_char_4_21_a');
  assert.equal(plosis.skill?.id ?? plosis.skill?.skillId, 'skchr_plosis_2', 'plosis on S2 脑啡肽');
  // 白面鸮 技力光环: allies near her gain an SP/aspd aura buff once the talent installs.
  h.run(5);
  h.invariants();
});
