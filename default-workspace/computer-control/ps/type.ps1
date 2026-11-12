# Ввод текста в сфокусированный элемент через Unicode SendInput.
. (Join-Path $PSScriptRoot '_prelude.ps1')

$payload = $script:Payload
if (-not $payload) { throw 'missing payload' }
$names = $payload.PSObject.Properties.Name

if (-not ($names -contains 'text')) { throw 'invalid payload: text is required' }
$text = [string]$payload.text
if ($text.Length -eq 0) { throw 'invalid text: expected a non-empty string' }

$delayMs = 0
if (($names -contains 'delayMs') -and ($null -ne $payload.delayMs)) {
    $delayMs = [int]$payload.delayMs
    if ($delayMs -lt 0 -or $delayMs -gt 500) { throw "invalid delayMs: $delayMs (expected 0..500)" }
}

$enter = $false
if (($names -contains 'enter') -and $null -ne $payload.enter) { $enter = [bool]$payload.enter }

[DshWin]::TypeUnicode($text, $delayMs)
if ($enter) {
    Start-Sleep -Milliseconds 40
    [DshWin]::PressKeys([int[]]@(0x0D))
}

Write-DshResult ([pscustomobject]@{
    chars = [int]$text.Length
    enter = $enter
})
