# Клик мышью в текущей точке или в заданных координатах.
. (Join-Path $PSScriptRoot '_prelude.ps1')

$payload = $script:Payload
if (-not $payload) { throw 'missing payload' }

$names = $payload.PSObject.Properties.Name
$hasX = ($names -contains 'x') -and ($null -ne $payload.x)
$hasY = ($names -contains 'y') -and ($null -ne $payload.y)
if ($hasX -ne $hasY) { throw 'invalid payload: x and y must be provided together' }
if ($hasX) {
    [DshWin]::MoveTo([int]$payload.x, [int]$payload.y) | Out-Null
    Start-Sleep -Milliseconds 30
}

$button = 'left'
if (($names -contains 'button') -and $payload.button) { $button = [string]$payload.button }
if ($button -notin @('left', 'right', 'middle')) { throw "invalid button: $button (expected left, right or middle)" }

$count = 1
if (($names -contains 'count') -and ($null -ne $payload.count)) { $count = [int]$payload.count }
if ($count -lt 1 -or $count -gt 10) { throw "invalid count: $count (expected 1..10)" }

[DshWin]::Click($button, $count)
Start-Sleep -Milliseconds 30

Write-DshResult ([pscustomobject]@{
    x      = [int][DshWin]::MouseX()
    y      = [int][DshWin]::MouseY()
    button = $button
    count  = $count
})
