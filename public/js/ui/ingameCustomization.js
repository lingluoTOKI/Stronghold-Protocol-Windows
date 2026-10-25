// Main-server customization uses its native charId skin store, never alliance chessId skin maps.
import { useState } from '../../vendor/hooks.module.js';
import { html, Button } from './components.js';
import { useStore } from '../store.js';
import { data } from '../data.js';
import { chessOptions, MODULE_NONE } from './loadoutModel.js';
import { skinsStore, availableSkins, chosenSkin, setSkin, clearSkin } from './skins.js';
import { actions } from './gameActions.js';
import { t } from '../../../shared/i18n.js';

export function IngameCustomization({ chess, loadout, canLoadout = false, canSkin = false }) {
  useStore(v => v, Object.is, skinsStore);
  const [busy, setBusy] = useState(false);
  const base = chess.isGolden ? data.lookup('chess', chess.baseId) : chess;
  if (!base || (!canLoadout && !canSkin)) return null;
  const options = chessOptions(base, chess.isGolden ? chess : null);
  const currentSkill = loadout?.skillIndex ?? options.defaultSkill;
  const currentModule = loadout?.module?.id ?? MODULE_NONE;
  const pick = async (skill, module = currentModule) => {
    if (!canLoadout || busy) return;
    setBusy(true);
    try { await actions.loadout({ [base.chessId]: { skill, ...(chess.isGolden ? { module } : {}) } }); }
    finally { setBusy(false); }
  };
  const skins = canSkin ? availableSkins(chess.charId).filter(s => s.own || s.playable) : [];
  const selected = chosenSkin(chess.charId);
  return html`<section class="dsec ingame-customization">
    ${canLoadout && options.skillOptions.length > 1 ? html`<h4>${t('技能')}</h4><div class="ingame-picks">${options.skillOptions.map(s => html`<${Button} size="sm" disabled=${busy} variant=${s.index === currentSkill ? 'primary' : 'ghost'} onClick=${() => pick(s.index)}>${s.elite?.name || s.normal?.name || `S${s.index + 1}`}<//>`)}</div>` : null}
    ${canLoadout && chess.isGolden && options.moduleOptions.length > 1 ? html`<h4>${t('模组')}</h4><div class="ingame-picks">${options.moduleOptions.map(m => html`<${Button} size="sm" disabled=${busy} variant=${m.id === currentModule ? 'primary' : 'ghost'} onClick=${() => pick(currentSkill, m.id)}>${m.id === MODULE_NONE ? t('不装备模组') : m.rec?.name || m.id}<//>`)}</div>` : null}
    ${skins.length ? html`<h4>${t('时装')}</h4><div class="ingame-picks">${skins.map(s => html`<${Button} size="sm" variant=${(s.own ? !selected : s.id === selected) ? 'primary' : 'ghost'} onClick=${() => s.own ? clearSkin(chess.charId) : setSkin(chess.charId, s.id)}>${s.own ? t('默认') : s.name}<//>`)}</div>` : null}
  </section>`;
}
