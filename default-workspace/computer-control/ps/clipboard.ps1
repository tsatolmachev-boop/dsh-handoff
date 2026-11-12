# Чтение и запись текстового буфера обмена Windows.
. (Join-Path $PSScriptRoot '_prelude.ps1')

Add-Type -AssemblyName System.Windows.Forms

$payload = $script:Payload
if (-not $payload) { throw 'missing payload' }
$names = $payload.PSObject.Properties.Name
if (-not ($names -contains 'action')) { throw 'invalid payload: action is required' }
$action = [string]$payload.action

function Read-ClipboardText {
    for ($attempt = 0; $attempt -lt 8; $attempt++) {
        try {
            $value = [System.Windows.Forms.Clipboard]::GetText()
            if ($null -eq $value) { return '' }
            return [string]$value
        } catch {
            Start-Sleep -Milliseconds 100
        }
    }
    throw 'clipboard is busy: could not read it after retries'
}

if ($action -eq 'get') {
    $text = Read-ClipboardText
    Write-DshResult ([pscustomobject]@{ action = 'get'; text = $text })
    return
}

if ($action -eq 'set') {
    if (-not ($names -contains 'text')) { throw 'invalid payload: text is required for action "set"' }
    $text = [string]$payload.text
    $written = $false
    for ($attempt = 0; $attempt -lt 8 -and -not $written; $attempt++) {
        try {
            [System.Windows.Forms.Clipboard]::SetText($text)
            $written = $true
        } catch {
            Start-Sleep -Milliseconds 100
        }
    }
    if (-not $written) { throw 'clipboard is busy: could not write it after retries' }
    $readBack = Read-ClipboardText
    Write-DshResult ([pscustomobject]@{ action = 'set'; text = $readBack })
    return
}

throw "invalid action: $action (expected get or set)"
