// Official bond-description markup (shared by every core bond this fork ships or adds).
//
// data/*.json carries each description twice: `descRaw` in the client's own rich text and `desc` as plain text.
// The rich text is what public/js/ui/richText.js parses — the style ids map to css classes
// (css/screens/game-panels.css):
//    <@ba.vup>…</>           → .rt-vup    blue #3fb6ff  — the highlight the official client gives a 加成 value
//    <@autochess.gray>…</>   → .rt-note   muted         — "受层数影响" and the other qualifiers
//    <@autochess.dgreen>…</> → .rt-mint   mint green    — the member count inside a threshold tag
//    <@ba.acrem>…</>         → .rt-note   muted note    — a rules remark in parentheses
// A 阈值 head like `<在场6名不同【炎】干员>` is NOT a tag: richText keeps its angle brackets verbatim and only
// the number inside is styled — `thresholdLine()` builds exactly that shape.
//
// So every core bond here reads like the official ones (data/bonds.json `yanShip`): a headline line, then one
// `<在场N名不同【X】干员>` line per threshold.

/** Blue highlight of a 加成 value / keyword. */
export const up = (s) => `<@ba.vup>${s}</>`;
/** Muted qualifier ("受层数影响"). */
export const gray = (s) => `<@autochess.gray>${s}</>`;
/** Mint green number inside a threshold head. */
export const dgreen = (s) => `<@autochess.dgreen>${s}</>`;
/** Muted remark. */
export const acr = (s) => `<@ba.acrem>${s}</>`;

/**
 * One threshold line: `<在场<@autochess.dgreen>N</>名不同【NAME】干员>text`.
 * @param {number|string} count member count of the tier
 * @param {string} bondName the bond's display name without brackets, e.g. '炎'
 * @param {string} text what that tier does
 */
export const thresholdLine = (count, bondName, text) =>
  `<在场${dgreen(count)}名不同【${bondName}】干员>${text}`;

/**
 * `descRaw` → the plain `desc` every record carries alongside it: only the official style tags are dropped, so
 * a threshold head keeps its shape as literal text (`<在场6名不同【炎】干员>`).
 */
export const stripMarkup = (s) => String(s ?? '').replace(/<[@$][A-Za-z0-9_.\-]{1,48}>/g, '').replace(/<\/>/g, '');

/** The `{ desc, descRaw }` pair a bond record stores. */
export const bondDesc = (raw) => ({ desc: stripMarkup(raw), descRaw: raw });

/**
 * The official flag for a trait / garrison line: only the **加成 value** is highlighted — a number written with
 * its `+` sign and its unit (`+1%`, `+12`, `+0.3/秒`) — while the condition counters stay plain
 * (`【拉特兰】每叠加5层，本干员攻击速度<@ba.vup>+1</>`, data/garrisons.json garrison_16_a).
 * Applied to a plain description to get its `descRaw`; `desc` keeps the untouched plain text.
 *
 * @param {string} desc plain trait text
 * @returns {string} the same text with every `+N[%/秒]` span wrapped in `<@ba.vup>…</>`
 */
export function markBonus(desc) {
  const s = String(desc ?? '');
  if (!s) return s;
  // already tagged ⇒ leave it alone (a description that carries hand-written markup wins)
  if (/<[@$]/.test(s)) return s;
  // 1) a value written with its sign: 攻击力+10% / 层数+2 / 技力回复+0.3/秒
  let out = s.replace(/\+\d+(?:\.\d+)?(?:%|\/秒)?/g, (m) => `<@ba.vup>${m}</>`);
  // 2) a value a verb introduces: 增加2层 / 提高1% / 至多10层 — the official caps are highlighted the same way
  //    (「每场作战至多<@ba.vup>10</>层」, data/garrisons.json garrison_90_a). Condition counters such as
  //    「每叠加3层」 stay plain, exactly as the shipped records have them.
  out = out.replace(/(?<=增加|提高|提升|额外|至多|最多|降低|减少)\d+(?:\.\d+)?(?:%|层|点|秒|\/秒|资金|格|名|次|倍)?/g,
    (m) => `<@ba.vup>${m}</>`);
  return out;
}

/** Trigger phrases the expansion traits open with, longest first. */
const TRIGGER_RES = [
  '获得干员时', '进入休整期时', '休整期开始时', '休整期结束时', '进入战斗时', '战斗开始时',
  '战斗结束时', '战斗中', '部署时', '获得时', '售出时', '卖出时', '合并时', '刷新时', '回合开始时',
].map((t) => new RegExp(t, 'g'));

/**
 * Official trait phrasing: every trigger opens with a `<触发短语>` span (「<休整期结束时>…」), and
 * 卖出时 is spelled 售出时. Idempotent: existing wraps are unwrapped first, and the spans never nest
 * inside `<@ba.vup>` number tags (trigger words and numbers never overlap).
 *
 * @param {string} s description text (plain or already number-tagged)
 */
export function wrapTrigger(s) {
  let out = String(s ?? '');
  if (!out) return out;
  out = out.replace(/<(获得干员时|进入休整期时|休整期开始时|休整期结束时|进入战斗时|战斗开始时|战斗结束时|战斗中|部署时|获得时|售出时|卖出时|合并时|刷新时|回合开始时)>\s*，/g, '<$1>');
  out = out.replace(/<(获得干员时|进入休整期时|休整期开始时|休整期结束时|进入战斗时|战斗开始时|战斗结束时|战斗中|部署时|获得时|售出时|卖出时|合并时|刷新时|回合开始时)>/g, '$1');
  out = out.replace(/卖出时/g, '售出时');
  for (const re of TRIGGER_RES) {
    out = out.replace(re, (m) => `<${m === '卖出时' ? '售出时' : m}>`);
  }
  return out;
}

/** The `{ desc, descRaw }` pair of a trait / garrison line (plain + official-highlighted). */
export const traitDesc = (desc) => ({ desc, descRaw: markBonus(desc) });

/**
 * Join description lines: a real newline, like the official multi-line descriptions.
 * @param {...string} lines
 */
export const lines = (...parts) => parts.filter((p) => p != null && p !== '').join('\n');
