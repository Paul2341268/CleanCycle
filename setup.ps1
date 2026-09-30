$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$venv = Join-Path $projectRoot '.venv'
$python = Join-Path $venv 'Scripts\python.exe'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22 or later (including npm), then reopen PowerShell.' }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm.cmd was not found. Install Node.js including npm, then reopen PowerShell.' }
if ([int]((& node -p 'process.versions.node.split(".")[0]') | Select-Object -Last 1) -lt 22) { throw 'Node.js 22 or later is required.' }
if (-not (Test-Path $python)) {
    if (Get-Command py -ErrorAction SilentlyContinue) { & py -3 -m venv $venv }
    elseif (Get-Command python -ErrorAction SilentlyContinue) { & python -m venv $venv }
    else { throw 'Install Python 3.11 or later and enable its launcher or PATH option.' }
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create the Python environment.' }
}
& $python -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'
if ($LASTEXITCODE -ne 0) { throw 'Python 3.11 or later is required.' }
& $python -m pip install -r (Join-Path $projectRoot 'backend\requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Backend dependency installation failed.' }
Push-Location (Join-Path $projectRoot 'frontend')
try {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
} finally { Pop-Location }
$envFile = Join-Path $projectRoot 'backend\.env'
if (-not (Test-Path $envFile)) { Copy-Item -LiteralPath (Join-Path $projectRoot 'backend\.env.example') -Destination $envFile }
Write-Host 'Setup complete. Optional: enter public API keys in backend/.env. Run .\start.ps1 next.'
