// 「契约选择」开关的本地镜像（用户 2026-10-16）—— 与 shared/bondScope.js 的 scope **不是一回事**。
//
//   开启：局内 2/8/12 回合抽契约（个人牌桌），大厅显示「模式选择」（盟约 / 契约 两档可切）
//   关闭：**仍是契约模式**（干员池 / 装备池 / 盟约全部不变），只是局内不抽契约，
//         且大厅的「模式选择」整块隐藏 —— 没有档位要切，就不该摆在那儿
//
// 服务端的权威值是 room.contractDraft（server/lobby.js setContractDraft，只有房主能改，开局后冻结）。
// 这里存 localStorage 是为了让大厅在建房前就知道要不要显示「模式选择」；房间里的开关会同时写这里，
// 所以在房间里关掉后返回大厅，界面也跟着收起来。

import { createStore, useStore, loadPref, savePref } from '../store.js';

const read = () => loadPref('contractDraft', true) !== false;

export const contractDraftStore = createStore({ on: read() });

/** Preact hook：局内会不会抽契约。 */
export const useContractDraft = () => useStore((s) => s.on, Object.is, contractDraftStore);

/** 大厅要不要显示「模式选择」：关掉契约选择后没有档位可切，整块隐藏。 */
export function modeEntryVisible() {
  return contractDraftStore.get().on;
}

/** 切换并记住。@param {boolean} on */
export function setContractDraft(on) {
  const v = on !== false;
  savePref('contractDraft', v);
  contractDraftStore.set({ on: v });
  return v;
}