# Прокрутка колесом мыши.
. (Join-Path $PSScriptRoot '_prelude.ps1')

$payload = $script:Payload
if (-not $payload) { throw 'missing payload' }
$names = $payload.PSObject.Properties.Name

if (-not ($names -contains 'direction')) { throw 'invalid payload: direction is required' }
$direction = [string]$payload.direction
if ($direction -notin @('up', 'down')) { throw "invalid direction: $direction (expected up or down)" }

$clicks = 3
if (($names -contains 'clicks') -and ($null -ne $payload.clicks)) { $clicks = [int]$payload.clicks }
if ($clicks -lt 1 -or $clicks -gt 50) { throw "invalid clicks: $clicks (expected 1..50)" }

$hasX = ($names -contains 'x') -and ($null -ne $payload.x)
$hasY = ($names -contains 'y') -and ($null -ne $payload.y)
if ($hasX -ne $hasY) { throw 'invalid payload: x and y must be provided together' }
if ($hasX) {
    [DshWin]::MoveTo([int]$payload.x, [int]$payload.y) | Out-Null
    Start-Sleep -Milliseconds 30
}

[DshWin]::Wheel($direction, $clicks)

Write-DshResult ([pscustomobject]@{
    direction = $direction
    clicks    = $clicks
})
