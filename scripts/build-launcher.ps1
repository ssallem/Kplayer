param([Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
$projectPath=Split-Path -Parent $PSScriptRoot
$outputPath=[IO.Path]::GetFullPath($Destination)
if(-not $outputPath.StartsWith($projectPath+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Launcher output must be inside the workspace.'}
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if(-not (Test-Path -LiteralPath $compiler)){throw 'The Windows .NET Framework compiler is required to build launchers.'}
Add-Type -AssemblyName System.Drawing
$bitmap=New-Object Drawing.Bitmap 256,256
$graphics=[Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([Drawing.Color]::Transparent)
$shape=New-Object Drawing.Drawing2D.GraphicsPath
foreach($arc in @(@(8,8,64,64,180,90),@(184,8,64,64,270,90),@(184,184,64,64,0,90),@(8,184,64,64,90,90))){$shape.AddArc($arc[0],$arc[1],$arc[2],$arc[3],$arc[4],$arc[5])}
$shape.CloseFigure()
$background=New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(215,248,139))
$foreground=New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(41,60,29))
$graphics.FillPath($background,$shape)
$graphics.FillPolygon($foreground,[Drawing.Point[]]@([Drawing.Point]::new(97,67),[Drawing.Point]::new(97,189),[Drawing.Point]::new(190,128)))
$memory=New-Object IO.MemoryStream
$bitmap.Save($memory,[Drawing.Imaging.ImageFormat]::Png)
$png=$memory.ToArray()
$iconPath=Join-Path $outputPath 'KPLAYER.ico'
$writer=New-Object IO.BinaryWriter ([IO.File]::Create($iconPath))
try {
  $writer.Write([uint16]0);$writer.Write([uint16]1);$writer.Write([uint16]1)
  $writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([byte]0)
  $writer.Write([uint16]1);$writer.Write([uint16]32);$writer.Write([uint32]$png.Length);$writer.Write([uint32]22);$writer.Write($png)
} finally {$writer.Dispose();$memory.Dispose();$graphics.Dispose();$bitmap.Dispose();$shape.Dispose();$background.Dispose();$foreground.Dispose()}
$manifestPath=Join-Path $projectPath 'launcher\app.manifest'
$sourcePath=Join-Path $projectPath 'launcher\Program.cs'
$binaryPath=Join-Path $outputPath 'KPLAYER-Connect.exe'
& $compiler /nologo /target:winexe /platform:anycpu /optimize+ "/win32icon:$iconPath" "/win32manifest:$manifestPath" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll "/out:$binaryPath" $sourcePath
if($LASTEXITCODE -ne 0){throw 'Launcher compilation failed.'}
Copy-Item -LiteralPath $binaryPath -Destination (Join-Path $outputPath 'KPLAYER-Offline.exe')
Get-Item -LiteralPath $binaryPath,(Join-Path $outputPath 'KPLAYER-Offline.exe') | Select-Object Name,Length
