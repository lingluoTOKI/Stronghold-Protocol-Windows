// Preparation-side Rhine Lab traits (休整期). Battle-side effects live in rhine.js.
//
// 0.1.3-Rhine 重做后只剩三位「保持不变」的休整期特质：
//   赫默  (2 本) <进入休整期时>  莱茵 +4 / 远见 +2（精锐翻倍）
//   白面鸮 (3 本) <休整期结束时>  每名实际在场的莱茵干员使【莱茵生命】+2 层（精锐 +4）
//   溯光星源 (6 本) <休整期结束时> 每花费 3 资金 莱茵 +3 / 辅助 +3（精锐翻倍，用户 2026-10-12 改口径）
// 梅尔/星源/塞雷娅/麦哲伦/多萝西/伊芙利特的战斗侧特质在 rhine.js 里读取（IN_BATTLE）；梅尔的数值虽然写在
// 「休整期结束时」的文本里，实际生效点在战斗侧，故此处不注册处理器。
import { RHINE_BOND } from '../../../shared/rhineResearch.js';
import { SCOPE_MOD_CORE } from '../../../shared/bondScope.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : d));

export function registerMeta(registry) {
  registry.garrison('RHINE_RESEARCH_BY_MEMBER', {
    run(ctx) {
      if (!ctx.bondActive(RHINE_BOND)) return;
      let members = 0;
      for (const piece of ctx.board()) {
        if (piece.kind !== 'chess' || !ctx.pieceBonds(piece.uid).includes(RHINE_BOND)) continue;
        // Count actual deployed pieces, including same-name normal/elite copies. Harmony's
        // virtual bond count and reserve/token pieces never enter this roster.
        members++;
      }
      const layer = Number(ctx.source.bb?.layer) || 0;
      if (layer > 0) ctx.addLayers(RHINE_BOND, members * layer, { requireActive: true, reason: 'garrison:rhine-by-member' });
    },
  });

  // 赫默: <进入休整期时> 莱茵 +4 / 远见 +2 (精锐在 bb 里已翻倍).
  registry.garrison('RHINE_SILENCE_BOND_LAYER', {
    run(ctx) {
      const { bb, bbStr } = ctx.source;
      const rhine = num(bb.rhine);
      const visi = num(bb.visi);
      const rhineId = bbStr?.rhine_bond_id || RHINE_BOND;
      const visiId = bbStr?.visi_bond_id || 'visiShip';
      if (rhine > 0) ctx.addLayers(rhineId, rhine, { requireActive: true, reason: 'garrison:rhine-silence' });
      if (visi > 0) ctx.addLayers(visiId, visi, { requireActive: true, reason: 'garrison:rhine-silence' });
    },
  });

  // 溯光星源: <休整期结束时> 每花费 3 资金使 莱茵 +3 / 辅助 +3（精锐翻倍，用户 2026-10-12 改口径）.
  registry.garrison('RHINE_HALO2_COIN_LAYER', {
    run(ctx) {
      const { bb, bbStr } = ctx.source;
      const step = Math.max(1, num(bb.step, 3));
      const spent = ctx.roundStats().spent | 0;
      const times = Math.floor(spent / step);
      if (times <= 0) return;
      const rhine = times * num(bb.rhine);
      const other = times * num(bb.layer);
      const rhineId = bbStr?.rhine_bond_id || RHINE_BOND;
      if (rhine > 0) ctx.addLayers(rhineId, rhine, { requireActive: true, reason: 'garrison:rhine-halo2' });
      for (const b of String(bbStr?.bond_ids || '').split(',').map((s) => s.trim()).filter(Boolean)) {
        if (other > 0) ctx.addLayers(b, other, { requireActive: true, reason: 'garrison:rhine-halo2' });
      }
    },
  });

  // 晓歌（原寻澜特质，用户 2026-10-14 互换后并改成 4 阶）:
  //   "本干员在场后【核心盟约】每叠30层下回合获得1资金"
  // 口径（用户 2026-10-14 确认）：
  //   * **本干员必须在场**（休整期结束时部署在棋盘上）才结算 —— 不上场就不发钱；
  //   * 「所有契约模式核心盟约」（SCOPE_MOD_CORE 的 10 条，已激活的层数合计）每叠 `layers_per_fund` 层，
  //     下一回合额外获得 1 资金。「下一回合」＝ addPendingFunds（下一回合结算到账）；
  //   * 里程碑按合计层跨越计数，每档只发一次（counter 记账）。
  // 精锐不再有层数差（用户 2026-10-14：精锐也是 30 层）。
  registry.garrison('XUNLAN_CORE_LAYER_FUNDS', {
    run(ctx) {
      // 「本干员在场后」：不在棋盘上（备战席 / 未上场）就不结算
      const p = ctx.source && ctx.source.piece;
      const self = p && Number.isInteger(p.uid) && p.uid > 0 ? (ctx.piece(p.uid) || p) : p;
      if (!self || self.kind !== 'chess') return;
      if (!(self.area === 'board' && Number.isInteger(self.row))) return;

      const { bb } = ctx.source;
      const per = Math.max(1, num(bb?.layers_per_fund, 30));
      let sum = 0;
      for (const id of SCOPE_MOD_CORE) {
        if (!ctx.bondActive(id)) continue;
        sum += ctx.layers(id) | 0;
      }
      const due = Math.floor(sum / per);
      const paid = ctx.counter('xunlan:paid') | 0;
      if (due > paid) {
        ctx.setCounter('xunlan:paid', due);
        ctx.addPendingFunds(due - paid);
      }
    },
  });
}
