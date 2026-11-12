# Вывод окна на передний план по подстроке заголовка.
#
# Windows ограничивает смену активного окна из фонового процесса (foreground
# lock). Обход: короткое нажатие Alt имитирует пользовательский ввод и снимает
# блокировку; после этого SetForegroundWindow обычно срабатывает. Если окно
# так и не стало активным, скрипт завершается ошибкой, чтобы модель не считала
# фокус установленным.
. (Join-Path $PSScriptRoot '_prelude.ps1')

$payload = $script:Payload
if (-not $payload) { throw 'missing payload' }
if (-not ($payload.PSObject.Properties.Name -contains 'title')) { throw 'invalid payload: title is required' }

$needle = [string]$payload.title
if ($needle.Length -eq 0) { throw 'invalid title: expected a non-empty substring' }

$window = $null
for ($attempt = 0; $attempt -lt 3; $attempt++) {
    if ($attempt -gt 0) {
        [DshWin]::PressKeys([int[]]@(0x12))
        Start-Sleep -Milliseconds 120
    }
    $window = [DshWin]::FindWindow($needle)
    if ($null -eq $window) { throw "window not found: $needle" }
    Start-Sleep -Milliseconds 150
    if ([DshWin]::IsForeground($window.hwnd)) { break }
}

if (-not [DshWin]::IsForeground($window.hwnd)) {
    throw "window found but Windows refused to activate it: $($window.title). The foreground window is still another application; check computer_windows and try again."
}

Start-Sleep -Milliseconds 100

Write-DshResult ([pscustomobject]@{
    hwnd        = ('0x{0:X}' -f $window.hwnd)
    title       = [string]$window.title
    processName = [string]$window.processName
    pid         = [int]$window.pid
})
