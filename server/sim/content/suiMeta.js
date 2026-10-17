// server/sim/content/suiMeta.js — 岁·match 侧 garrison handler（休整期特质）。
// 红包的发放/里程碑在 match/factions.js（_suiSettle / _suiPrepPackets / _suiRoundStart）。
const H = {};

/**
 * 休整期特质（岁干员，SERVER_BATTLE_END → onBattleEnd）：
 *   dusk    夕：本干员在战场（部署过）或帮助队友协防（无需成功）→ 岁+16 术师+16；
 *           都不满足时吃回退档 bb.sui_no / bb.addon_no（夕 +8/+8，精锐 +16/+16）
 *   shu     黍：dispatch 到即视为「天有四时触发过」[SIMPLIFIED] → 岁+16 重装+16
 *   nian/ling 年/令：自身完美作战 或 帮助队友协防（无需成功，ev.helpedUnite）→ 岁+N、附加+N
 */
H.SUI_BATTLE_END = {
  onBattleEnd(ctx, ev) {
    const { bb, bbStr } = ctx.source;
    const variant = bbStr?.sui_rest;
    const helped = !!ev?.helpedUnite;
    const perfect = !!ev?.perfect;
    let ok;
    if (variant === 'shu') ok = true;
    else if (variant === 'dusk') ok = helped || ctx.source?.where === 'board';
    else ok = perfect || helped;
    if (!ok) {
      // 「若没有则各自+N」的回退档（夕）：没写回退键的（年/令/黍）维持原样不落层。
      const suiNo = Math.max(0, Math.trunc(num(bb.sui_no)));
      const addNo = Math.max(0, Math.trunc(num(bb.addon_no)));
      if (suiNo > 0) ctx.addLayers?.(bbStr?.sui_bond_id || 'suiShip', suiNo, { requireActive: true, reason: 'garrison:sui-rest' });
      if (addNo > 0 && bbStr?.addon_bond_id) ctx.addLayers?.(bbStr.addon_bond_id, addNo, { requireActive: true, reason: 'garrison:sui-rest' });
      return suiNo;
    }
    const suiN = Math.max(0, Math.trunc(num(bb.sui)));
    const addN = Math.max(0, Math.trunc(num(bb.addon)));
    if (suiN > 0) ctx.addLayers?.(bbStr?.sui_bond_id || 'suiShip', suiN, { requireActive: true, reason: 'garrison:sui-rest' });
    const addonId = bbStr?.addon_bond_id;
    if (addN > 0 && addonId) ctx.addLayers?.(addonId, addN, { requireActive: true, reason: 'garrison:sui-rest' });
    return suiN;
  },
};

function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : 0; }

export function registerMeta(registry) {
  for (const [key, handler] of Object.entries(H)) registry.garrison(key, handler);
}
export default { registerMeta };
