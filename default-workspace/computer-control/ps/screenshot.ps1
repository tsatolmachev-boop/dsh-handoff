# Снимок рабочего стола (все мониторы или один) в PNG.
. (Join-Path $PSScriptRoot '_prelude.ps1')

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$screens = [System.Windows.Forms.Screen]::AllScreens
$wantScreen = 0
if ($script:Payload -and ($script:Payload.PSObject.Properties.Name -contains 'screen') -and $null -ne $script:Payload.screen) {
    $wantScreen = [int]$script:Payload.screen
}

$monitors = @()
$monitorIndex = 1
foreach ($screen in $screens) {
    $monitors += [pscustomobject]@{
        index   = $monitorIndex
        name    = [string]$screen.DeviceName
        primary = [bool]$screen.Primary
        x       = [int]$screen.Bounds.X
        y       = [int]$screen.Bounds.Y
        width   = [int]$screen.Bounds.Width
        height  = [int]$screen.Bounds.Height
    }
    $monitorIndex++
}

if ($wantScreen -gt 0) {
    if ($wantScreen -gt $screens.Count) {
        throw "invalid screen: $wantScreen (available: $($screens.Count))"
    }
    $bounds = $screens[$wantScreen - 1].Bounds
} else {
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
}

if (-not $script:DshScreenshotDir) { throw 'DSH_CC_SHOTS is not set' }
if (-not (Test-Path -LiteralPath $script:DshScreenshotDir)) {
    New-Item -ItemType Directory -Path $script:DshScreenshotDir -Force | Out-Null
}

$bitmap = New-Object System.Drawing.Bitmap -ArgumentList $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bitmap.Size)

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$file = Join-Path $script:DshScreenshotDir ("shot-{0}.png" -f $stamp)
$bitmap.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()

try {
    Get-ChildItem -LiteralPath $script:DshScreenshotDir -Filter 'shot-*.png' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip 40 |
        Remove-Item -Force -ErrorAction SilentlyContinue
} catch { }

Write-DshResult ([pscustomobject]@{
    path     = $file
    width    = [int]$bounds.Width
    height   = [int]$bounds.Height
    monitors = $monitors
})
