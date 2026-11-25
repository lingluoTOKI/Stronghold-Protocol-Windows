# 上游自动同步（一键：检测 → 合并 → 自检 → 发布 → 上线 → 公告）
#
# 用法（在任意 PowerShell 里执行）：
#   1) 只看看有没有更新：            powershell -File deploy\auto-sync-upstream.ps1 -DryRun
#   2) 同步到新分支 + 自检（推荐先跑这个）： powershell -File deploy\auto-sync-upstream.ps1
#   3) 同步并部署上线（带自动回滚）：      powershell -File deploy\auto-sync-upstream.ps1 -Deploy -Push
#   4) 只发布一条已写好的公告：          powershell -File deploy\auto-sync-upstream.ps1 -AnnounceFile docs\announcements\20261125.json
#
# 设计原则（与 docs/1UPSTREAM-SYNC-PROMPT.md 一致）：
#   - 任何冲突都停下，不自动解决（冲突要靠人判断，脚本只报告）；
#   - 自检不过绝不部署（55 项自研校验 / 导入检查 / 语法检查 / 可选 golden）；
#   - 部署前后都在服务器留备份，健康检查失败自动恢复上一版；
#   - 只同步上游 dev，不拉 master；不改 data/assets.json（线上那份含本服皮肤）。
#
# 退出码：0 = 成功/无更新；1 = 冲突或自检失败；2 = 部署失败（已自动回滚）；3 = 参数/环境问题

param(
  [switch]$DryRun,        # 只检测，不合并
  [switch]$Deploy,        # 合并自检通过后部署到服务器
  [switch]$Push,          # 推送到 origin（GitHub）
  [switch]$SkipGolden,    # 跳过 golden（不推荐；golden 约 5 分钟）
  [string]$AnnounceFile = ''  # 指定公告 JSON（单条 item），只做公告发布
)

$ErrorActionPreference = 'Stop'

# ---------- 常量 ----------
$Repo    = 'F:\github\Stronghold-Protocol\sp-clean-Stronghold-Protocol'
$Git     = 'C:\Program Files\Git\cmd\git.exe'
$Ssh     = 'C:\Windows\System32\OpenSSH\ssh.exe'
$Scp     = 'C:\Windows\System32\OpenSSH\scp.exe'
$Key     = 'F:\github\BOT用\robot.pem'
$Server  = 'root@101.132.104.41'
$Remote  = '/root/stronghold'
$RemotePort = 3000
$Upstream = 'upstream/dev'
$Stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$Date    = Get-Date -Format 'yyyyMMdd'

function Log($msg, $color = 'Gray') { Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $msg" -ForegroundColor $color }
function Fail($msg, $code = 1) { Log "✗ $msg" 'Red'; exit $code }

function GitRun([string[]]$gitArgs, [switch]$AllowFail) {
  $out = & $Git -C $Repo @gitArgs 2>&1
  $code = $LASTEXITCODE
  if ($code -ne 0 -and -not $AllowFail) { throw ("git " + ($gitArgs -join ' ') + " 失败: " + ($out -join "`n")) }
  return @{ Out = $out; Code = $code }
}

function SshRun([string]$cmd) {
  $out = & $Ssh -i $Key -o StrictHostKeyChecking=no -o ConnectTimeout=20 $Server $cmd 2>&1
  return @{ Out = $out; Code = $LASTEXITCODE }
}

# ---------- 公告单独发布 ----------
if ($AnnounceFile) {
  if (-not (Test-Path $AnnounceFile)) { Fail "公告文件不存在: $AnnounceFile" 3 }
  Log "发布公告: $AnnounceFile"
  $tmp = Join-Path $env:TEMP "ann-item-$Stamp.json"
  Copy-Item $AnnounceFile $tmp -Force
  & $Scp -i $Key -o StrictHostKeyChecking=no $tmp "${Server}:/tmp/ann-item-$Stamp.json" | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail '上传公告失败' 3 }
  $py = Join-Path $env:TEMP "ann-merge-$Stamp.py"
  @"
import json, datetime
p = '$Remote/announcements.json'
it = json.load(open('/tmp/ann-item-$Stamp.json', encoding='utf-8'))
j = json.load(open(p, encoding='utf-8'))
j['items'] = [x for x in j.get('items', []) if x.get('version') != it['version']]
j['items'].insert(0, it)
j['updatedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
open(p, 'w', encoding='utf-8').write(json.dumps(j, ensure_ascii=False, indent=2) + '\n')
print('items=', len(j['items']), 'top=', j['items'][0]['version'])
"@ | Set-Content -LiteralPath $py -Encoding utf8NoBOM
  & $Scp -i $Key -o StrictHostKeyChecking=no $py "${Server}:/tmp/ann-merge-$Stamp.py" | Out-Null
  $r = SshRun "cp $Remote/announcements.json $Remote/announcements.json.bak-$Stamp && python3 /tmp/ann-merge-$Stamp.py && sleep 2 && curl -s -m 8 http://127.0.0.1:$RemotePort/api/announcements | head -c 200"
  Log ($r.Out -join "`n")
  if ($r.Code -ne 0) { Fail '公告发布失败' 2 }
  Log '✓ 公告已生效' 'Green'; exit 0
}

# ---------- 环境检查 ----------
if (-not (Test-Path $Repo)) { Fail "仓库不存在: $Repo" 3 }
Set-Location $Repo
Log "仓库: $Repo"

$dirty = @(GitRun @('status', '--porcelain') | ForEach-Object { $_.Out } | Where-Object { $_ })
# 允许的两类残留：archive/ 与 .playwright-cli/、output/
$blocking = $dirty | Where-Object { $_ -notmatch '^(\?\?|M )\s*(archive/|\.playwright-cli/|output/)' -and $_ -notmatch '^\?\?\s*(archive|\.playwright-cli|output)/' }
if ($blocking.Count -gt 0) {
  Log '工作区有未提交改动，先处理再同步：' 'Yellow'
  $blocking | Select-Object -First 20 | ForEach-Object { Log "   $_" }
  Fail '工作区不干净（可用 git stash 暂存）' 3
}

$branch = (GitRun @('rev-parse', '--abbrev-ref', 'HEAD')).Out
Log "当前分支: $branch"

# ---------- 1. 检测 ----------
Log "拉取上游 $Upstream ..."
GitRun @('fetch', 'upstream', 'dev', '--tags') | Out-Null
$upHead = (GitRun @('rev-parse', $Upstream)).Out
$behind = [int]((GitRun @('rev-list', '--count', "HEAD..$Upstream")).Out)
$isAncestor = ((GitRun @('merge-base', '--is-ancestor', $Upstream, 'HEAD') -AllowFail)).Code -eq 0

Log "上游 dev HEAD = $upHead"
Log "待合提交数 = $behind"

if ($behind -eq 0 -and $isAncestor) {
  Log '✓ 上游无新版本（本地已包含全部上游提交）' 'Green'
  exit 0
}

$subjects = @(GitRun @('log', '--oneline', '--no-decorate', "-n", '15', "HEAD..$Upstream") | ForEach-Object { $_.Out })
Log "最近上游提交："
$subjects | ForEach-Object { Log "   $_" }

if ($DryRun) {
  Log "DryRun：只检测不合并。共 $behind 个提交待合。" 'Cyan'
  exit 0
}

# ---------- 2. 合并 ----------
$preTag = "pre-sync-$Date"
GitRun @('tag', '-f', $preTag, 'HEAD') | Out-Null
Log "已打备份标签 $preTag"

$newBranch = "sync/upstream-$Date"
$exists = (GitRun @('branch', '--list', $newBranch)).Out
if ($exists) { $newBranch = "sync/upstream-$Date-$Stamp" }
GitRun @('checkout', '-b', $newBranch) | Out-Null
Log "已切到新分支 $newBranch"

Log '合并上游（不自动提交）...'
$merge = GitRun @('merge', '--no-commit', '--no-ff', $Upstream) -AllowFail
$conflicts = @(GitRun @('diff', '--name-only', '--diff-filter=U')).Out | Where-Object { $_ }

if ($conflicts.Count -gt 0) {
  Log "✗ 出现 $($conflicts.Count) 个冲突文件：" 'Red'
  $conflicts | ForEach-Object { Log "   $_" }
  GitRun @('merge', '--abort') -AllowFail | Out-Null
  GitRun @('checkout', $branch) | Out-Null
  GitRun @('branch', '-D', $newBranch) -AllowFail | Out-Null
  Log '已中止合并、删除临时分支。请按 docs\1UPSTREAM-SYNC-PROMPT.md 人工解冲突后重跑。' 'Yellow'
  exit 1
}

GitRun @('add', '-A', '--', ':!archive', ':!.playwright-cli', ':!output') -AllowFail | Out-Null
GitRun @('commit', '-m', "sync: 上游 $Upstream（$behind 提交，至 $($upHead.Substring(0,8) )）· 自动同步") | Out-Null
Log '✓ 合并已提交（无冲突）' 'Green'

# ---------- 3. 自检 ----------
Log '自检 1/4：独有功能校验（55 项）...'
& node tools/verify-local-patches.mjs 2>&1 | Select-Object -Last 6 | ForEach-Object { Log "   $_" }
if ($LASTEXITCODE -ne 0) {
  GitRun @('checkout', $branch) | Out-Null
  Fail '独有功能校验未通过，已放弃本次同步（分支保留供排查）' 1
}
Log '✓ 55 项自研功能全部保留' 'Green'

Log '自检 2/4：导入边界检查...'
$ci = & node tools/check-imports.mjs 2>&1
$ci | Select-Object -Last 3 | ForEach-Object { Log "   $_" }
if ($LASTEXITCODE -ne 0) { Fail '导入检查未通过' 1 }
Log '✓ 导入检查通过' 'Green'

Log '自检 3/4：改动文件语法检查...'
$changedJs = @(GitRun @('diff', '--name-only', "--diff-filter=AM", "$preTag..HEAD") | ForEach-Object { $_.Out } | Where-Object { $_ -match '\.(js|mjs)$' })
$bad = 0
foreach ($f in $changedJs) { & node --check $f 2>&1 | Out-Null; if ($LASTEXITCODE -ne 0) { Log "   语法错误: $f" 'Red'; $bad++ } }
if ($bad -gt 0) { Fail "$bad 个文件语法检查失败" 1 }
Log "✓ $($changedJs.Count) 个改动 js/mjs 语法通过" 'Green'

if (-not $SkipGolden) {
  Log '自检 4/4：golden 战斗回归（约 5 分钟）...'
  & node tools/golden.mjs 2>&1 | Select-Object -Last 8 | ForEach-Object { Log "   $_" }
  if ($LASTEXITCODE -ne 0) { Fail 'golden 未通过（上游改动可能被本服补丁改坏），已停下' 1 }
  Log '✓ golden 全绿' 'Green'
} else {
  Log '已跳过 golden（-SkipGolden）' 'Yellow'
}

# ---------- 4. 部署 ----------
if ($Deploy) {
  Log '打包变更文件...'
  $payload = Join-Path $env:TEMP "sp-payload-$Stamp"
  $zipPath = Join-Path $env:TEMP "sp-deploy-$Stamp.zip"
  Remove-Item $payload, $zipPath -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $payload -Force | Out-Null
  $prefix = ($payload -replace '\\', '/') + '/'
  GitRun @('checkout-index', '-a', '-f', "--prefix=$prefix") | Out-Null

  $files = @(GitRun @('diff', '--name-only', "$preTag..HEAD") | ForEach-Object { $_.Out } | Where-Object { $_ -and $_ -ne 'data/assets.json' })
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
  $n = 0
  foreach ($f in $files) {
    $full = Join-Path $payload ($f -replace '/', '\')
    if (Test-Path -LiteralPath $full) {
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $full, $f, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
      $n++
    }
  }
  $zip.Dispose()
  Log "  打包 $n 个文件，$([math]::Round((Get-Item $zipPath).Length / 1MB, 1)) MB"

  $remoteBak = "/root/backups/stronghold-code-$Stamp.tar.gz"
  Log '服务器备份当前版本...'
  $bk = SshRun "mkdir -p /root/backups && tar czf $remoteBak -C /root stronghold --exclude=stronghold/node_modules --exclude=stronghold/public/assets --exclude=stronghold/public/vendor --exclude=stronghold/public/fonts --exclude=stronghold/.cache && ls -lh $remoteBak"
  if ($bk.Code -ne 0) { Fail '服务器备份失败，已取消部署' 2 }
  Log ("  " + ($bk.Out -join ' '))

  Log '上传并解包...'
  & $Scp -i $Key -o StrictHostKeyChecking=no $zipPath "${Server}:/root/sp-deploy-$Stamp.zip" | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail '上传失败' 2 }
  $dep = SshRun "python3 -c `"import zipfile;z=zipfile.ZipFile('/root/sp-deploy-$Stamp.zip');z.extractall('$Remote');print('extracted',len(z.namelist()))`" && systemctl restart stronghold && sleep 8 && systemctl is-active stronghold"
  if ($dep.Code -ne 0 -or (($dep.Out -join '') -notmatch 'active')) {
    Log '部署失败，自动回滚...' 'Red'
    SshRun "tar xzf $remoteBak -C /root && systemctl restart stronghold" | Out-Null
    Fail "部署失败，已回滚到 $remoteBak" 2
  }

  Log '健康检查...'
  $ok = $false
  for ($i = 0; $i -lt 6; $i++) {
    Start-Sleep -Seconds 3
    $h = SshRun "curl -s -m 6 http://127.0.0.1:$RemotePort/healthz"
    if (($h.Out -join '') -match '"ok":true') { $ok = $true; break }
  }
  if (-not $ok) {
    Log '健康检查未通过，自动回滚...' 'Red'
    SshRun "tar xzf $remoteBak -C /root && systemctl restart stronghold" | Out-Null
    Start-Sleep -Seconds 6
    Fail "健康检查失败，已回滚到 $remoteBak" 2
  }
  Log '✓ 上线完成，/healthz 正常' 'Green'
  Log "  回滚命令（万一之后发现问题）：ssh 后执行 tar xzf $remoteBak -C /root && systemctl restart stronghold" 'Cyan'
}

# ---------- 5. 推送 ----------
if ($Push) {
  Log "推送到 origin ..."
  GitRun @('push', '-u', 'origin', $newBranch) | Out-Null
  Log "✓ 已推送分支 $newBranch" 'Green'
}

# ---------- 6. 公告草稿 ----------
$draftDir = Join-Path $Repo 'docs\announcements'
New-Item -ItemType Directory -Path $draftDir -Force | Out-Null
$draftPath = Join-Path $draftDir "$Date-auto.json"
$items = @()
foreach ($s in $subjects) {
  $line = ($s -replace '^[0-9a-f]{7,}\s+', '')
  $items += ($line -replace '"', "'")
}
$draft = [ordered]@{
  version = "0.4.0-sync-$Date"
  time    = (Get-Date -Format 'yyyy-MM-dd')
  title   = "$((Get-Date).ToString('M月d日'))更新：同步上游（$behind 个提交）"
  content = (($items | Select-Object -First 12 | ForEach-Object { "· $_" }) -join '\n')
}
$json = ConvertTo-Json $draft -Depth 3
Set-Content -LiteralPath $draftPath -Value $json -Encoding utf8NoBOM
Log "公告草稿已生成：$draftPath（改好后用 -AnnounceFile 发布，或在 -Deploy 时一并发布）" 'Cyan'

Log '完成。' 'Green'
