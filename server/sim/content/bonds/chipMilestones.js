// 盟约芯片 milestone hook（4 阶 盟约芯片组发放）。
//
// 玩家每有一盟约首次叠层达到 layerMilestones 中的 `layer`（mode: 'first' + `itemId`），发放一次对应装备（不可重复，
// 跨局也靠 counter 标记）。bond 自身不直接负责派发：现有 victoria/rodos 的 layerMilestones 在 core.js / factions.js
// 单独写 handler，这个 hook 把 chip 这一组独立管起来，避免和它们打架。
//
// 与巴别塔的 onLayers 派发 (`babelGlobal.onLayers`) 一样：addLayers / settle / factions 三条加层路径都会 dispatch 它，
// 「伊内丝 回合结束特质」等间接加层也会触发。幂等由 `chip:claimed:<bondId>:<layer>` 计数器保证（match 间持久化）。

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : d));

/**
 * @param {string} bondId
 * @returns {Array<object>} the bond's milestone list (data-driven: data/bonds.json `layerMilestones`)
 */
function milestonesOf(battle, bondId) {
  const meta = battle.gd && typeof battle.gd.bond === 'function' ? battle.gd.bond(bondId) : null;
  if (!meta) return [];
  const ms = meta.layerMilestones;
  return Array.isArray(ms) ? ms.filter((x) => x && typeof x === 'object' && x.layer > 0 && x.mode === 'first' && typeof x.itemId === 'string') : [];
}

/**
 * Pay out the chip-set milestones of `bondId` whose threshold the current `bond` total has reached but the player has not
 * yet been credited. Each milestone fires at most once per match (counter key `chip:claimed:<bondId>:<layer>`).
 */
function payChipMilestones(ctx, bondId) {
  const total = ctx.layers(bondId);
  if (!(total > 0)) return 0;
  const ms = milestonesOf(ctx, bondId);
  if (!ms.length) return 0;
  let paid = 0;
  for (const m of ms) {
    const layer = num(m.layer, 0);
    if (!(layer > 0)) continue;
    if (total < layer) continue;
    const stamp = `chip:claimed:${bondId}:${layer}`;
    if ((ctx.counter(stamp) || 0) > 0) continue;
    const cnt = Math.max(1, num(m.count, 1));
    try {
      const got = ctx.grantItem?.(m.itemId, { source: `bond:${bondId}`, requirePool: false });
      if (got != null) {
        ctx.setCounter(stamp, 1);
        paid++;
        if (typeof ctx.toast === 'function') {
          const name = (ctx.gd && ctx.gd.item(m.itemId)?.name) || m.itemId;
          ctx.toast('info', `【${ctx.gd.bond(bondId)?.name || bondId}】达到 ${layer} 层：获得 ${name}`);
        }
      } else {
        // 发放失败（库存/状态）也标记，否则会每层 onLayers 都尝试重发 ——
        // 库存可恢复（休整期手动派送）时不阻断后续加层，仍能正常记账。
        ctx.setCounter(stamp, 1);
      }
    } catch {
      ctx.setCounter(stamp, 1);
    }
    // 多份（cnt > 1）目前用不到；保留接口。
    for (let k = 1; k < cnt; k++) {
      try { ctx.grantItem?.(m.itemId, { source: `bond:${bondId}`, requirePool: false }); } catch { /* ignore */ }
    }
  }
  return paid;
}

/** Global hook: any bond layer gain pays out the chip milestones. */
const bondChipMilestones = {
  onLayers(ctx, ev) {
    if (!ev || !ev.bondId) return;
    // 与 babelGlobal.onLayers 一致：未激活盟约加层不发奖（参考 server/sim/content/babelMeta.js babelGlobal）
    if (typeof ctx.bondActive === 'function' && !ctx.bondActive(ev.bondId)) return;
    payChipMilestones(ctx, ev.bondId);
  },
  /**
   * 也接 onPrepStart —— 伊内丝 回合结束加层与加层路径都 dispatch onLayers，理论上足够；
   * 但休整期开服时再过一遍能补救「全局登记比加层晚一帧」的边界（_deferItemMerge 等让加层先排队再兑现），
   * 以及在整局开始发放旧数据遗留（系统层 catch-up，与 babelGlobal 的 catch-up 同一手法）。
   */
  onPrepStart(ctx) {
    // 遍历玩家已激活盟约（ctx.bondActive）
    const ids = Array.isArray(ctx.gd?.bondIds) ? ctx.gd.bondIds : [];
    for (const bid of ids) if (ctx.bondActive(bid)) payChipMilestones(ctx, bid);
  },
};

export function registerChipMilestones(registry) {
  if (!registry || typeof registry.global !== 'function') return;
  registry.global('bond_chip_milestones', bondChipMilestones);
}

export default { registerChipMilestones, payChipMilestones };