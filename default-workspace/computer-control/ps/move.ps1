# Перемещение курсора мыши в абсолютные координаты виртуального рабочего стола.
. (Join-Path $PSScriptRoot '_prelude.ps1')

$payload = $script:Payload
if (-not $payload) { throw 'missing payload' }
if (-not ($payload.PSObject.Properties.Name -contains 'x') -or -not ($payload.PSObject.Properties.Name -contains 'y')) {
    throw 'invalid payload: x and y are required'
}

$x = [int]$payload.x
$y = [int]$payload.y
[DshWin]::MoveTo($x, $y) | Out-Null
Start-Sleep -Milliseconds 20

Write-DshResult ([pscustomobject]@{
    x = [int][DshWin]::MouseX()
    y = [int][DshWin]::MouseY()
})
