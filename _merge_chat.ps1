$ErrorActionPreference = 'Stop'
$p = 'F:\github\Stronghold-Protocol-Windows-v0.1.0\public\js\screens\game.js'
$bytes = [IO.File]::ReadAllBytes($p)
$hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
$t = [IO.File]::ReadAllText($p)

$repls = @(
  @('import { EmoteWheel } from ''../ui/emotes.js'';', 'import { ChatDock } from ''../ui/chat.js'';'),
  @('import { ChatWidget } from ''../ui/chat.js'';', ''),
  @('      <${ChatWidget} />', ''),
  @('        <${EmoteWheel} open=${emoteOpen} onToggle=${setEmoteOpen} onSend=${(id) => actions.emote(id)} disabled=${conn.status !== ''online''} />',
    '        <${ChatDock} open=${emoteOpen} onToggle=${setEmoteOpen} disabled=${conn.status !== ''online''} />')
)

$idx = 0
foreach ($r in $repls) {
  $idx++
  $old = $r[0]; $new = $r[1]
  $n = ($t.Split([string[]]@($old), [StringSplitOptions]::None)).Length - 1
  if ($n -ne 1) { Write-Host ("FAIL pair {0}: found {1} occurrence(s)" -f $idx, $n); exit 1 }
  $t = $t.Replace($old, $new)
  Write-Host ("OK pair {0} replaced" -f $idx)
}

if ($hasBom) { $enc = New-Object System.Text.UTF8Encoding($true) } else { $enc = New-Object System.Text.UTF8Encoding($false) }
[IO.File]::WriteAllText($p, $t, $enc)
Write-Host ("DONE. BOM preserved: {0}" -f $hasBom)
