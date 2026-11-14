// 联调夹具：在服务器上起一个隔离的账号服务（不碰线上进程），供机器人插件验证。
// 用法：node account-bridge-fixture.mjs <port> <bridgeKey> <origin>
import { createServer } from 'node:http';
import { createAccounts } from './accounts/http.js';

const [port, bridgeKey, origin] = process.argv.slice(2);
const realm = '3000';
const accounts = createAccounts({
  file: process.env.SP_FIXTURE_DB || '/tmp/sp-fixture/accounts.sqlite',
  realm, origin, bridgeKey,
  namespace: 'dafeiyu-official',
  registry: { byToken: () => ({ roomCode: null }) },
});
const server = createServer((req, res) => {
  const path = new URL(req.url, origin).pathname;
  if (!path.startsWith('/api/account/')) { res.statusCode = 404; res.end('{}'); return; }
  accounts.handle(req, res, path);
});
server.listen(Number(port), '0.0.0.0', () => {
  console.log('FIXTURE_READY', server.address().port);
});
