param([ValidateSet('internet','offline')][string]$Mode='internet')
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $projectPath 'data/server.pid'
if($Mode -eq 'offline'){$pidFile=Join-Path $projectPath 'data/offline/server.pid'}
$serverPort=if($Mode -eq 'offline'){3213}else{3210}
try { Invoke-RestMethod "http://localhost:$serverPort/api/shutdown" -Method Post -TimeoutSec 12 | Out-Null; exit 0 }catch{}
if (Test-Path -LiteralPath $pidFile) {
    $serverId = [int](Get-Content -LiteralPath $pidFile)
    $serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $serverId"
    $expectedScript = [regex]::Escape((Join-Path $projectPath 'server/index.js'))
    if ($serverProcess.Name -eq 'node.exe' -and $serverProcess.CommandLine -match $expectedScript -and $serverProcess.CommandLine -match '--production') {
        Stop-Process -Id $serverId
    }
    Remove-Item -LiteralPath $pidFile
}
