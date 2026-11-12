# Список видимых окон верхнего уровня.
. (Join-Path $PSScriptRoot '_prelude.ps1')

$includeUntitled = $false
if ($script:Payload -and ($script:Payload.PSObject.Properties.Name -contains 'all')) {
    $includeUntitled = [bool]$script:Payload.all
}

$entries = [DshWin]::ListWindows($includeUntitled)
$windows = @()
foreach ($entry in $entries) {
    $windows += [pscustomobject]@{
        hwnd        = ('0x{0:X}' -f $entry.hwnd)
        title       = [string]$entry.title
        className   = [string]$entry.className
        pid         = [int]$entry.pid
        processName = [string]$entry.processName
        x           = [int]$entry.x
        y           = [int]$entry.y
        width       = [int]$entry.width
        height      = [int]$entry.height
        minimized   = [bool]$entry.minimized
        foreground  = [bool]$entry.foreground
    }
}

$foregroundTitle = $null
foreach ($entry in $entries) {
    if ($entry.foreground) { $foregroundTitle = [string]$entry.title; break }
}

Write-DshResult ([pscustomobject]@{
    foreground = $foregroundTitle
    count      = $windows.Count
    windows    = $windows
})
