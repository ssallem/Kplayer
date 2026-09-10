$ErrorActionPreference='Stop'
$projectPath=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectPath
$packagePath=Join-Path $projectPath 'build/KPLAYER-Windows'
if(Test-Path -LiteralPath $packagePath){throw 'Package directory exists. Choose a fresh build directory before packaging.'}
New-Item -ItemType Directory -Path $packagePath | Out-Null
foreach($directory in @('server','shared','scripts','dist')) { Copy-Item -LiteralPath (Join-Path $projectPath $directory) -Destination (Join-Path $packagePath $directory) -Recurse }
New-Item -ItemType Directory -Path (Join-Path $packagePath 'public') | Out-Null
Copy-Item -LiteralPath (Join-Path $projectPath 'public/tv.html') -Destination (Join-Path $packagePath 'public/tv.html')
foreach($file in @('package.json','package-lock.json','README.md','SECURITY.md','LICENSE','KPLAYER.vbs','KPLAYER-stop.vbs','KPLAYER-Offline.vbs','KPLAYER-Offline-stop.vbs')) {Copy-Item -LiteralPath (Join-Path $projectPath $file) -Destination (Join-Path $packagePath $file)}
& npm.cmd ci --omit=dev --ignore-scripts --no-audit --no-fund --prefix $packagePath
if($LASTEXITCODE -ne 0){throw 'Production dependency install failed.'}
New-Item -ItemType Directory -Path (Join-Path $packagePath 'runtime') | Out-Null
Copy-Item -LiteralPath (Get-Command node).Source -Destination (Join-Path $packagePath 'runtime/node.exe')
$nodeVersion= & node -p 'process.version'
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/nodejs/node/$nodeVersion/LICENSE" -OutFile (Join-Path $packagePath 'runtime/LICENSE-Node.txt')
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath=Join-Path $projectPath 'build/KPLAYER-Windows.zip'
[System.IO.Compression.ZipFile]::CreateFromDirectory($packagePath,$zipPath)
Get-FileHash -LiteralPath $zipPath -Algorithm SHA256 | Select-Object Hash
