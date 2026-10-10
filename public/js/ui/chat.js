// 房间文字聊天（纯客户端新增 · 与官方表情轮盘 EmoteWheel【并存】，不顶替 g.emote 直发）——文字 + 表情混发（[emoji:<id>] 标记）。
//
// 设计（规格C）：左下角一个独立「聊天」按钮（与官方「交流」表情轮盘并列），点开一个可自由拖拽 / 改尺寸的聊天面板。
//      标题栏按住拖动整个面板（双击复位位置），右下角手柄拖改尺寸（双击复位尺寸）；位置 / 尺寸记在 localStorage。
//
// - 数据来自 store.chat（main.js 在 net.on('m.chat') 填充，保留最近若干条）。
// - 发送走 actions.chat(text) → g.chat{text}；服务端冷却 CHAT_COOLDOWN_MS=1s（shared 契约冻结），客户端发送后同样禁用 1s 防连发。
// - 表情图片复用官方 emotes.js 的 emoteArtUrl(id) 与 shared/constants.js 的 EMOTE_THEMES（美术 0.2.3 自带，不新增 data/emotes）。
// - 消息文本用节点数组渲染（preact 的 ${} 插值自动转义，避免聊天内容注入 HTML / XSS）。
// - 样式动态注入（与 emotes.css 的 ensureEmoteCss 同思路），无需改 html 链接。

import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { GIcon } from './gameComponents.js';
import { useStore } from '../store.js';
import { EMOTE_THEMES, CHAT_MAX_LEN, CHAT_COOLDOWN_MS } from '../../../shared/constants.js';
import { emoteArtUrl } from './emotes.js';
import { actions } from './gameActions.js';

const STYLE_ID = 'sp-chat-dock-style';
const EMOJI_RE = /\[emoji:([A-Za-z0-9_\-:.]+)\]/g;
const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** 动态注入聊天组件的样式（幂等）。 */
export function ensureChatCss(doc = globalThis.document) {
  if (!doc || doc.getElementById(STYLE_ID)) return false;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = [
    /* 触发按钮外观直接沿用官方 .ewheel__btn（在 game.css / emotes.css 中），这里只补定位与未读点；
       与左下角「交流」按钮合并，玩家无感知，不再与官方表情轮盘并列 */
    '.chat-dock{position:relative;display:flex;align-items:flex-end;}',
    '.chat-dock__btn{position:relative;}',
    '.chat-dock__badge{position:absolute;top:-.05rem;right:-.05rem;min-width:.18rem;height:.18rem;padding:0 .04rem;background:var(--danger,#ff5d5d);color:#fff;font-family:var(--font-mono,ui-monospace,monospace);font-size:max(.11rem,9px);font-weight:700;line-height:1.15;text-align:center;box-shadow:0 0 0 2px rgba(6,9,7,.92);}',
    /* 弹出面板：深底 / 细边 / pop-in，顶部一条终端光条 */
    '.chat-dock__panel{position:absolute;bottom:calc(100% + .12rem);left:0;width:min(3.7rem,86vw);max-width:94vw;max-height:82vh;z-index:950;display:flex;flex-direction:column;overflow:hidden;color:var(--text-md,#c3cbc7);font-family:var(--font-mono,ui-monospace,Menlo,Consolas,monospace);font-size:max(.14rem,12px);background:linear-gradient(180deg,rgba(20,26,24,.98),rgba(9,13,11,.98));border:1px solid var(--line-2,#3e4b45);box-shadow:0 .1rem .3rem rgba(0,0,0,.65),inset 0 0 .001rem rgba(89,244,202,.08);animation:pop-in var(--t-med,200ms) var(--ease-out,cubic-bezier(.2,.8,.2,1));}',
    '.chat-dock__panel::before{content:"";position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--mint-500,#4ed8af),rgba(78,216,175,.18) 55%,transparent);pointer-events:none;}',
    /* 标题栏：COMMS 小标签 + 中文标题 + 切角关闭方钮（按住可拖动整个面板） */
    '.chat-dock__head{display:flex;align-items:center;gap:.1rem;padding:.1rem .12rem;border-bottom:1px solid var(--line,rgba(78,216,175,.13));user-select:none;}',
    '.chat-dock__head--drag{cursor:grab;}',
    '.chat-dock__head--drag:active{cursor:grabbing;}',
    '.chat-dock__panel.is-moved{position:fixed;z-index:960;margin:0;bottom:auto;left:auto;}',
    '.chat-dock__tag{font-family:var(--font-mono,ui-monospace,monospace);font-size:max(.1rem,9px);font-weight:700;letter-spacing:.2em;color:var(--mint-500,#4ed8af);opacity:.85;}',
    '.chat-dock__title{flex:1;font-family:var(--font-mono,ui-monospace,monospace);font-size:max(.15rem,12px);font-weight:700;letter-spacing:.16em;color:var(--text-hi,#f2f2f2);}',
    '.chat-dock__close{width:.34rem;min-width:26px;height:.34rem;min-height:26px;display:grid;place-items:center;background:rgba(8,11,10,.85);border:1px solid var(--line-2,#3e4b45);color:var(--text-lo,#8a948f);font-size:max(.14rem,12px);line-height:1;cursor:pointer;padding:0;transition:color .15s,border-color .15s,background .15s;}',
    '.chat-dock__close:hover{color:var(--mint-400,#59f4ca);border-color:var(--mint-700,#2a9e7f);background:var(--mint-a10,rgba(78,216,175,.1));}',
    /* 消息列表：终端日志风（左对齐、等宽、名字翡翠绿、左侧细线） */
    '.chat-dock__body{overflow-y:auto;flex:1 1 auto;min-height:1.1rem;max-height:34vh;padding:.1rem .12rem;display:flex;flex-direction:column;gap:.05rem;}',
    /* 用户拖拽过尺寸后：消息区填满面板剩余高度（不再受 34vh 限制） */
    '.chat-dock__panel.is-sized .chat-dock__body{max-height:none;min-height:0;}',
    /* 右下角拖拽手柄（落在消息区右下，避开输入行）：翡翠绿小三角，触摸可拖，双击复位 */
    '.chat-dock__resize{position:absolute;right:0;bottom:.74rem;width:.32rem;min-width:26px;height:.32rem;min-height:26px;z-index:5;cursor:nwse-resize;touch-action:none;}',
    '.chat-dock__resize::before{content:"";position:absolute;right:.04rem;bottom:.04rem;width:.17rem;min-width:14px;height:.17rem;min-height:14px;border-right:2px solid var(--mint-500,#4ed8af);border-bottom:2px solid var(--mint-500,#4ed8af);opacity:.55;transition:opacity .15s,border-color .15s;}',
    '.chat-dock__resize:hover::before{opacity:1;border-color:var(--mint-400,#59f4ca);}',
    '.chat-dock__empty{color:var(--text-dim,#5d6863);text-align:center;padding:.16rem 0;font-size:max(.12rem,10px);letter-spacing:.08em;}',
    '.chat-item{display:flex;align-items:baseline;gap:.06rem;line-height:1.45;padding:.03rem .08rem;border-left:2px solid var(--line,rgba(78,216,175,.13));word-break:break-word;}',
    '.chat-item:hover{background:rgba(78,216,175,.06);}',
    '.chat-item__who{flex:none;max-width:1.5rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--mint-400,#59f4ca);font-weight:700;letter-spacing:.06em;}',
    '.chat-item__sep{flex:none;color:var(--mint-700,#2a9e7f);}',
    '.chat-item__text{color:var(--text-hi,#f2f2f2);min-width:0;}',
    '.chat-emoji-img{height:max(.2rem,18px);vertical-align:middle;margin:0 .01rem;filter:drop-shadow(0 0 .05rem rgba(89,244,202,.25));}',
    /* 表情选择网格：淡底 / 细边 / 翡翠绿 hover */
    '.chat-dock__faces{border-top:1px solid var(--line,rgba(78,216,175,.13));background:rgba(8,12,10,.9);padding:.1rem;display:grid;grid-template-columns:repeat(6,1fr);gap:.07rem;max-height:2.1rem;overflow-y:auto;}',
    '.chat-dock__face{background:rgba(255,255,255,.025);border:1px solid var(--line,rgba(78,216,175,.13));padding:.05rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s,border-color .15s,transform .15s;}',
    '.chat-dock__face:hover{background:var(--mint-a10,rgba(78,216,175,.1));border-color:var(--mint-700,#2a9e7f);transform:translateY(-.02rem);}',
    '.chat-dock__face img{width:100%;max-width:.34rem;height:auto;filter:drop-shadow(0 0 .05rem rgba(89,244,202,.25));}',
    /* 输入行：切角方钮 + 终端输入框 + 翡翠绿描边发送钮（无圆角、无蓝底） */
    '.chat-dock__input{display:flex;gap:.08rem;padding:.1rem .12rem .12rem;border-top:1px solid var(--line,rgba(78,216,175,.13));align-items:center;}',
    '.chat-dock__emoji{width:.5rem;min-width:34px;height:.5rem;min-height:34px;flex-shrink:0;display:grid;place-items:center;background:rgba(8,11,10,.85);border:1px solid var(--line-2,#3e4b45);color:var(--mint-500,#4ed8af);cursor:pointer;transition:.15s;}',
    '.chat-dock__emoji .icon{width:.28rem;height:.28rem;}',
    '.chat-dock__emoji.is-on{border-color:var(--mint-700,#2a9e7f);background:var(--mint-a10,rgba(78,216,175,.1));color:var(--mint-400,#59f4ca);}',
    '.chat-dock__field{flex:1;min-width:0;height:.5rem;min-height:34px;padding:0 .12rem;background:#070b09;border:1px solid var(--line-2,#3e4b45);color:var(--text-hi,#f2f2f2);font-family:var(--font-mono,ui-monospace,Menlo,Consolas,monospace);font-size:16px;letter-spacing:.04em;transition:border-color .15s,box-shadow .15s;}',
    '.chat-dock__field::placeholder{color:var(--text-dim,#5d6863);letter-spacing:.06em;}',
    '.chat-dock__field:focus{outline:none;border-color:var(--mint-700,#2a9e7f);box-shadow:0 0 0 1px rgba(89,244,202,.18),0 0 .12rem rgba(78,216,175,.18);}',
    '.chat-dock__send{height:.5rem;min-height:34px;padding:0 .2rem;flex-shrink:0;background:linear-gradient(180deg,rgba(78,216,175,.16),rgba(78,216,175,.05));border:1px solid var(--mint-500,#4ed8af);color:var(--mint-400,#59f4ca);font-family:var(--font-mono,ui-monospace,monospace);font-weight:700;letter-spacing:.18em;font-size:max(.15rem,12px);cursor:pointer;transition:.15s;}',
    '.chat-dock__send:hover:not(:disabled){background:var(--mint-500,#4ed8af);color:#06120d;box-shadow:0 0 .16rem rgba(78,216,175,.45);}',
    '.chat-dock__send:disabled{opacity:.45;cursor:not-allowed;}',
    /* 手机：面板近全宽，输入字号 16px 防 iOS 聚焦缩放；高度留出键盘空间 */
    '@media (max-width:640px){.chat-dock__panel{width:calc(100vw - .48rem);max-height:62vh;}.chat-dock__body{max-height:30vh;}.chat-dock__field{font-size:16px;}}',
  ].join('\n');
  doc.head.appendChild(style);
  return true;
}

/**
 * 把一条聊天文本拆成节点数组：`[emoji:<id>]` 替换成表情图（id 未知时保留原文）。
 * 文本片段作为 ${} 插值交给 preact，自动 HTML 转义（安全）。
 * @param {string} text
 * @returns {any}
 */
export function renderChatText(text) {
  const parts = [];
  let last = 0;
  let key = 0;
  EMOJI_RE.lastIndex = 0;
  let m;
  while ((m = EMOJI_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(html`<span key=${key++}>${text.slice(last, m.index)}</span>`);
    const url = emoteArtUrl(m[1]);
    if (url) parts.push(html`<img key=${key++} class="chat-emoji-img" src=${url} alt="" />`);
    else parts.push(html`<span key=${key++}>${m[0]}</span>`);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(html`<span key=${key++}>${text.slice(last)}</span>`);
  return parts.length ? parts : [text];
}

/**
 * 房间文字聊天入口（与官方表情轮盘并存）：一个独立「聊天」按钮 + 可拖拽 / 改尺寸的聊天面板。
 * @param {{ open: boolean, onToggle: (open:boolean)=>void, disabled?: boolean }} props
 */
export function ChatDock({ open, onToggle, disabled = false }) {
  const chat = useStore((s) => s.chat);
  const [text, setText] = useState('');
  const [showPanel, setShowPanel] = useState(false);
  const [unread, setUnread] = useState(0);
  // 服务端聊天冷却 CHAT_COOLDOWN_MS（shared 冻结，1s）：发送后禁用发送钮，期间再按也不发
  const [cooling, setCooling] = useState(false);
  const coolTimer = useRef(null);
  // 面板可自由拖拽改大小；尺寸记忆在 localStorage，双击手柄复位
  const [size, setSize] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem('sp-chat-size'));
      if (v && v.w >= 160 && v.h >= 140) return v;
    } catch { /* 无记忆尺寸 */ }
    return null;
  });
  const sizeRef = useRef(size);
  // 面板位置可自由拖拽移动；位置记忆在 localStorage['sp-chat-pos']，双击标题栏复位
  const [pos, setPos] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem('sp-chat-pos'));
      if (v && typeof v.x === 'number' && typeof v.y === 'number') return v;
    } catch { /* 无记忆位置 */ }
    return null;
  });
  const posRef = useRef(pos);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const mountedRef = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;

  ensureChatCss();

  const allEmotes = useMemo(() => EMOTE_THEMES.flatMap((t) => t.emotes || []), []);

  // 展开时清空未读；新消息 / 展开时滚到底部
  useEffect(() => { if (open) setUnread(0); }, [open]);
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; } // 首次挂载的历史消息不计未读
    if (!openRef.current) setUnread((u) => u + 1);
  }, [chat.length]);
  useEffect(() => {
    const el = listRef.current;
    if (open && el) el.scrollTop = el.scrollHeight;
  }, [chat.length, open]);
  // 卸载时清掉冷却计时器
  useEffect(() => () => { if (coolTimer.current) clearTimeout(coolTimer.current); }, []);

  // 打开时点击面板外部关闭（输入框 / 表情都在 .chat-dock 内，不会误关）
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!(e.target instanceof Element) || !e.target.closest('.chat-dock')) onToggle(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open, onToggle]);

  // 关闭时一并收起表情网格
  useEffect(() => { if (!open) setShowPanel(false); }, [open]);

  const insertEmoji = (id) => {
    const el = inputRef.current;
    const mark = `[emoji:${id}]`;
    if (el && el.selectionStart != null && el.selectionEnd != null) {
      const a = el.selectionStart;
      const b = el.selectionEnd;
      const next = text.slice(0, a) + mark + text.slice(b);
      setText(next);
      requestAnimationFrame(() => {
        el.focus();
        el.selectionStart = el.selectionEnd = a + mark.length;
      });
    } else {
      setText((t) => t + mark);
    }
  };

  const send = () => {
    const t = text.trim();
    if (!t || disabled || cooling) return;
    actions.chat(t);
    setText('');
    if (inputRef.current) inputRef.current.value = '';
    // 本机冷却：发送后短暂禁用发送钮，与服务端 CHAT_COOLDOWN_MS 对齐，避免连点连发被服务端拒
    setCooling(true);
    if (coolTimer.current) clearTimeout(coolTimer.current);
    coolTimer.current = setTimeout(() => setCooling(false), CHAT_COOLDOWN_MS);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // 拖拽右下角手柄改面板尺寸：向右增宽 / 向上增高（面板底边锚定在按钮上方）
  const beginResize = (e) => {
    const panel = e.currentTarget.closest && e.currentTarget.closest('.chat-dock__panel');
    if (!panel) return;
    e.preventDefault();
    const r = panel.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const minW = Math.min(240, Math.round(vw * 0.6));
    const maxW = Math.min(640, Math.round(vw * 0.94));
    const minH = 150;
    const maxH = Math.round(vh * 0.82);
    document.body.style.userSelect = 'none';
    const move = (ev) => {
      const next = {
        w: Math.round(Math.min(maxW, Math.max(minW, start.w + (ev.clientX - start.x)))),
        h: Math.round(Math.min(maxH, Math.max(minH, start.h - (ev.clientY - start.y)))),
      };
      sizeRef.current = next;
      setSize(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.userSelect = '';
      try { localStorage.setItem('sp-chat-size', JSON.stringify(sizeRef.current)); } catch { /* 忽略 */ }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const resetSize = () => {
    sizeRef.current = null;
    setSize(null);
    try { localStorage.removeItem('sp-chat-size'); } catch { /* 忽略 */ }
  };

  // 拖拽标题栏移动整个面板。
  // 流畅性：拖动过程中直接用 DOM transform 平移面板（不触发 React 重渲染），
  // 松开时才把最终位置写回 state + localStorage，避免高频 setState 造成卡顿。
  const beginDrag = (e) => {
    if (e.button != null && e.button !== 0) return;
    const panel = e.currentTarget.closest && e.currentTarget.closest('.chat-dock__panel');
    if (!panel) return;
    e.preventDefault();
    const r = panel.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // 先把面板从「锚定在按钮上方」切成 fixed 定位（含视口当前坐标），再随指针平移
    posRef.current = { x: r.left, y: r.top };
    setPos({ x: r.left, y: r.top });
    panel.classList.add('is-moved');
    panel.style.left = r.left + 'px';
    panel.style.top = r.top + 'px';
    document.body.style.userSelect = 'none';
    const move = (ev) => {
      panel.style.transform = 'translate(' + (ev.clientX - start.x) + 'px,' + (ev.clientY - start.y) + 'px)';
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.userSelect = '';
      panel.style.transform = '';
      const next = {
        x: Math.round(Math.min(vw - 16, Math.max(0, start.left + (ev.clientX - start.x)))),
        y: Math.round(Math.min(vh - 16, Math.max(0, start.top + (ev.clientY - start.y)))),
      };
      posRef.current = next;
      setPos(next);
      panel.style.left = next.x + 'px';
      panel.style.top = next.y + 'px';
      try { localStorage.setItem('sp-chat-pos', JSON.stringify(next)); } catch { /* 忽略 */ }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const resetPos = () => {
    posRef.current = null;
    setPos(null);
    try { localStorage.removeItem('sp-chat-pos'); } catch { /* 忽略 */ }
  };

  return html`
    <div class="chat-dock">
      <button type="button" class=${cx('ewheel__btn', 'chat-dock__btn', open && 'is-on')}
        aria-expanded=${open ? 'true' : 'false'} aria-haspopup="dialog" disabled=${disabled}
        onClick=${() => onToggle(!open)} title="房间聊天 / 交流">
        <${GIcon} name="emote" /><span class="ewheel__label">交流</span>
        ${!open && unread > 0 ? html`<span class="chat-dock__badge">${unread > 99 ? '99+' : unread}</span>` : null}
      </button>

      ${open ? html`
        <div class=${cx('chat-dock__panel', size && 'is-sized', pos && 'is-moved')} role="dialog" aria-label="房间聊天"
          style=${[size && `width:${size.w}px;height:${size.h}px`, pos && `left:${pos.x}px;top:${pos.y}px`].filter(Boolean).join(';') || undefined}>
          <div class="chat-dock__head chat-dock__head--drag" title="拖动移动聊天框 · 双击复位位置"
            onPointerDown=${beginDrag} onDoubleClick=${resetPos}>
            <span class="chat-dock__tag">COMMS</span>
            <span class="chat-dock__title">房间聊天</span>
            <button type="button" class="chat-dock__close" aria-label="收起" title="收起 (Esc)"
              onPointerDown=${(e) => e.stopPropagation()}
              onClick=${() => onToggle(false)}>✕</button>
          </div>

          <div class="chat-dock__body" ref=${listRef}>
            ${chat.length === 0 ? html`<div class="chat-dock__empty">// 暂无消息，说点什么吧</div>`
              : chat.map((c) => html`
                <div key=${c.seq} class="chat-item">
                  <span class="chat-item__who">${c.name || c.id}</span>
                  <span class="chat-item__sep">›</span>
                  <span class="chat-item__text">${renderChatText(c.text)}</span>
                </div>`)}
          </div>

          ${showPanel ? html`
            <div class="chat-dock__faces">
              ${allEmotes.map((e) => html`
                <button key=${e.id} type="button" class="chat-dock__face" title=${e.label || ''}
                  onClick=${() => insertEmoji(e.id)}>
                  ${emoteArtUrl(e.id) ? html`<img src=${emoteArtUrl(e.id)} alt=${e.label || ''} />` : (e.label || '')}
                </button>`)}
            </div>` : null}

          <div class="chat-dock__input">
            <button type="button" class=${cx('chat-dock__emoji', showPanel && 'is-on')} aria-label="选择表情" title="选择表情"
              onClick=${() => setShowPanel((v) => !v)}><${GIcon} name="emote" /></button>
            <input ref=${inputRef} class="chat-dock__field" type="text" maxlength=${CHAT_MAX_LEN}
              placeholder="输入讯息，可插入表情…" value=${text}
              onInput=${(e) => setText(e.target.value)}
              onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } }} />
            <button type="button" class="chat-dock__send" disabled=${disabled || cooling} onClick=${send}>${cooling ? '…' : '发送'}</button>
          </div>

          <div class="chat-dock__resize" role="separator" aria-orientation="both"
            title="拖拽调整大小 · 双击复位"
            onPointerDown=${beginResize} onDoubleClick=${resetSize}></div>
        </div>` : null}
    </div>`;
}
