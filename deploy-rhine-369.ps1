# 本轮莱茵装置 3/6/9 对齐 + 掉人回收修复 —— 部署步骤（本地 PowerShell 执行）
# 作用：把 3 个文件推到线上 101.132.104.41，重启 stronghold，验证 /healthz。
# 注意：restart 会中断当前在线对局。挑没人的时候执行。

$REMOTE = "root@101.132.104.41"
$BASE   = "/root/stronghold"

# ── 0) 部署前快照当前在线与 build（用于回滚对照）─────────────────────────
Write-Host "== 部署前状态 =="
curl.exe -sS -m 8 https://game.lingluotoki.dpdns.org/healthz
Write-Host ""

# ── 1) 备份线上将被覆盖的 3 个文件 ─────────────────────────────────────
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
ssh -o BatchMode=yes $REMOTE "mkdir -p $BASE/backups/rhine-369-$stamp && cp -a $BASE/shared/rhineResearch.js $BASE/server/match/player/round.js $BASE/announcements.json $BASE/backups/rhine-369-$stamp/" 2>&1
Write-Host "  已备份到 $BASE/backups/rhine-369-$stamp/"

# ── 2) 上传本地 3 个文件（本地 PowerShell 执行，路径按本仓库根）─────────
scp -o BatchMode=yes -q shared/rhineResearch.js        "${REMOTE}:${BASE}/shared/rhineResearch.js"
scp -o BatchMode=yes -q server/match/player/round.js   "${REMOTE}:${BASE}/server/match/player/round.js"
scp -o BatchMode=yes -q announcements.json             "${REMOTE}:${BASE}/announcements.json"
Write-Host "  3 个文件已上传"

# ── 3) 上传后校验 md5（本地 vs 线上必须一致）───────────────────────────
Write-Host "`n== md5 校验 =="
foreach ($f in @('shared/rhineResearch.js','server/match/player/round.js','announcements.json')) {
  $local = (Get-FileHash $f -Algorithm MD5).Hash.ToLower()
  $remote = (ssh -o BatchMode=yes $REMOTE "md5sum $BASE/$f" 2>&1) -split '\s+' | Select-Object -First 1
  $ok = if ($local -eq $remote) { "OK" } else { "★不一致!!" }
  "  $ok  $f  local=$($local.Substring(0,12))  remote=$($remote.Substring(0,12))"
}

# ── 4) 语法自检（不起服务）────────────────────────────────────────────
Write-Host "`n== 语法自检 =="
ssh -o BatchMode=yes $REMOTE "cd $BASE && node --check shared/rhineResearch.js && node --check server/match/player/round.js && echo '  syntax OK'" 2>&1

# ── 5) 重启 + 健康检查 ─────────────────────────────────────────────────
Write-Host "`n== 重启 =="
ssh -o BatchMode=yes $REMOTE "systemctl restart stronghold && sleep 4 && systemctl is-active stronghold" 2>&1
Write-Host "`n== 健康检查（等最多 12 次）=="
ssh -o BatchMode=yes $REMOTE @'
for i in $(seq 1 12); do
  R=$(curl -s -m 3 http://127.0.0.1:3000/healthz 2>/dev/null)
  if [ -n "$R" ]; then echo "  $R"; exit 0; fi
  echo "  第 $i 次无响应…"; sleep 2
done
echo "  !! 健康检查失败，请立即回滚："
echo "     cp -a $BASE/backups/rhine-369-$stamp/* $BASE/shared/rhineResearch.js $BASE/server/match/player/round.js $BASE/announcements.json && systemctl restart stronghold"
exit 1
'@ 2>&1

# ── 6) 验证 minCount 生效（线上已为 3/6/9）────────────────────────────
Write-Host "`n== 验证 minCount =="
ssh -o BatchMode=yes $REMOTE "grep -o 'minCount: [0-9]' $BASE/shared/rhineResearch.js" 2>&1
Write-Host "（应看到 medical=3、energy=6、ecology=9）"
