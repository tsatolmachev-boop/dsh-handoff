# DSH handoff

Исходники плагинов + runbook для установки DSH на домашнем ПК.

## GitHub (этот репозиторий, private)

```powershell
git clone https://github.com/tsatolmachev-boop/dsh-handoff.git "$env:USERPROFILE\dsh-handoff"
$WS = (Resolve-Path "$env:USERPROFILE\dsh-handoff\default-workspace").Path
Test-Path (Join-Path $WS 'chrome-browser-agent\dsh-bundle\package.json')
```

Без Git: на странице репозитория Code → Download ZIP, распакуй и используй путь к `default-workspace`.

## Git bundle (офлайн)

```powershell
git clone "<путь к DSH_handoff.bundle>" "$env:USERPROFILE\dsh-handoff"
$WS = (Resolve-Path "$env:USERPROFILE\dsh-handoff\default-workspace").Path
```

Дальше передай Codex полный путь `$WS` и продолжай Фазу 1 runbook `DSH_home_PC.md`.