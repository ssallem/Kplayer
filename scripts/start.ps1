param([switch]$NoBrowser, [ValidateSet('internet','offline')][string]$Mode='internet')
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectPath
$serverPort = if($Mode -eq 'offline'){3213}else{3210}
$serverUrl = "http://localhost:$serverPort"
try {
    $running = Invoke-RestMethod "$serverUrl/api/state" -TimeoutSec 2
    if ($null -ne $running.cast) { if (-not $NoBrowser) { Start-Process $serverUrl }; exit 0 }
} catch {}
$nodeCommand=Join-Path $projectPath 'runtime/node.exe'
if(-not (Test-Path -LiteralPath $nodeCommand)) { $nodeCommand=(Get-Command node -ErrorAction SilentlyContinue).Source }
if (-not $nodeCommand) {
    throw 'Node.js 22 LTS or newer is required. Install it from https://nodejs.org.'
}
if (-not (Test-Path -LiteralPath (Join-Path $projectPath 'node_modules'))) {
    if($Mode -eq 'offline'){ throw 'Offline mode requires an already installed package. Run the installer while online first.' }
    & npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
if (-not (Test-Path -LiteralPath (Join-Path $projectPath 'dist/index.html'))) {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
}
$logPath = Join-Path $projectPath 'data'
if($Mode -eq 'offline') { $logPath=Join-Path $logPath 'offline' }
New-Item -ItemType Directory -Force -Path $logPath | Out-Null
$serverScript = '"' + (Join-Path $projectPath 'server/index.js') + '"'
$env:KPLAYER_MODE=$Mode
$env:PORT=[string]$serverPort
$serverProcess = Start-Process -FilePath $nodeCommand -ArgumentList $serverScript,'--production' -WorkingDirectory $projectPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logPath 'server.log') -RedirectStandardError (Join-Path $logPath 'server-error.log') -PassThru
$serverProcess.Id | Set-Content -LiteralPath (Join-Path $logPath 'server.pid')
for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try {
        $running = Invoke-RestMethod "$serverUrl/api/state" -TimeoutSec 1
        if ($null -ne $running.cast) { if (-not $NoBrowser) { Start-Process $serverUrl }; exit 0 }
    } catch {}
    Start-Sleep -Milliseconds 250
}
throw 'KPLAYER could not start. Check data/server-error.log.'
