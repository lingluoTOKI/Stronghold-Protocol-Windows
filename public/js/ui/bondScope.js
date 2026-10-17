// 显示范围开关：盟约（官方）/ 契约（本 fork 新增）—— 盟约与策略总览 (screens/alliances.js) 与 装备总览
// (screens/equipment.js) 共用；状态存 localStorage `sp.pref.allianceScope`，默认「契约」（只看新增）。
//
// 左端「盟约」= 官方盟约（炎 / 维多利亚 / 拉特兰 …）；右端「契约」= 本作新增的 8 个核心盟约 + 后来加的职业附加盟约。
// 协防干员 / 调和 / 绝技 两档都保留。

import { html } from './components.js';
import { createStore, useStore, loadPref, savePref } from '../store.js';
import { t } from '../../../shared/i18n.js';
import { normalizeScope, inBondScope, bondIdInScope, scopedChess } from '../../../shared/bondScope.js';
import { effectiveBonds } from '../../../shared/profBonds.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

// 名单与判定在 shared/bondScope.js（服务端对局池用同一份）
export { SCOPE_KEEP, SCOPE_MOD_CORE, SCOPE_MOD_ADD, SCOPE_OFFICIAL_CORE, bondScopeOf, inBondScope, bondIdInScope, operatorInScope, itemInScope, scopedChess } from '../../../shared/bondScope.js';

/**
 * 一名干员在当前档位下显示的盟约：盟约档用回底包的 traits / 驻防（shared/bondScope.js scopedChess），
 * 职业附加盟约按同一个 profession 归属规则补上，最后只留属于这一档的。
 * @param {any} rec chess 记录 @param {'mod'|'official'} scope
 */
export function bondsInScope(rec, scope) {
  return effectiveBonds(scopedChess(rec, scope)).filter((b) => inBondScope(b, scope));
}

const readScope = () => normalizeScope(loadPref('allianceScope', 'mod'));

/** 当前档位的小 store（两个总览界面共用，改一处两边同步）。 */
export const bondScopeStore = createStore({ scope: readScope() });

/** Preact hook: 当前档位（'mod' 契约 | 'official' 盟约）。 */
export const useBondScope = () => useStore((s) => s.scope, Object.is, bondScopeStore);

/** 切换并记住档位。@param {'mod'|'official'} scope */
export function setBondScope(scope) {
  const v = normalizeScope(scope);
  savePref('allianceScope', v);
  bondScopeStore.set({ scope: v });
  return v;
}

/**
 * 两段式范围开关（与 盟约 / 策略 页签同款高亮）：左端「盟约」= 官方，右端「契约」= 本作新增。
 */
export function ScopeSwitch() {
  const scope = useBondScope();
  const mod = scope !== 'official';
  const seg = (isMod, label, title) => html`<button type="button"
    class=${cx('lo-chip', 'al-scope__seg', (mod === isMod) && 'is-on')} role="radio" aria-checked=${mod === isMod ? 'true' : 'false'}
    title=${title} onClick=${() => setBondScope(isMod ? 'mod' : 'official')}>${t(label)}</button>`;
  return html`<div class="lo-chips al-scope" role="radiogroup" aria-label=${t('显示范围')}>
    <span class="al-scope__k">${t('范围')}</span>
    ${seg(false, '盟约', t('官方盟约：炎、维多利亚、拉特兰 …'))}
    ${seg(true, '契约', t('本作新增盟约：彩虹小队、莱茵生命、罗德岛、巴别塔、岁、龙门、企鹅物流、乌萨斯学生团 …'))}
  </div>`;
}
