$ErrorActionPreference = 'Stop'
$runtimeDir = Join-Path $PSScriptRoot '.presentation'
$statePath = Join-Path $runtimeDir 'state.json'
if (!(Test-Path $statePath)) { Write-Output 'No presentation is running.'; exit 0 }
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
foreach ($item in @(@{pid=$state.serverPid; type='server'}, @{pid=$state.tunnelPid; type='tunnel'})) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($item.pid)" -ErrorAction SilentlyContinue
    if (!$process) { continue }
    $owned = if ($item.type -eq 'server') { $process.CommandLine -like '*uvicorn*8770*' } else { $process.ExecutablePath -eq (Join-Path $runtimeDir 'cloudflared.exe') }
    if (!$owned) { throw 'A process ID was reused. Refusing to stop an unrelated process.' }
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($item.pid)"
    foreach ($child in $children) {
        if ($child.CommandLine -like '*uvicorn*8770*') { Stop-Process -Id $child.ProcessId -ErrorAction SilentlyContinue }
    }
    Stop-Process -Id $item.pid -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath $statePath
Write-Output 'The public presentation link is stopped. Local app data is retained.'
