// test/announcements.test.js — announcements.json 的形状与排序约定。
//
// 这个文件同时被两处读：服务器（server/index.js 的 createAnnouncements，带 mtime 热加载，
// 经 /api/announcements 给客户端）和 public/js/screens/title.js（公告栏）。
//
// 排序为什么需要守：这份文件被「把最新一条插到最前面」和「追加到末尾」两种方式交替维护过，
// 一度出现最旧的一条排在最新的前面。title.js 现在自己按 time 降序排（不依赖书写顺序），
// 但文件本身保持降序能让 `--check` 式的人工审阅和 diff 都直观 —— 所以约定要测住。
// 同一天的多条按它们在文件里的相对次序保留（不需要也不应该由测试规定）。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(path.join(ROOT, 'announcements.json'), 'utf8');
const data = JSON.parse(raw);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

describe('announcements.json', () => {
  test('顶层形状：updatedAt 是时间戳，items 是非空数组', () => {
    assert.equal(typeof data.updatedAt, 'string');
    assert.ok(!Number.isNaN(Date.parse(data.updatedAt)), `updatedAt 不是可解析的时间：${data.updatedAt}`);
    assert.ok(Array.isArray(data.items), 'items 必须是数组');
    assert.ok(data.items.length > 0, 'items 不能为空');
  });

  test('每条公告的字段齐全且类型正确', () => {
    for (const [i, it] of data.items.entries()) {
      assert.equal(typeof it, 'object', `第 ${i} 条不是对象`);
      assert.ok(it !== null);
      for (const k of ['version', 'time', 'title', 'content']) {
        assert.equal(typeof it[k], 'string', `第 ${i} 条（${it.version ?? '?'}）的 ${k} 必须是字符串`);
        assert.ok(it[k].length > 0, `第 ${i} 条（${it.version ?? '?'}）的 ${k} 不能为空`);
      }
      assert.match(it.time, DATE_RE, `第 ${i} 条（${it.version}）的 time 要写成 YYYY-MM-DD：${it.time}`);
    }
  });

  test('version 不重复', () => {
    const seen = new Set();
    for (const it of data.items) {
      assert.ok(!seen.has(it.version), `version 重复：${it.version}`);
      seen.add(it.version);
    }
  });

  test('按 time 从近到远（降序）排列', () => {
    for (let i = 1; i < data.items.length; i++) {
      const prev = data.items[i - 1];
      const cur = data.items[i];
      assert.ok(
        prev.time >= cur.time,
        `第 ${i} 条（${cur.version}，${cur.time}）比上一条（${prev.version}，${prev.time}）新，顺序反了`,
      );
    }
  });
});
