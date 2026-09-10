param([Parameter(Mandatory=$true)][string]$PackagePath)
$ErrorActionPreference='Stop'
$packageRoot=[IO.Path]::GetFullPath($PackagePath)
foreach($name in @('KPLAYER-Connect.exe','KPLAYER-Offline.exe')) {
  $executable=Join-Path $packageRoot $name
  foreach($check in @('--check-package','--smoke-test')) {
    $process=Start-Process -FilePath $executable -ArgumentList $check -WindowStyle Hidden -PassThru
    if(-not $process.WaitForExit(45000)){throw "$name $check timed out (PID $($process.Id))."}
    if($process.ExitCode -ne 0){throw "$name $check failed with exit code $($process.ExitCode)."}
    Write-Output "$name $check passed"
  }
}
