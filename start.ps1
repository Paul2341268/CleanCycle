param([int]$Port = 8765)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $pythonPath)) { $pythonPath = Join-Path (Split-Path $projectRoot -Parent) '.venv\Scripts\python.exe' }
if (-not (Test-Path $pythonPath)) { throw 'Run setup.ps1 first. See README.md.' }
if (-not (Test-Path (Join-Path $projectRoot 'frontend\dist\index.html'))) { throw 'Build the frontend first. See README.md.' }
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Choose a port between 1024 and 65535.' }
Write-Host "CleanCycle: http://127.0.0.1:$Port/ (Ctrl+C to stop)"
Push-Location (Join-Path $projectRoot 'backend')
try { & $pythonPath -m uvicorn app.main:app --host 127.0.0.1 --port $Port }
finally { Pop-Location }
