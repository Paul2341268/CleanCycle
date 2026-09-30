param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectDir = $PSScriptRoot
$runtimeDir = Join-Path $projectDir '.presentation'
$statePath = Join-Path $runtimeDir 'state.json'
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

if (Test-Path $statePath) {
    $previous = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($previous.serverPid)" -ErrorAction SilentlyContinue
    $tunnelProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($previous.tunnelPid)" -ErrorAction SilentlyContinue
    if ($serverProcess.CommandLine -like '*uvicorn*8770*' -and $tunnelProcess.ExecutablePath -eq (Join-Path $runtimeDir 'cloudflared.exe')) {
        Write-Output "Presentation URL: $($previous.url)"
        if (!$NoBrowser) { Start-Process $previous.url }
        exit 0
    }
    throw 'An old presentation process needs cleanup. Run Stop-Presentation.ps1 first.'
}

$pythonCandidates = @(
    (Join-Path $projectDir '.venv\Scripts\python.exe'),
    (Join-Path (Split-Path $projectDir) '.venv\Scripts\python.exe')
)
$pythonExe = $pythonCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (!$pythonExe) { throw 'Run setup.ps1 first to install the app dependencies.' }
if (!(Test-Path (Join-Path $projectDir 'frontend\dist\index.html'))) { throw 'Build the frontend before starting a presentation.' }
if (Get-NetTCPConnection -LocalPort 8770 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 8770 is already in use.' }

$tunnelExe = Join-Path $runtimeDir 'cloudflared.exe'
if (!(Test-Path $tunnelExe)) {
    Write-Output 'Downloading the official Cloudflare tunnel client...'
    $release = Invoke-RestMethod 'https://api.github.com/repos/cloudflare/cloudflared/releases/latest'
    $asset = $release.assets | Where-Object name -eq 'cloudflared-windows-amd64.exe' | Select-Object -First 1
    if (!$asset -or !$asset.digest -or !$asset.digest.StartsWith('sha256:')) { throw 'The official release is missing its verification digest.' }
    $downloadPath = Join-Path $runtimeDir 'cloudflared.download'
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $downloadPath
    $actual = (Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $asset.digest.Substring(7)) { throw 'Cloudflare download verification failed.' }
    Move-Item -LiteralPath $downloadPath -Destination $tunnelExe
}

$tunnelLog = Join-Path $runtimeDir 'tunnel.log'
$tunnel = Start-Process -FilePath $tunnelExe -ArgumentList 'tunnel','--url','http://127.0.0.1:8770','--no-autoupdate','--protocol','http2' -WindowStyle Hidden -RedirectStandardError $tunnelLog -RedirectStandardOutput (Join-Path $runtimeDir 'tunnel-output.log') -PassThru
$server = $null
try {
    $url = $null
    for ($attempt = 0; $attempt -lt 45; $attempt++) {
        if ($tunnel.HasExited) { throw 'The tunnel client stopped. Check .presentation/tunnel.log.' }
        $log = Get-Content -LiteralPath $tunnelLog -Raw -ErrorAction SilentlyContinue
        if ($log -match 'https://[a-z0-9-]+\.trycloudflare\.com') { $url = $Matches[0]; break }
        Start-Sleep -Seconds 1
    }
    if (!$url) { throw 'A public URL could not be obtained. Check your network connection.' }
    $server = Start-Process -FilePath $pythonExe -ArgumentList '-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8770','--proxy-headers','--forwarded-allow-ips','127.0.0.1' -WorkingDirectory (Join-Path $projectDir 'backend') -WindowStyle Hidden -RedirectStandardError (Join-Path $runtimeDir 'server.log') -RedirectStandardOutput (Join-Path $runtimeDir 'server-output.log') -PassThru
    $ready = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        try { $ready = (Invoke-RestMethod 'http://127.0.0.1:8770/api/health').status -eq 'ok' } catch { $ready = $false }
        if ($ready) { break }
        if ($server.HasExited) { throw 'The app server stopped. Check .presentation/server.log.' }
        Start-Sleep -Seconds 1
    }
    if (!$ready) { throw 'The presentation server did not start.' }
    @{url=$url; serverPid=$server.Id; tunnelPid=$tunnel.Id; startedAt=(Get-Date).ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $statePath
    Write-Output "Presentation URL: $url"
    Write-Output 'Other computers can open this HTTPS URL. Keep this PC on and connected.'
    Write-Output 'The URL changes after stopping and starting the presentation.'
    Write-Output 'Stop with: .\Stop-Presentation.ps1'
    if (!$NoBrowser) { Start-Process $url }
} catch {
    if ($server -and !$server.HasExited) { Stop-Process -Id $server.Id -ErrorAction SilentlyContinue }
    if (!$tunnel.HasExited) { Stop-Process -Id $tunnel.Id -ErrorAction SilentlyContinue }
    throw
}
