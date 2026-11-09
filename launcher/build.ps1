# 编译桌面启动器（.NET Framework 4.x + WebView2），输出到绿色版目录
$ErrorCode = 0
$root = Split-Path -Parent $PSScriptRoot
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
    $csc = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
if (-not (Test-Path $csc)) {
    throw "未找到 csc.exe，请安装 .NET Framework 4.x"
}

$outDir = Join-Path $PSScriptRoot "out"
$distDir = Join-Path $root "dist\南空提瓦特小助手"
$libsDir = Join-Path $PSScriptRoot "libs"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
New-Item -ItemType Directory -Force -Path $distDir | Out-Null
New-Item -ItemType Directory -Force -Path $libsDir | Out-Null

# 首次编译时自动下载 WebView2 SDK（之后复用 launcher/libs）
if (-not (Test-Path (Join-Path $libsDir "WebView2Loader.dll"))) {
    $zipPath = Join-Path $PSScriptRoot "webview2.zip"
    $pkgDir = Join-Path $PSScriptRoot "webview2-pkg"
    Write-Host "正在下载 WebView2 SDK…"
    Invoke-WebRequest -Uri "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/1.0.2903.40" `
        -OutFile $zipPath -UseBasicParsing
    Expand-Archive -Path $zipPath -DestinationPath $pkgDir -Force
    Copy-Item (Join-Path $pkgDir "lib\net462\Microsoft.Web.WebView2.Core.dll") $libsDir -Force
    Copy-Item (Join-Path $pkgDir "lib\net462\Microsoft.Web.WebView2.WinForms.dll") $libsDir -Force
    Copy-Item (Join-Path $pkgDir "runtimes\win-x64\native\WebView2Loader.dll") $libsDir -Force
}

# 生成应用图标（深色底 + 金色 SA）
$iconPath = Join-Path $PSScriptRoot "southair.ico"
if (-not (Test-Path $iconPath)) {
    Add-Type -AssemblyName System.Drawing
    $bmp = New-Object System.Drawing.Bitmap 256, 256
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $rect = [System.Drawing.Rectangle]::new(8, 8, 240, 240)
    $brush = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rect,
        [System.Drawing.Color]::FromArgb(242, 226, 189),
        [System.Drawing.Color]::FromArgb(196, 165, 110),
        [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
    $g.FillRectangle($brush, $rect)
    $brush.Dispose()
    $font = [System.Drawing.Font]::new("Segoe UI", 100, [System.Drawing.FontStyle]::Bold)
    $textBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(27, 26, 22))
    $format = [System.Drawing.StringFormat]::new()
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $g.DrawString("SA", $font, $textBrush, [System.Drawing.RectangleF]::new(0, 0, 256, 256), $format)
    $font.Dispose()
    $textBrush.Dispose()
    $g.Dispose()
    $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
    $stream = [System.IO.File]::Create($iconPath)
    $icon.Save($stream)
    $stream.Close()
    $icon.Dispose()
    $bmp.Dispose()
}

$refs = @(
    "System.dll",
    "System.Core.dll",
    "System.Drawing.dll",
    "System.Windows.Forms.dll",
    "System.IO.Compression.dll",
    "System.IO.Compression.FileSystem.dll",
    "System.Management.dll",
    (Join-Path $PSScriptRoot "libs\Microsoft.Web.WebView2.Core.dll"),
    (Join-Path $PSScriptRoot "libs\Microsoft.Web.WebView2.WinForms.dll")
)
$refArgs = $refs | ForEach-Object { "/reference:`"$_`"" }

$manifest = Join-Path $PSScriptRoot "app.manifest"

& $csc /nologo /target:winexe /optimize /codepage:65001 /utf8output `
    "/win32icon:$iconPath" `
    "/win32manifest:$manifest" `
    "/out:$outDir\南空提瓦特小助手.exe" `
    $refArgs `
    (Join-Path $PSScriptRoot "SouthAirLauncher.cs")
if ($LASTEXITCODE -ne 0) {
    throw "启动器编译失败（退出码 $LASTEXITCODE）"
}

Copy-Item (Join-Path $outDir "南空提瓦特小助手.exe") $distDir -Force
# 同时留一份到 release 目录，由 GitHub Actions 作为 Release 资产发布（用于 exe 自动更新）
$releaseDir = Join-Path $PSScriptRoot "release"
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
Copy-Item (Join-Path $outDir "南空提瓦特小助手.exe") (Join-Path $releaseDir "SouthAirLauncher.exe") -Force
# 清理旧名字的可执行文件，避免绿色版里同时出现两个启动器
$legacyExe = Join-Path $distDir "SouthAirGenshin.exe"
if (Test-Path $legacyExe) { Remove-Item $legacyExe -Force -ErrorAction SilentlyContinue }
Copy-Item (Join-Path $PSScriptRoot "libs\Microsoft.Web.WebView2.Core.dll") $distDir -Force
Copy-Item (Join-Path $PSScriptRoot "libs\Microsoft.Web.WebView2.WinForms.dll") $distDir -Force
Copy-Item (Join-Path $PSScriptRoot "libs\WebView2Loader.dll") $distDir -Force

Write-Host "启动器已输出到 $distDir\南空提瓦特小助手.exe"




