# DSH handoff (git bundle)

Этот репозиторий содержит исходники плагинов для установки DSH на домашнем ПК.

## Клонирование на домашнем ПК

```powershell
git clone "<путь к DSH_handoff.bundle>" "$env:USERPROFILE\dsh-handoff"
$WS = (Resolve-Path "$env:USERPROFILE\dsh-handoff\default-workspace").Path
Test-Path (Join-Path $WS 'chrome-browser-agent\dsh-bundle\package.json')
```

Дальше передай Codex путь `$WS` (полный) и продолжай Фазу 1 runbook `DSH_home_PC.md`.

Если Git не установлен: https://git-scm.com/download/win (или используй DSH_исходники_плагинов.zip).