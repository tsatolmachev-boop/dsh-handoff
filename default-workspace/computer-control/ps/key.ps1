# Нажатие комбинации клавиш по списку virtual-key кодов.
. (Join-Path $PSScriptRoot '_prelude.ps1')

$payload = $script:Payload
if (-not $payload) { throw 'missing payload' }
$names = $payload.PSObject.Properties.Name

$virtualKeys = @()
if ($names -contains 'keys') {
    foreach ($value in @($payload.keys)) { $virtualKeys += [int]$value }
}
if ($virtualKeys.Count -eq 0) { throw 'invalid keys: expected at least one virtual key' }
if ($virtualKeys.Count -gt 6) { throw "invalid keys: too many keys ($($virtualKeys.Count))" }

$tokens = @()
if ($names -contains 'tokens') {
    foreach ($value in @($payload.tokens)) { $tokens += [string]$value }
}

[DshWin]::PressKeys([int[]]$virtualKeys)
Start-Sleep -Milliseconds 60

Write-DshResult ([pscustomobject]@{
    keys  = $tokens
    count = [int]$virtualKeys.Count
})
