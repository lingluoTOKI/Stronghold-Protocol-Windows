// 浏览器端完整联调：真实 Chrome + 真实前端 + 真实后端账号模块 + 真实机器人桥接
// 流程：进大厅 -> 打开「QQ 账号」-> 填 QQ/昵称 -> 生成群验证指令 -> 机器人验证 -> 回页面确认 -> 登录态 -> 改昵称 -> 恢复码 -> 刷新保持
//
// 用项目既有的 puppeteer-core + 系统 Chrome（见 test/e2e/client.mjs 的做法），不额外引入依赖。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.js';

const BRIDGE = 'b'.repeat(32);
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const CHROME = CHROME_CANDIDATES.find(p => existsSync(p));
const wait = ms => new Promise(r => setTimeout(r, ms));

test('browser completes the QQ binding flow end to end', { skip: CHROME ? false : 'no system Chrome' }, async () => {
  const puppeteer = (await import('puppeteer-core')).default;
  const dir = mkdtempSync(join(tmpdir(), 'sp-account-browser-'));
  const prev = { ...process.env };
  // origin 白名单必须与浏览器实际发送的 Origin 完全一致（含端口），与生产同语义。
  // createAccounts 在构造时就固定 origin，所以必须先定端口再启动服务。
  // 3900..4039：避开 Chrome 的受限端口表（4045 会被 ERR_UNSAFE_PORT 拦掉）
  const port = 3900 + Math.floor(Math.random() * 140);
  const base = `http://127.0.0.1:${port}`;
  process.env.SP_ACCOUNT_DB = join(dir, 'accounts.sqlite');
  process.env.SP_ACCOUNT_BRIDGE_KEY = BRIDGE;
  process.env.SP_ACCOUNT_BOT_NAMESPACE = 'dafeiyu-official';
  process.env.SP_ACCOUNT_ORIGIN = base;

  const srv = await startServer({ port, host: '127.0.0.1', quiet: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--no-first-run', '--disable-background-timer-throttling', '--mute-audio'],
    protocolTimeout: 90000,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  try {
    // 1) 打开首页，填代号后进入大厅（账号按钮在大厅顶栏）
    const enterLobby = async () => {
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
      await wait(2000);
      await page.waitForSelector('input', { timeout: 15000 });
      await page.type('input', '浏览器测试员');
      await wait(400);
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '开始');
        if (btn) btn.click();
      });
      await wait(4000);
    };
    await enterLobby();

    // 2) 点击弹窗内按钮（按文案）
    const clickByText = async (text, inModal = false) => {
      const ok = await page.evaluate((t, modalOnly) => {
        const modals = [...document.querySelectorAll('.modal, [role="dialog"]')];
        const root = modalOnly ? modals[modals.length - 1] : document;
        const el = [...(root?.querySelectorAll('button') || [])].find(b => b.textContent.includes(t));
        if (!el) return false;
        el.click();
        return true;
      }, text, inModal);
      assert.ok(ok, '找不到按钮: ' + text);
      await wait(900);
    };
    const modalText = async () => page.evaluate(() => {
      const modals = [...document.querySelectorAll('.modal, [role="dialog"]')];
      const m = modals[modals.length - 1];
      return m ? m.innerText : '';
    });

    await clickByText('QQ 账号');
    await wait(1200);

    // 3) 未登录态说明
    let text = await modalText();
    assert.ok(text.includes('不需要游戏密码'), '弹窗应显示无密码说明，实际: ' + text.slice(0, 200));

    // 4) 填 QQ 与昵称（弹窗内第一个是 QQ，第二个是昵称）
    const inputs = await page.$$('.modal input, [role="dialog"] input');
    assert.ok(inputs.length >= 2, '应有 QQ 与昵称输入框');
    await inputs[0].click({ clickCount: 3 });
    await inputs[0].type('100200300');
    await inputs[1].click({ clickCount: 3 });
    await inputs[1].type('浏览器昵称');

    // 5) 生成群验证指令
    await clickByText('生成群验证指令', true);
    await wait(1200);
    const command = await page.evaluate(() => {
      const modals = [...document.querySelectorAll('.modal, [role="dialog"]')];
      const ro = modals[modals.length - 1]?.querySelector('input[readonly]');
      return ro ? ro.value : '';
    });
    assert.match(command, /^绑定游戏 3000 [A-F0-9]{16}$/, '绑定指令格式不对: ' + command);
    const code = command.split(' ').pop();

    // 6) 机器人侧桥接验证（等价于群里 @大肥鱼 发指令）
    const bridgeRes = await fetch(base + '/api/account/bridge', {
      method: 'POST',
      headers: { 'X-Account-Bridge': BRIDGE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, sender: 'qq-browser-user' })
    });
    assert.equal(bridgeRes.status, 200);

    // 7) 回页面确认登录
    await clickByText('已发送，确认登录', true);
    await wait(1800);
    text = await modalText();
    assert.ok(text.includes('QQ 身份已验证'), '确认后应显示已验证，实际: ' + text.slice(0, 300));
    assert.ok(text.includes('10****00'), 'QQ 应脱敏显示，实际: ' + text.slice(0, 300));

    // 8) 改昵称
    const inputs2 = await page.$$('.modal input, [role="dialog"] input');
    await inputs2[0].click({ clickCount: 3 });
    await inputs2[0].type('新昵称');
    await clickByText('保存昵称', true);
    await wait(1500);
    assert.ok((await modalText()).includes('昵称已保存'), '改昵称应提示已保存');

    // 9) 生成账号恢复码（按钮在折叠的「账号恢复与退出」里）
    await page.evaluate(() => {
      const modals = [...document.querySelectorAll('.modal, [role="dialog"]')];
      const m = modals[modals.length - 1];
      const d = m?.querySelectorAll('details');
      d?.[d.length - 1]?.querySelector('summary')?.click();
    });
    await wait(400);
    await clickByText('生成新的账号恢复码', true);
    await wait(1500);
    assert.ok((await modalText()).includes('请立即私密保存'), '应提示保存恢复码');

    // 10) 刷新页面后登录态仍在（cookie 持久化）
    await enterLobby();
    await clickByText('QQ 账号');
    await wait(1500);
    assert.ok((await modalText()).includes('QQ 身份已验证'), '刷新后登录态应保留');

    assert.deepEqual(errors, [], '页面不应有 JS 错误');
  } finally {
    await browser.close();
    await srv.close();
    rmSync(dir, { recursive: true, force: true });
    for (const k of Object.keys(process.env)) if (!(k in prev)) delete process.env[k];
    Object.assign(process.env, prev);
  }
});
