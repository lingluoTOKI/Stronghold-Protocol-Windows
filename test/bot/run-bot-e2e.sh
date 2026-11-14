#!/bin/bash
# 机器人侧端到端联调（容器内闭环，不依赖宿主机网络）
# 1) 把账号模块 + 夹具拷进容器
# 2) 容器内起隔离夹具（127.0.0.1，loopback 满足插件的 http 白名单）
# 3) 容器内用真实插件 game_account.py 验证绑定码
set -u
PORT=3999
KEY=$(grep SP_ACCOUNT_BRIDGE_KEY /var/lib/stronghold-accounts/3000.env | cut -d= -f2)

docker exec astrbot rm -rf /tmp/spfix 2>/dev/null
docker exec astrbot mkdir -p /tmp/spfix/accounts
docker cp /root/stronghold/server/accounts/http.js        astrbot:/tmp/spfix/accounts/http.js
docker cp /root/stronghold/server/accounts/client.js      astrbot:/tmp/spfix/accounts/client.js
docker cp /root/stronghold/server/accounts/store.js       astrbot:/tmp/spfix/accounts/store.js
docker cp /root/stronghold/server/accounts/challenges.js  astrbot:/tmp/spfix/accounts/challenges.js
docker cp /root/stronghold/server/accounts/worker.js      astrbot:/tmp/spfix/accounts/worker.js
docker cp /tmp/sp-fixture-fixture.mjs                      astrbot:/tmp/spfix/fixture.mjs
docker cp /tmp/sp-fixture-check.py                        astrbot:/tmp/spfix/check.py

# 夹具在容器内启动（后台，容器常驻所以不会随 SSH 结束而退出）
docker exec -d astrbot sh -c "cd /tmp/spfix && SP_FIXTURE_DB=/tmp/spfix/accounts.sqlite node fixture.mjs $PORT '$KEY' 'http://127.0.0.1:$PORT' > /tmp/spfix/fixture.log 2>&1"
for i in $(seq 1 30); do
  docker exec astrbot sh -c "grep -q FIXTURE_READY /tmp/spfix/fixture.log 2>/dev/null" && break
  sleep 0.5
done
echo "--- fixture log ---"
docker exec astrbot cat /tmp/spfix/fixture.log 2>&1 | head -5

CODE=$(docker exec astrbot sh -c "curl -s -X POST http://127.0.0.1:$PORT/api/account/start -H 'Origin: http://127.0.0.1:$PORT' -H 'Authorization: Bearer $(printf a%.0s {1..32})' -H 'Content-Type: application/json' -d '{\"qq\":\"100200300\",\"nickname\":\"lian\"}'" 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin).get('code',''))" 2>/dev/null)
if [ -z "$CODE" ]; then
  echo "--- no curl in container, generating code via node ---"
  CODE=$(docker exec astrbot node -e "
fetch('http://127.0.0.1:$PORT/api/account/start',{method:'POST',headers:{'Origin':'http://127.0.0.1:$PORT','Authorization':'Bearer '+'a'.repeat(32),'Content-Type':'application/json'},body:JSON.stringify({qq:'100200300',nickname:'lian'})}).then(r=>r.json()).then(j=>console.log(j.code))
" 2>&1 | tail -1)
fi
echo "--- generated code: $CODE ---"

docker exec astrbot python /tmp/spfix/check.py "http://127.0.0.1:$PORT" "$KEY" 3000 "$CODE" 2>&1 | tail -20
RC=$?
docker exec astrbot sh -c "pkill -f 'fixture.mjs' 2>/dev/null" >/dev/null 2>&1
exit $RC
