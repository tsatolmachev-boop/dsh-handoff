# DSH handoff

Исходники плагинов + runbook для установки DSH на домашнем ПК.

**Публичная ссылка (вход не нужен):** https://github.com/tsatolmachev-boop/dsh-handoff

## Скачать всё одним архивом

https://github.com/tsatolmachev-boop/dsh-handoff/archive/refs/heads/main.zip

Распакуй, внутри будет папка `dsh-handoff-main\default-workspace` — передай Codex полный путь к ней.

## Или клонировать

```powershell
git clone https://github.com/tsatolmachev-boop/dsh-handoff.git "$env:USERPROFILE\dsh-handoff"
$WS = (Resolve-Path "$env:USERPROFILE\dsh-handoff\default-workspace").Path
Test-Path (Join-Path $WS 'chrome-browser-agent\dsh-bundle\package.json')
```

## Дальше

Передай Codex путь `$WS` и продолжай Фазу 1 runbook `DSH_home_PC.md`.

## Офлайн-варианты (без GitHub)

`DSH_handoff.bundle` (git bundle) или `DSH_исходники_плагинов.zip` — лежат в OneDrive-папке `deepseek-harness`.