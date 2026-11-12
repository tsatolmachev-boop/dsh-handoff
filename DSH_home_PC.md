# DSH на домашний ПК — хэндофф + полный runbook (всё в одном файле)

> **Как пользоваться:** на домашнем ПК передай Codex весь этот файл (или скажи ему прочитать его). Раздел A — состояние эталона и общий порядок действий. Раздел B — полный runbook: промт для Codex (Часть 1), резервное сообщение для DSH-агента (Часть 2), памятка (Часть 3). Codex здесь, на рабочей машине, не вызывается — это документ для передачи.

---

# РАЗДЕЛ A. ХЭНДОФФ

## 1. Суть задачи

Установить на домашний ПК **DeepSeek Harness (DSH)** и воспроизвести рабочую настройку: **10 бандлов/инстансов**, **Chrome-расширение «DSH Browser Agent»** (браузерный мост на `127.0.0.1:8787`), **Codex-субагента**, настройки по эталону. Пользователь не программист: вход в аккаунты и загрузку расширения в Chrome он выполняет сам.

Требования: Windows 10/11 x64, ~10 ГБ свободно, интернет, Chrome, аккаунт DeepSeek, выполненный вход в Codex (для субагента), доступ к OneDrive-папке проекта.

---

## 2. Состояние эталона (что воспроизвести)

- **DSH:** Desktop `0.2.1-rc.5` (nightly), установлен в `%LOCALAPPDATA%\Programs\DeepSeek Harness`; CLI — `...\resources\runtime\cli\bin\dsh.cmd` (лежит в PATH); `DSH_HOME` стандартный: `%USERPROFILE%\.dsh`.
- **Профиль:** `%USERPROFILE%\.dsh\profiles\desktop`.
- **Бандлы (порядок в `dsh.profile.bundles`):**
  1. `@deepseek-ai/dsh-base`
  2. `@deepseek-ai/dsh-web-app`
  3. `@deepseek-ai/dsh-experimental-agent-team-profile`
  4. `@deepseek-ai/dsh-experimental-voice-input-bundle`
  5. `@deepseek-ai/dsh-experimental-auto-review`
  6. `@deepseek-ai/dsh-experimental-inspector-profile`
  7. `@deepseek-ai/dsh-subagent-codex`
  8. `@local/sidebar-quick-notes-ru`
  9. `@local/dsh-browser-bridge`
  10. `@local/dsh-computer-control`
- **Исходники плагинов (только отсюда, в интернете их нет):** `<OneDrive>\Документы\deepseek-harness\default-workspace` — папки `chrome-browser-agent` (bridge, extension, chat, dsh-bundle), `computer-control`, `quick-notes-ru`.
- **Браузер:** Chrome, расширение `chrome-browser-agent\extension` (MV3, v2.2.0); мост `8787`; панельный чат: второй мост `8788`, chat-server `8792` (опционально).
- **Настройки эталона:** модель `deepseek-flash` (аккаунт DeepSeek), reasoning max; разрешения `danger-full-access`; тема light; пресеты read-only/workspace-write — с подтверждением; субагенты maxDepth 8, модели `deepseek-flash` + `deepseek-v4-pro`; веб-поиск/фетч — deepseek-*-api; пресет по умолчанию `cordis` (Create).
- **Проверенные установщики (официальный домен):**
  - `https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.2-rc.2-win-x64.exe` — 299 659 528 байт, Authenticode Valid (CN=Hangzhou DeepSeek Artificial Intelligence Co., Ltd.), SHA-512 (base64) `5rRAkVruKkm4KELAbTqV8ZFrMwSo3oESnzXb9ebkJWPCMe6WuHORQZR63uY+BqAc6sBdyBtwSelsCGh0k1NcJA==` — проверено.
  - `...-0.2.2-rc.1-win-x64.exe` — 293 425 336 байт.
  - `...-0.2.1-rc.5-win-x64.exe` — 289 408 544 байт (точная копия версии эталона, запасной вариант).
- **Ключевые ловушки:**
  - В `dsh-bundle\cordis.patch.yml` браузерного моста **жёстко прописаны абсолютные пути** (`node.exe`, `bridge.cjs`, скриншоты) — на домашнем ПК их надо переписать под локальную копию.
  - Плагины ставятся **из локальных копий** `%LOCALAPPDATA%\dsh-home` (OneDrive-оригиналы не трогать; облачные заглушки Files On-Demand ненадёжны).
  - Профиль `desktop` управляется только Electron-приложением: `dsh plugin --profile desktop ...` не работает — бандлы включаются через страницу «Плагины» в UI DSH (или через DSH-агента, маршрут 2).
  - Вход в DeepSeek, загрузка расширения в Chrome и подтверждение build-scripts — только вручную.

---

## 3. Что уже сделано

- Проверен эталон на рабочей машине: профиль, список бандлов, порты, расширение, пути, настройки.
- Проверены официальные установщики (размер + Authenticode + SHA-512 для 0.2.2-rc.2).
- Полный runbook включён в раздел B этого файла: Часть 1 — промт для Codex, Часть 2 — резервное сообщение для DSH-агента, Часть 3 — памятка.
- На домашнем ПК пока ничего не установлено.

---

## 4. Как действовать (передача)

1. Codex выполняет Часть 1 раздела B по фазам 0–9.
2. Останавливается на ручных точках: вход в аккаунт DeepSeek в окне DSH, «Загрузить распакованное» в Chrome, подтверждение установочных скриптов/прав, перезапуски DSH.
3. При проблемах с установкой бандлов через UI — использует Часть 2 (сообщение для DSH-агента; пресет Create/cordis, danger-full-access или подтверждения).
4. Если локальные плагины несовместимы с 0.2.2-rc.2 — откат на 0.2.1-rc.5 по разделу 5C runbook (данные `%USERPROFILE%\.dsh` сохранять).
5. В конце — отчёт `%USERPROFILE%\dsh-home-setup\REPORT.md` и копия в `<WS>\dsh-home-setup\received\REPORT-*.md` (вернётся на рабочий ПК по OneDrive).

---

## 5. Definition of Done (чек-лист)

- [ ] DSH запускается, пользователь вошёл в аккаунт DeepSeek; версия зафиксирована (`dsh --version`).
- [ ] В `%USERPROFILE%\.dsh\profiles\desktop\package.json` — все 10 бандлов (8 внешних + base/web-app), локальные зависимости `@local/*` установлены.
- [ ] Страница «Плагины» не показывает ошибок; DSH стабильно перезапускается.
- [ ] Chrome: расширение «DSH Browser Agent» загружено, панель «Подключено», порт `8787` слушается, `GET /api/status` → `ext.connected: true`.
- [ ] В чате DSH работают: `browser_status`; `computer_windows` + `computer_screenshot`; `subagent_codex` (ответ `OK-DSH`); пункт «Быстрые заметки» в боковой панели.
- [ ] Настройки по эталону применены (или зафиксированы отклонения — например, безопасный режим разрешений).
- [ ] Отчёт записан и скопирован в OneDrive.

---

## 6. Где нужен человек (не автоматизируется)

- Вход в аккаунт DeepSeek в окне приветствия DSH (возможно — обновление приложения).
- Загрузка неупакованного расширения в Chrome и открытие его панели.
- Подтверждение установочных скриптов pnpm (build scripts) для официальных бандлов.
- Подтверждение перезапуска DSH и неоднозначных решений (смена версии, откат).
- Вход в Codex на домашнем ПК (для Codex-субагента).

---

## 7. Запреты и риски

- Не копировать `~/.dsh/.credentials.yaml`, `~/.codex/auth.json`, токены/пароли — аккаунты на домашнем ПК входят отдельно.
- Не менять файлы в OneDrive-папке `deepseek-harness` (общие исходники); работать с копиями.
- Не скачивать установщик с зеркал/сторонних сайтов — только `download.deepseek.com` + проверка подписи.
- Не отключать Defender/SmartScreen; не удалять данные `%USERPROFILE%\.dsh` без подтверждения.
- `danger-full-access` в настройках — полный доступ агента; пользователь вправе выбрать безопасный режим.

---

## 8. Структура этого файла

| Раздел | Назначение |
|---|---|
| **A. Хэндофф** (выше) | Состояние эталона, что воспроизвести, чек-лист, ручные точки, запреты. |
| **B. Полный runbook** (ниже) | Часть 1 — промт для Codex (по фазам 0–9). Часть 2 — резервное сообщение для DSH-агента, если UI не справился. Часть 3 — короткая памятка. |

---

# РАЗДЕЛ B. ПОЛНЫЙ RUNBOOK

# ПРОМТ: установить DeepSeek Harness на домашний ПК (все инстансы, как на рабочем)

> **Как пользоваться:** открой этот файл на домашнем ПК, скопируй ВЕСЬ текст ниже и вставь одним сообщением в Codex. Дальше Codex ведёт установку; тебе нужно только войти в аккаунт DeepSeek в окне DSH, загрузить расширение в Chrome и подтвердить пару запросов. Не запускай промт частями.

**Что будет установлено:** DSH Desktop + все 10 бандлов/инстансов — ядро, веб-интерфейс, Agent Teams, голосовой ввод, авто-ревью, инспектор, Codex-субагент, быстрые заметки, браузерный агент Chrome, управление компьютером — и настройки как на рабочем ПК.
**Требования:** Windows 10/11 x64, ~10 ГБ свободно, интернет, Chrome, аккаунт DeepSeek, выполненный вход в Codex, папка `deepseek-harness\default-workspace` из OneDrive (или её копия).
**Если что-то пойдёт не так:** Codex сам использует резервный маршрут из Части 2; ручная памятка — в Части 3.

---

# ЧАСТЬ 1. ПРОМТ ДЛЯ CODEX

# ПРОМТ ДЛЯ CODEX: развернуть DeepSeek Harness на домашнем Windows-ПК (полная копия рабочей настройки)

<!--
КАК ПОЛЬЗОВАТЬСЯ (это пояснение для человека, Codex может его игнорировать):
1. Открой этот файл на домашнем ПК (он лежит в корне OneDrive-папки deepseek-harness).
2. Скопируй ВЕСЬ текст файла и вставь одним сообщением в Codex.
3. Дальше Codex сам ведёт установку; тебе нужно только выполнять то, что он попросит:
   войти в аккаунт DeepSeek в окне DSH, загрузить расширение в Chrome, разрешить установки.
4. Не запускай промт частями и не закрывай Codex до финального отчёта.
-->

## 0. ТВОЯ РОЛЬ И МИССИЯ

Ты — Codex, инженер-установщик. Ты работаешь на **домашнем Windows 10/11 x64 ПК** пользователя и должен с нуля развернуть на нём **DeepSeek Harness (DSH)** — десктопное приложение DeepSeek — и воспроизвести на нём **ту же рабочую настройку, что на рабочем ПК пользователя**: все плагины-инстансы, Codex-субагента, браузерного агента Chrome, управление компьютером, быстрые заметки, нужные настройки.

Работай последовательно по фазам. После каждой фазы давай пользователю короткий отчёт (3–6 строк) и продолжай. Останавливайся (СТОП) только там, где физически нужно действие человека: вход в аккаунт, установка расширения в Chrome, подтверждение прав/установочных скриптов, решение при неоднозначной ошибке.

**Критерий готовности (DoD):**
1. DSH установлен, запускается, пользователь вошёл в свой аккаунт DeepSeek.
2. В профиле `desktop` включены все 8 внешних бандлов (5 официальных + 3 локальных, список в Приложении A) — итого 10 позиций вместе с базовыми.
3. В чате DSH работают инструменты: `browser_status` (браузер подключён), `computer_windows`/`computer_screenshot`, `subagent_codex`; в боковой панели есть «Быстрые заметки».
4. Расширение «DSH Browser Agent» загружено в Chrome, панель показывает «Подключено» (порт 8787).
5. Записан финальный отчёт (`REPORT.md`) и копия отчёта в OneDrive-папке проекта.

Ориентировочное время: 30–60 минут (из них ~300 МБ загрузки установщика).

---

## 1. ЭТАЛОН: что должно получиться

Эталон — рабочий ПК пользователя. Там сейчас:
- Windows 10/11 x64, DSH Desktop **0.2.1-rc.5** (nightly-канал), профиль `desktop`.
- Профиль: `%USERPROFILE%\.dsh\profiles\desktop`.
- 10 бандлов в `dsh.profile.bundles` (порядок важен, см. Приложение A).
- Браузерный мост слушает `127.0.0.1:8787`, расширение Chrome «DSH Browser Agent» v2.2.0.
- Панельный чат (опционально): второй мост `8788` + chat-server `http://127.0.0.1:8792`.
- Исходники плагинов лежат в OneDrive-папке `deepseek-harness\default-workspace`.

На домашнем ПК должно быть то же самое. Версия DSH — самая свежая официальная сборка (на момент составления промта: `0.2.2-rc.2`); если локальные плагины на ней не заведутся — откат на `0.2.1-rc.5` (та же, что на эталоне), см. раздел **5C**.

**Важно:** исходники плагинов (`chrome-browser-agent`, `computer-control`, `quick-notes-ru`) — это локальные проекты пользователя. В интернете их нет, клонировать нечего. Источник — только OneDrive-папка рабочего ПК (или её копия, которую пользователь принесёт на флешке). Если папки нет — СТОП и объясни пользователю, что нужно включить синхронизацию OneDrive или скопировать папку.

---

## 2. ПРАВИЛА РАБОТЫ

### 2.1. Общение и отчёты
- Общайся с пользователем по-русски, коротко и без жаргона. Технические детали — в лог-файл, не в чат.
- Рабочая папка установки: `%USERPROFILE%\dsh-home-setup`. Создай её сразу.
  - `install-log.md` — журнал: время, фаза, команды, результат.
  - `paths.ps1` — вычисленные пути (см. ниже), его будешь «подключать» в каждом новом PowerShell-вызове.
  - `state.json` — состояние (номер фазы, версия, что включено), обновляй после каждой фазы.
  - `checks\` — вывод проверок.

### 2.2. Технические правила
- Все команды — PowerShell (Windows PowerShell 5.1 или `pwsh`, что найдёшь). Не используй bash-синтаксис.
- Каждый новый вызов PowerShell начинай строкой:
  `. "$env:USERPROFILE\dsh-home-setup\paths.ps1"` (когда файл уже создан).
- Пути с пробелами и кириллицей — всегда в кавычках. Для exe используй `& "C:\...\file.exe"`.
- Текст/YAML-файлы пиши **UTF-8 без BOM**:
  `[IO.File]::WriteAllText($path, $text, [Text.UTF8Encoding]::new($false))`
  (PowerShell 5.1 `Set-Content -Encoding UTF8` добавляет BOM — для YAML не используй его).
- Все шаги делай **идемпотентно**: если что-то уже установлено/включено — не ломай, проверь и иди дальше.
- Длинные команды выполняй по одной, проверяй `$LASTEXITCODE`/вывод. Не сваливай всю установку в один скрипт без проверок.
- Каждый вызов PowerShell — новый процесс, переменные между вызовами не сохраняются. Всё, что нужно дальше, сохраняй в `paths.ps1` (и подключай его в начале каждого вызова) или выполняй связанные шаги одним вызовом.
- **Кодировки (важно для PowerShell 5.1):** `.ps1`-файлы пиши в **UTF-8 с BOM** (`[Text.UTF8Encoding]::new($true)`) иначе кириллица в путях сломается; `.yml`, `.json`, `.txt` — в **UTF-8 без BOM** (`[Text.UTF8Encoding]::new($false)`). Читай файлы с `Get-Content -Encoding UTF8`.

### 2.3. Безопасность и запреты
- Скачивай установщик **только** с официального домена `https://download.deepseek.com/...`. Никаких зеркал, «репаков», сторонних сайтов и Torrent.
- Перед запуском установщика проверь цифровую подпись (Authenticode) и размер файла. Подпись обязана быть действительной, издатель — DeepSeek/Hangzhou DeepSeek Artificial Intelligence Co., Ltd.
- **Не копируй** с рабочего ПК и не пересылай: `~/.dsh/.credentials.yaml`, `~/.codex/auth.json`, токены, пароли, cookie. Домашний ПК входит в аккаунты сам.
- **Не меняй** файлы в OneDrive-папке `deepseek-harness` (это общие исходники рабочего ПК). Копируй нужное в `%LOCALAPPDATA%\dsh-home`.
- Ничего не удаляй без явного подтверждения пользователя (кроме временных файлов установки в `%TEMP%`).
- Не отключай антивирус/Defender/SmartScreen и не проси пользователя это делать. При блокировке — остановись и объясни.
- Никаких покупок, публикаций, отправки сообщений третьим лицам.
- Не трогай другие приложения и файлы пользователя; твоя зона — DSH, `%LOCALAPPDATA%\dsh-home`, `%USERPROFILE%\.dsh`, `%USERPROFILE%\dsh-home-setup`.

### 2.4. Что делать самостоятельно, а что — через пользователя
Сам: скачивание, проверка подписи, установка, копирование файлов, правка YAML, проверки, чтение `package.json`, запуск процессов, диагностика.
Через пользователя (объясни точными шагами): вход в аккаунт DeepSeek в окне DSH, вход в Codex (если не выполнен), загрузка расширения в Chrome, подтверждения в UI DSH, подтверждение установочных скриптов pnpm, любые действия в GUI, которые нельзя автоматизировать.

---

## 3. ФАЗА 0 — ИНВЕНТАРИЗАЦИЯ

Создай рабочую папку и собери факты. Сохрани вывод в `%USERPROFILE%\dsh-home-setup\checks\phase0.txt`.

```powershell
$ErrorActionPreference = 'Stop'
$setup = Join-Path $env:USERPROFILE 'dsh-home-setup'
New-Item -ItemType Directory -Force -Path $setup, (Join-Path $setup 'checks') | Out-Null
$report = [ordered]@{}
$report['Время'] = (Get-Date).ToString('s')
$report['ОС'] = [Environment]::OSVersion.VersionString
$report['Build'] = [Environment]::OSVersion.Version.Build
$report['64-bit OS'] = [Environment]::Is64BitOperatingSystem
$report['Архитектура'] = $env:PROCESSOR_ARCHITECTURE
$report['RAM GB'] = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
$report['Свободно C: GB'] = [math]::Round((Get-PSDrive C).Free / 1GB, 1)
$report['Пользователь'] = $env:USERNAME
$report['Одноимённые данные DSH'] = Test-Path (Join-Path $env:USERPROFILE '.dsh')
$report['Codex auth'] = Test-Path (Join-Path $env:USERPROFILE '.codex\auth.json')
$report['DSH_HOME (env)'] = $env:DSH_HOME
$report['OneDrive'] = $env:OneDrive
$report['Мои документы'] = [Environment]::GetFolderPath('MyDocuments')
$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
$report['Chrome'] = $chrome
$installedExe = @(
  "$env:LOCALAPPDATA\Programs\DeepSeek Harness\DeepSeek Harness.exe",
  "$env:ProgramFiles\DeepSeek Harness\DeepSeek Harness.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
$report['DSH уже установлен'] = $installedExe
$report | ConvertTo-Json | Tee-Object -FilePath (Join-Path $setup 'checks\phase0.txt')
```

Проверки связи (по одной, не блокируйся на 404 — важен сам факт ответа сервера):

```powershell
function Test-Url([string]$u) {
  try { $r = Invoke-WebRequest -UseBasicParsing -Method Head -Uri $u -TimeoutSec 25; return "OK $($r.StatusCode)" }
  catch { return "ERR $($_.Exception.Response.StatusCode.value__) $($_.Exception.Message)" }
}
Test-Url 'https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.2-rc.2-win-x64.exe'
Test-Url 'https://registry.npmjs.org/'
Test-Url 'https://api.deepseek.com/'
```

**Условия СТОП (объясни и жди решения пользователя):**
- ОС не Windows x64 / build < 19041 (Windows 10 2004) — установка официально не поддерживается.
- Свободно на C: меньше 8 ГБ.
- Нет интернета или недоступен `download.deepseek.com`.
- Нет Chrome — предложи установить Chrome с официального сайта (не ставь молча).
- Нет `~/.codex/auth.json` — предупреди: всё, кроме Codex-субагента, поставятся; для субагента нужен вход в Codex. Продолжай с пометкой.
- Нет аккаунта DeepSeek — предупреди: без него DSH не заработает. Продолжай установку, но вход будет ждать пользователя в Фазе 3.
- Переменная `DSH_HOME` задана и указывает не на `%USERPROFILE%\.dsh` — **СТОП**: этот промт рассчитан на стандартный DSH_HOME. Обсуди с пользователем, какой профиль использовать.

---

## 4. ФАЗА 1 — НАЙТИ ИСХОДНИКИ (OneDrive-папка проекта)

Нужна папка `default-workspace` (внутри `deepseek-harness`). Ищи по кандидатам, затем рекурсивно, но не дольше ~2 минут:

```powershell
$setup = Join-Path $env:USERPROFILE 'dsh-home-setup'
$candidates = @()
if ($env:OneDrive) {
  $candidates += Join-Path $env:OneDrive 'Документы\deepseek-harness\default-workspace'
  $candidates += Join-Path $env:OneDrive 'Documents\deepseek-harness\default-workspace'
  $candidates += Join-Path $env:OneDrive 'deepseek-harness\default-workspace'
}
$candidates += Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'deepseek-harness\default-workspace'
$candidates += Join-Path $env:USERPROFILE 'OneDrive\Документы\deepseek-harness\default-workspace'
$candidates += Join-Path $env:USERPROFILE 'OneDrive\Documents\deepseek-harness\default-workspace'
$WS = $candidates | Where-Object { Test-Path (Join-Path $_ 'chrome-browser-agent\dsh-bundle\package.json') } | Select-Object -First 1
if (-not $WS -and $env:OneDrive -and (Test-Path $env:OneDrive)) {
  $found = Get-ChildItem -Path $env:OneDrive -Directory -Recurse -Depth 4 -Filter 'default-workspace' -ErrorAction SilentlyContinue |
           Where-Object { Test-Path (Join-Path $_.FullName 'chrome-browser-agent\dsh-bundle\package.json') } |
           Select-Object -First 1
  if ($found) { $WS = $found.FullName }
}
$WS
if ($WS) {
  [IO.File]::WriteAllText((Join-Path $setup 'ws.txt'), $WS, [Text.UTF8Encoding]::new($true))
  "WS сохранён в ws.txt"
} else { "WS НЕ НАЙДЕН" }
```

Если `$WS` пустой — **СТОП**. Объясни пользователю: нужно, чтобы папка `deepseek-harness\default-workspace` с рабочего ПК попала на домашний ПК. Варианты:
1) Войти в тот же аккаунт OneDrive, дождаться синхронизации папки `deepseek-harness`, для папки включить «Всегда хранить на этом устройстве».
2) Скопировать папку с рабочего ПК на флешку/внешний диск и положить, например, в `%USERPROFILE%\Documents\deepseek-harness\default-workspace`.
После этого повтори Фазу 1.

**Если папка уже есть, но Codex её не находит** (типичные причины: другой путь, пустой `$env:OneDrive` в песочнице Codex, не синхронизированная папка OneDrive):
- На **рабочем ПК** папка лежит по пути: `C:\Users\teh-t\OneDrive\Документы\deepseek-harness\default-workspace`.
- На **домашнем ПК** при том же аккаунте OneDrive она будет здесь: `%OneDrive%\Документы\deepseek-harness\default-workspace` (или `%OneDrive%\Documents\...`). Проверь в OneDrive, что папка `deepseek-harness` выбрана для синхронизации и «Всегда хранить на этом устройстве».
- Если OneDrive не помогает — используй готовый архив с исходниками: `DSH_исходники_плагинов.zip` (~120 КБ, лежит в корне OneDrive-папки `deepseek-harness`). Скопируй его на домашний ПК и распакуй так, чтобы получилась структура `<папка>\deepseek-harness\default-workspace\chrome-browser-agent\...`, затем передай Codex полный путь к `default-workspace`.
- **Вариант через Git (версионируемый перенос):** в корне OneDrive-папки `deepseek-harness` лежит `DSH_handoff.bundle` — это git-репозиторий одним файлом. На домашнем ПК (где установлен Git):
```powershell
git clone "<путь к DSH_handoff.bundle>" "$env:USERPROFILE\dsh-handoff"
$WS = (Resolve-Path "$env:USERPROFILE\dsh-handoff\default-workspace").Path
Test-Path (Join-Path $WS 'chrome-browser-agent\dsh-bundle\package.json')
```
Если `True` — сохрани `$WS` в `ws.txt` и продолжай Фазу 1. Если Git на домашнем ПК нет — установи с `https://git-scm.com/download/win` или используй zip.
- Явно задай путь в обход авто-поиска и проверь:
```powershell
$WS = 'C:\Users\<имя>\Documents\deepseek-harness\default-workspace'   # подставь реальный путь
Test-Path (Join-Path $WS 'chrome-browser-agent\dsh-bundle\package.json')
```
Если вернулось `True` — сохрани путь в `ws.txt` и продолжай Фазу 1; если `False` — папка не найдена, повтори синхронизацию/копирование.
- Если Codex ограничен рабочей папкой (sandbox) и не видит путь: открой Codex с рабочей папкой, где лежит распакованный `default-workspace`, или разреши чтение этой папки (команды — с подтверждением).

Проверь обязательные файлы и «прогрей» облачные заглушки (Files On-Demand), прочитав по строке:

```powershell
$setup = Join-Path $env:USERPROFILE 'dsh-home-setup'
$WS = [IO.File]::ReadAllText((Join-Path $setup 'ws.txt'), [Text.Encoding]::UTF8).Trim()
$required = @(
  'chrome-browser-agent\bridge\bridge.cjs',
  'chrome-browser-agent\extension\manifest.json',
  'chrome-browser-agent\extension\background.js',
  'chrome-browser-agent\dsh-bundle\package.json',
  'chrome-browser-agent\dsh-bundle\cordis.patch.yml',
  'chrome-browser-agent\chat\chat-server.cjs',
  'computer-control\package.json',
  'computer-control\index.js',
  'computer-control\cordis.patch.yml',
  'quick-notes-ru\package.json',
  'quick-notes-ru\index.js',
  'quick-notes-ru\cordis.patch.yml'
)
$missing = @()
foreach ($rel in $required) {
  $p = Join-Path $WS $rel
  if (-not (Test-Path $p)) { $missing += $rel; continue }
  try { Get-Content -Path $p -TotalCount 1 -ErrorAction Stop | Out-Null } catch { $missing += "$rel (не читается: $($_.Exception.Message))" }
}
if ($missing.Count) { $missing } else { 'Все обязательные файлы на месте и читаются' }
```

Если чего-то нет — СТОП и скажи, чего именно не хватает. Не пытайся воссоздать плагины по памяти.

Создай `paths.ps1` (пока без `$NODE` — он появится после установки DSH). Если `ws.txt` уже сохранён в Фазе 1, просто прочитай его:

```powershell
$setup = Join-Path $env:USERPROFILE 'dsh-home-setup'
$WS = [IO.File]::ReadAllText((Join-Path $setup 'ws.txt'), [Text.Encoding]::UTF8).Trim()
if (-not $WS -or -not (Test-Path $WS)) { throw 'ws.txt пуст или папка исходников не найдена — повтори Фазу 1' }
$pathFile = Join-Path $setup 'paths.ps1'
$content = @"
`$SETUP = '$($env:USERPROFILE)\dsh-home-setup'
`$LOCAL = '$($env:LOCALAPPDATA)\dsh-home'
`$WS = '$WS'
`$DSH_INSTALL = '$($env:LOCALAPPDATA)\Programs\DeepSeek Harness'
`$DSH_EXE = Join-Path `$DSH_INSTALL 'DeepSeek Harness.exe'
`$DSH_CLI = Join-Path `$DSH_INSTALL 'resources\runtime\cli\bin\dsh.cmd'
`$PROFILE_DIR = Join-Path `$env:USERPROFILE '.dsh\profiles\desktop'
"@
[IO.File]::WriteAllText($pathFile, $content, [Text.UTF8Encoding]::new($true))
. $pathFile
"WS=$WS"; "LOCAL=$LOCAL"
```

Обнови `state.json` (фаза 1 пройдена).

---

## 5. ФАЗА 2 — УСТАНОВКА DSH

### 5a. Проверь, не установлен ли уже DSH
```powershell
. "$env:USERPROFILE\dsh-home-setup\paths.ps1"
$existing = @(
  "$env:LOCALAPPDATA\Programs\DeepSeek Harness\DeepSeek Harness.exe",
  "$env:ProgramFiles\DeepSeek Harness\DeepSeek Harness.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($existing) {
  "Найден: $existing"
  if (Test-Path $DSH_CLI) { & $DSH_CLI --version } else { "CLI не найден рядом с $existing" }
} else {
  'DSH не установлен'
}
```
Если установлен и `--version` отвечает: зафиксируй версию, проверь, что приложение запускается (см. Фазу 3), и **не переустанавливай**. Если установлен, но сломан (exe есть, `--version` падает) — переустанови по шагам ниже.

### 5b. Скачай официальный установщик
Кандидаты (проверяй по порядку, бери первый доступный):

| Версия | URL | Размер, байт |
|---|---|---|
| 0.2.2-rc.2 | `https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.2-rc.2-win-x64.exe` | 299 659 528 |
| 0.2.2-rc.1 | `https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.2-rc.1-win-x64.exe` | 293 425 336 |
| 0.2.1-rc.5 | `https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.1-rc.5-win-x64.exe` | 289 408 544 |

Сначала проверь доступность HEAD-запросом, затем скачай `curl.exe` (он есть в Windows 10/11):

```powershell
$ver = '0.2.2-rc.2'
$url = "https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-$ver-win-x64.exe"
$setupExe = Join-Path $env:TEMP "deepseek-harness-$ver-win-x64.exe"
curl.exe -L --fail --retry 3 --retry-delay 5 --connect-timeout 30 -o "$setupExe" "$url"
if ($LASTEXITCODE -ne 0) { throw "Не удалось скачать установщик: exit $LASTEXITCODE" }
(Get-Item $setupExe).Length
[IO.File]::WriteAllText((Join-Path $env:USERPROFILE 'dsh-home-setup\setup-exe.txt'), $setupExe, [Text.UTF8Encoding]::new($true))
```
Если размер не совпал с таблицей — не запускай, попробуй следующего кандидата или СТОП.

### 5c. Проверь подпись и хэш
```powershell
$setupExe = [IO.File]::ReadAllText("$env:USERPROFILE\dsh-home-setup\setup-exe.txt", [Text.Encoding]::UTF8).Trim()
$sig = Get-AuthenticodeSignature $setupExe
$sig.Status
$sig.SignerCertificate.Subject
$sig.SignerCertificate.NotAfter
$hashHex = (Get-FileHash -Algorithm SHA512 $setupExe).Hash
$hashBytes = for ($i = 0; $i -lt $hashHex.Length; $i += 2) { [Convert]::ToByte($hashHex.Substring($i, 2), 16) }
$sha512b64 = [Convert]::ToBase64String([byte[]]$hashBytes)
"$sha512b64"
```
Обязательно: `$sig.Status -eq 'Valid'` и в Subject есть `DeepSeek`. Если подпись недействительна — **СТОП**, не устанавливай, сообщи пользователю.

Контрольные SHA-512 (base64), для сверки (если файл скачан именно этой версии):
- `0.2.2-rc.2`: `5rRAkVruKkm4KELAbTqV8ZFrMwSo3oESnzXb9ebkJWPCMe6WuHORQZR63uY+BqAc6sBdyBtwSelsCGh0k1NcJA==`
- `0.2.2-rc.1`: `swcK0J6ofGkaAWLRpOes2ca7CWO8vuM5Vp0FRnQ/DG3q+Z+OhvsgLz3hIiSYpRUETY+fEz+Ww86fNa0jiVIifw==`

Если хэш не совпадает, а подпись валидна — СТОП и покажи расхождение пользователю (не устанавливай без его явного решения).

### 5d. Установи (silent)
```powershell
$setupExe = [IO.File]::ReadAllText("$env:USERPROFILE\dsh-home-setup\setup-exe.txt", [Text.Encoding]::UTF8).Trim()
$p = Start-Process -FilePath $setupExe -ArgumentList '/S' -PassThru -Wait
$p.ExitCode
Start-Sleep -Seconds 5
Test-Path $DSH_EXE
```
- `ExitCode 0` и exe на месте — успех.
- Если установщик вернул ошибку/ничего не появилось: запусти его в обычном режиме (`Start-Process $setupExe`) и попроси пользователя пройти мастер установки (Next → Install → Finish). Жди появления exe до 15 минут.
- Известный случай: если DSH уже был установлен ранее и обновление падает с кодом 2 — это preflight-конфликт. Тогда предложи пользователю удалить старую версию через «Параметры → Приложения» и установить заново; папку `%USERPROFILE%\.dsh` не удаляй (там данные).

### 5e. Проверь установку и PATH
```powershell
. "$env:USERPROFILE\dsh-home-setup\paths.ps1"
& $DSH_CLI --version
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$cliDir = Join-Path $DSH_INSTALL 'resources\runtime\cli\bin'
$userPath -split ';' -contains $cliDir
(Get-Item $DSH_EXE).VersionInfo.FileVersion
```
Версия из `dsh --version` — истинная (например `0.2.2-rc.2`); поля `VersionInfo` могут показывать `0.2.1.0` — ориентируйся на вывод CLI.
Если CLI-папки нет в PATH — добавь в **пользовательский** PATH:
```powershell
[Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ';' + $cliDir), 'User')
```
и предупреди пользователя, что новые терминалы это увидят; в текущей сессии используй полный путь `$DSH_CLI`.

Зафиксируй `$DSH_VERSION` в `state.json`.

---

## 6. ФАЗА 3 — ПЕРВЫЙ ЗАПУСК И ВХОД В АККАУНТ

1. Запусти приложение:
```powershell
. "$env:USERPROFILE\dsh-home-setup\paths.ps1"
Start-Process -FilePath $DSH_EXE
Start-Sleep -Seconds 8
Get-Process | Where-Object { $_.ProcessName -eq 'DeepSeek Harness' } | Select-Object Id, StartTime
```

2. **СТОП — действия пользователя.** Скажи ему примерно так:

> Открылось окно DeepSeek Harness. Пожалуйста:
> 1) Нажми «Войти» (Sign in) и войди в свой аккаунт DeepSeek. Если ссылка для входа не открылась сама — нажми «Скопировать ссылку для входа» и открой её в браузере.
> 2) Если появится окно обновления — дай ему обновиться и дождись перезапуска.
> 3) Пройди приветствие, настройки можно оставить по умолчанию. Если предложат выбрать рабочую папку — подойдёт `C:\Users\<имя>\Documents` (на плагины это не влияет).
> 4) Когда увидишь главное окно DSH — напиши мне «готово».

3. После ответа «готово» проверь (содержимое файлов не выводи!):
```powershell
. "$env:USERPROFILE\dsh-home-setup\paths.ps1"
$cred = Join-Path $env:USERPROFILE '.dsh\.credentials.yaml'
"cred exists: $(Test-Path $cred)"
if (Test-Path $cred) { "cred size: $((Get-Item $cred).Length)" }
"profile exists: $(Test-Path (Join-Path $PROFILE_DIR 'package.json'))"
```
Если credentials нет — вход не завершён; повтори просьбу. Если профиль `desktop` не создан — перезапусти DSH и подожди.

4. Если приложение само обновилось и перезапустилось, дождись главного окна и снова проверь версию:
```powershell
. "$env:USERPROFILE\dsh-home-setup\paths.ps1"
& $DSH_CLI --version
```
Запиши фактическую версию (она может отличаться от скачанной — это нормально для nightly-канала).

5. Обнови `state.json` (фаза 3, версия, аккаунт=ok).

**Не закрывай DSH без необходимости** — он понадобится для установки плагинов в Фазе 5. Если приложение нужно перезапустить — закрывай через трей (Exit), а не убивай процесс, кроме случаев зависания (тогда `Stop-Process` после подтверждения пользователя).

---

## 7. ФАЗА 4 — ЛОКАЛЬНЫЕ КОПИИ ПЛАГИНОВ

Ставим плагины из **локальных копий** (`%LOCALAPPDATA%\dsh-home`), чтобы:
- не зависеть от облачных заглушек OneDrive;
- не менять общие исходники рабочего ПК;
- иметь стабильные пути для жёстко прописанного пути к `bridge.cjs` и `node.exe`.

Создай структуру и скопируй:

```powershell
. "$env:USERPROFILE\dsh-home-setup\paths.ps1"
New-Item -ItemType Directory -Force -Path `
  "$LOCAL\chrome-browser-agent\bridge", `
  "$LOCAL\chrome-browser-agent\chat", `
  "$LOCAL\chrome-browser-agent\extension", `
  "$LOCAL\plugins\dsh-browser-bridge", `
  "$LOCAL\plugins\dsh-computer-control", `
  "$LOCAL\plugins\quick-notes-ru", `
  "$LOCAL\screenshots" | Out-Null

robocopy "$WS\chrome-browser-agent\bridge"     "$LOCAL\chrome-browser-agent\bridge"     /E /NFL /NDL /NJH /NJS | Out-Null
robocopy "$WS\chrome-browser-agent\chat"       "$LOCAL\chrome-browser-agent\chat"       /E /NFL /NDL /NJH /NJS | Out-Null
robocopy "$WS\chrome-browser-agent\extension"  "$LOCAL\chrome-browser-agent\extension"  /E /NFL /NDL /NJH /NJS | Out-Null
robocopy "$WS\chrome-browser-agent\dsh-bundle" "$LOCAL\plugins\dsh-browser-bridge"      /E /NFL /NDL /NJH /NJS | Out-Null
robocopy "$WS\computer-control"                "$LOCAL\plugins\dsh-computer-control"    /E /NFL /NDL /NJH /NJS | Out-Null
robocopy "$WS\quick-notes-ru"                  "$LOCAL\plugins\quick-notes-ru"          /E /NFL /NDL /NJH /NJS | Out-Null
# robocopy: коды 0..7 — успех
```

Проверь, что ключевые файлы на месте:
```powershell
. "$env:USERPROFILE\dsh-home-setup\paths.ps1"
@(
  "$LOCAL\plugins\dsh-browser-bridge\package.json",
  "$LOCAL\plugins\dsh-browser-bridge\cordis.patch.yml",
  "$LOCAL\chrome-browser-agent\bridge\bridge.cjs",
  "$LOCAL\chrome-browser-agent\extension\manifest.json",
  "$LOCAL\plugins\dsh-computer-control\package.json",
  "$LOCAL\plugins\dsh-computer-control\index.js",
  "$LOCAL\plugins\dsh-computer-control\ps\screenshot.ps1",
  "$LOCAL\plugins\quick-notes-ru\package.json",
  "$LOCAL\plugins\quick-notes-ru\client.js"
) | ForEach-Object { "$(Test-Path $_)`t$_" }
```

Найди node.exe рантайма DSH (он будет запускать браузерный мост):
```powershell
. "$env:USERPROFILE\dsh-home-setup\paths.ps1"
$nodeCandidates = @(
  (Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'),
  (Join-Path $DSH_INSTALL 'resources\runtime\primary-runtime\dependencies\node\bin\node.exe')
)
$NODE = $nodeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $NODE) {
  $NODE = Get-ChildItem (Join-Path $env:USERPROFILE '.dsh\dsh-runtimes') -Recurse -Filter 'node.exe' -ErrorAction SilentlyContinue |
          Select-Object -First 1 -ExpandProperty FullName
}
if (-not $NODE) {
  $NODE = Get-ChildItem (Join-Path $DSH_INSTALL 'resources') -Recurse -Filter 'node.exe' -ErrorAction SilentlyContinue |
          Select-Object -First 1 -ExpandProperty FullName
}
if (-not $NODE) { throw 'Не найден node.exe рантайма DSH — остановись и проверь установку DSH' }
& $NODE --version
$NODE
[IO.File]::WriteAllText((Join-Path $env:USERPROFILE 'dsh-home-setup\node.txt'), $NODE, [Text.UTF8Encoding]::new($true))
```
Если выполняешь поиск и следующий шаг отдельными вызовами PowerShell — прочитай путь обратно: `$NODE = [IO.File]::ReadAllText("$env:USERPROFILE\dsh-home-setup\node.txt", [Text.Encoding]::UTF8).Trim()`.
Перезапиши `paths.ps1` целиком, добавив `$NODE` (файл — UTF-8 с BOM). Если нужен путь: `$NODE = [IO.File]::ReadAllText("$env:USERPROFILE\dsh-home-setup\node.txt", [Text.Encoding]::UTF8).Trim()`:
```powershell
. "$env:USERPROFILE\dsh-home-setup\paths.ps1"
$NODE = [IO.File]::ReadAllText((Join-Path $SETUP 'node.txt'), [Text.Encoding]::UTF8).Trim()
$pathFile = Join-Path $SETUP 'paths.ps1'
$content = @"
`$SETUP = '$($env:USERPROFILE)\dsh-home-setup'
`$LOCAL = '$($env:LOCALAPPDATA)\dsh-home'
`$WS = '$WS'
`$DSH_INSTALL = '$($env:LOCALAPPDATA)\Programs\DeepSeek Harness'
`$DSH_EXE = Join-Path `$DSH_INSTALL 'DeepSeek Harness.exe'
`$DSH_CLI = Join-Path `$DSH_INSTALL 'resources\runtime\cli\bin\dsh.cmd'
`$PROFILE_DIR = Join-Path `$env:USERPROFILE '.dsh\profiles\desktop'
`$NODE = '$NODE'
`$BRIDGE_YML = Join-Path `$LOCAL 'plugins\dsh-browser-bridge\cordis.patch.yml'
`$EXT_DIR = Join-Path `$LOCAL 'chrome-browser-agent\extension'
"@
[IO.File]::WriteAllText($pathFile, $content, [Text.UTF8Encoding]::new($true))
. $pathFile
"NODE=$NODE"
```

Сгенерируй исправленный `cordis.patch.yml` для browser-bridge (в локальной копии!):

```powershell
. "$env:USERPROFILE\dsh-home-setup\paths.ps1"
function Esc([string]$s) { $s.Replace("'", "''") }
$nodeEsc = Esc $NODE
$bridgeEsc = Esc (Join-Path $LOCAL 'chrome-browser-agent\bridge\bridge.cjs')
$bridgeDirEsc = Esc (Join-Path $LOCAL 'chrome-browser-agent\bridge')
$shotsEsc = Esc (Join-Path $LOCAL 'screenshots')
$yaml = @"
- insert:
    - id: browser-bridge-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: browser
        transport: stdio
        command: '$nodeEsc'
        args:
          - '$bridgeEsc'
          - '--port'
          - '8787'
          - '--screenshots'
          - '$shotsEsc'
        cwd: '$bridgeDirEsc'
        toolCallTimeoutMs: 45000
        failOnStartupError: false
"@
$bundleYml = Join-Path $LOCAL 'plugins\dsh-browser-bridge\cordis.patch.yml'
[IO.File]::WriteAllText($bundleYml, $yaml, [Text.UTF8Encoding]::new($false))
Get-Content $bundleYml -Encoding UTF8
```

Проверь глазами: в файле один блок `insert`, пути верные, кавычки одинарные, отступ 4 пробела у `- id:` относительно `- insert:`. Никаких BOM.

Обнови `state.json` (фаза 4).

---

## 8. ФАЗА 5 — УСТАНОВКА И ВКЛЮЧЕНИЕ ИНСТАНСОВ (ПЛАГИНОВ)

Ты не можешь вызывать инструменты DSH напрямую. Есть два маршрута; начни с A (через UI, поддерживаемый), B — резервный.

### 5A. Маршрут A — через страницу «Плагины» в DSH (рекомендуется)

Скажи пользователю открыть DSH и действовать по шагам. Сам проверяй результат по файлам.

1) **Официальные бандлы** (5 штук), включай в этом порядке:
   1. Codex subagent — пакет `@deepseek-ai/dsh-subagent-codex`
   2. Agent Teams — `@deepseek-ai/dsh-experimental-agent-team-profile`
   3. Voice input — `@deepseek-ai/dsh-experimental-voice-input-bundle`
   4. Auto review — `@deepseek-ai/dsh-experimental-auto-review`
   5. Inspector — `@deepseek-ai/dsh-experimental-inspector-profile`

   Как: в DSH открой боковую панель → **Плагины** (Plugins). Найди карточку официального бандла (название может быть локализовано; ориентируйся на имя пакета в карточке/деталях). Если переключатель Off — включи On и дождись установки. Если появится запрос на разрешение установочных скриптов (build scripts) — покажи пользователю список пакетов, объясни, что это код официального бандла, и после его **явного подтверждения** нажми «Разрешить и повторить» (Allow these scripts and retry).
   Если карточки нет в списке — запиши «отсутствует в этой версии» и пропусти (не ошибка).

2) **Локальные бандлы** (3 штуки), в этом порядке:
   1. `quick-notes-ru` → папка `$LOCAL\plugins\quick-notes-ru`
   2. `dsh-browser-bridge` → папка `$LOCAL\plugins\dsh-browser-bridge`
   3. `dsh-computer-control` → папка `$LOCAL\plugins\dsh-computer-control`

   **Важно:** в поле установки нужен **развёрнутый абсолютный путь** (например `C:\Users\<имя>\AppData\Local\dsh-home\plugins\quick-notes-ru`). `%LOCALAPPDATA%` там не раскрывается — вычисли `$LOCAL` и покажи пользователю готовые строки.

   Как: Плагины → **Добавить плагин** (Add plugin) → **Установить сторонний плагин** (Install a third-party plugin) → в поле вставь **абсолютный путь** к папке бандла (см. выше; без кавычек) → «Установить» (Install) → дождись «Применено» (Applied) / «Требуется перезапуск» (Restart required).
   Если поле не принимает путь — убедись, что путь абсолютный и папка содержит `package.json` с `"dsh": { "bundle": ... }`.

3) Если появилось требование **перезапустить DSH** — закрой приложение полностью (трей → Exit; если нет — `Stop-Process -Name 'DeepSeek Harness'` после подтверждения пользователя), затем снова запусти `$DSH_EXE` и дождись главного окна.

4) После перезапуска проверь профиль по файлам:
```powershell
. "$env:USERPROFILE\dsh-home-setup\paths.ps1"
$pkg = Get-Content (Join-Path $PROFILE_DIR 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$bundles = $pkg.dsh.profile.bundles
"Всего бандлов: $($bundles.Count) (ожидается 10)"
$bundles
$deps = $pkg.dependencies.PSObject.Properties.Name
$deps
@(
  "$PROFILE_DIR\node_modules\@local\sidebar-quick-notes-ru",
  "$PROFILE_DIR\node_modules\@local\dsh-browser-bridge",
  "$PROFILE_DIR\node_modules\@local\dsh-computer-control"
) | ForEach-Object { "$(Test-Path $_)`t$_" }
```
Сверь с Приложением A: должны присутствовать все 10. Порядок может немного отличаться — это не критично; критично наличие и включённость. Если каких-то бандлов нет — вернись в UI и доустанови/включи. Если локальный пакет не появился в `dependencies` — установка не прошла, смотри ошибку в UI.

5) Если бандл установлен, но DSH не запускается / бандл помечен ошибкой: смотри `%USERPROFILE%\.dsh\profiles\desktop\.plugin-manager\logs\*\pnpm.log` и сообщения UI. Частые причины: кривой YAML (кодировка/кавычки/пути), отсутствует node.exe по указанному пути, опечатка в пути. Исправь YAML, удали бандл в UI (Remove) и установи заново; либо удали/переустанови его через DSH-агента (маршрут B, `plugin_manager remove_bundle`). Помни: DSH при падении на старте может сам отключить сторонние бандлы (recovery) — это нормально, после исправления включи снова.

### 5B. Маршрут B — через DSH-агента (если UI не сработал)

1) В DSH переключи пресет агента на **cordis / «Create»** (в чате: селектор пресета/режима; либо Настройки → Агент → пресет по умолчанию).
2) Разрешения: включи пресет **danger-full-access** (Настройки → Разрешения) — либо на каждый запрос plugin_manager подтверждай вручную.
3) Открой **Часть 2** этого файла, скопируй её содержимое и вставь в чат DSH отдельным сообщением.
4) Агент сам вызовет `plugin_manager` и установит официальные и локальные бандлы. Подтверждай запросы, если они появятся. После установки перезапусти DSH, если агент попросит.
5) Вернись к проверке из пункта 4 маршрута A.

### 5C. Если локальные плагины несовместимы с текущей версией DSH
Симптом: после включения локального бандла DSH падает/бандл в ошибке, в логе — ошибка импорта/API. Тогда:
1) Удали бандлы, которые ломают (UI → Remove).
2) Удали DSH через «Параметры → Приложения» (данные `%USERPROFILE%\.dsh` сохрани).
3) Установи `0.2.1-rc.5` (та же версия, что на эталоне): `https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.1-rc.5-win-x64.exe` (подпись/хэш проверить так же).
4) Повтори Фазы 3–5. Запиши в отчёт, что пришлось откатиться.

---

## 9. ФАЗА 6 — РАСШИРЕНИЕ CHROME И БРАУЗЕРНЫЙ МОСТ

1) Убедись, что DSH запущен и browser-bridge-бандл включён (Фаза 5). Мост запускается DSH как MCP-процесс.

2) Открой Chrome на странице расширений:
```powershell
. "$env:USERPROFILE\dsh-home-setup\paths.ps1"
$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
Start-Process -FilePath $chrome -ArgumentList 'chrome://extensions/'
```

3) **СТОП — действия пользователя.** Скажи (подставь полный путь из `$EXT_DIR`, а не `%LOCALAPPDATA%`):

> В Chrome открой `chrome://extensions/` (если не открылось — вставь адрес вручную):
> 1) Включи «Режим разработчика» (Developer mode) справа сверху.
> 2) Нажми «Загрузить распакованное» (Load unpacked) и выбери папку:
>    `C:\Users\<имя>\AppData\Local\dsh-home\chrome-browser-agent\extension`
> 3) Закрепи расширение «DSH Browser Agent» на панели (иконка пазла → булавка).
> 4) Нажми на иконку расширения — откроется боковая панель. Дождись статуса «Подключено» (зелёная точка, порт 8787).
> Сообщи мне, когда панель покажет «Подключено».

4) Проверь мост:
```powershell
. "$env:USERPROFILE\dsh-home-setup\paths.ps1"
Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress, LocalPort, OwningProcess
Invoke-RestMethod 'http://127.0.0.1:8787/api/status' | ConvertTo-Json -Depth 6
```
Ожидается: порт слушается, `ok: true`, `ext.connected: true`.

- Порт не слушается → бандл не загружен/упал: проверь страницу «Плагины» (браузерный бандл On), перезапусти DSH, проверь процесс:
```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'bridge.cjs' } | Select-Object ProcessId, CommandLine
```
Если в команде неверный путь к `bridge.cjs`/`node.exe` — поправь `cordis.patch.yml` (Фаза 4), перезапусти DSH.
- `ext.connected: false` → открой панель расширения/обнови вкладку, подожди 5–10 секунд, повтори. Убедись, что Chrome запущен именно с этим профилем.
- Порт занят другим процессом (`EADDRINUSE`) → найди процесс `Get-NetTCPConnection -LocalPort 8787`, останови зависший старый `node.exe` после подтверждения пользователя, перезапусти DSH.

### 6b. Опционально — чат в панели расширения (как на эталоне)
Нужен, только если пользователь пользуется чатом прямо в боковой панели Chrome. Тогда запусти:
```powershell
. "$env:USERPROFILE\dsh-home-setup\paths.ps1"
$chat = Join-Path $LOCAL 'chrome-browser-agent\chat\chat-server.cjs'
Start-Process -FilePath $NODE -ArgumentList "`"$chat`"" -WindowStyle Hidden
Start-Sleep -Seconds 3
Get-NetTCPConnection -LocalPort 8788,8792 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalPort, OwningProcess
Invoke-RestMethod 'http://127.0.0.1:8792/api/health' | ConvertTo-Json
```
Ожидается: 8788 и 8792 слушаются, health `ok: true`. Чат использует вход DeepSeek из `~/.dsh` (уже выполнен).
Автозапуск (по желанию пользователя): создай `%LOCALAPPDATA%\dsh-home\start-chat.vbs`:
```vbscript
Set sh = CreateObject("WScript.Shell")
sh.Run """<полный путь к node.exe>"" ""<полный путь к chat-server.cjs>""", 0, False
```
и, если пользователь согласен, положи ярлык/копию в `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`.

---

## 10. ФАЗА 7 — ПРИЁМКА

### 7.1. Автоматические проверки
Выполни и сохрани в `checks\acceptance.txt`:
```powershell
. "$env:USERPROFILE\dsh-home-setup\paths.ps1"
"=== Версия ==="
& $DSH_CLI --version
"=== Процессы ==="
Get-Process | Where-Object { $_.ProcessName -eq 'DeepSeek Harness' } | Select-Object Id, StartTime
"=== Бандлы профиля ==="
$pkg = Get-Content (Join-Path $PROFILE_DIR 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
"Всего бандлов: $($pkg.dsh.profile.bundles.Count) (ожидается 10)"
$pkg.dsh.profile.bundles
"=== Локальные зависимости ==="
$pkg.dependencies.PSObject.Properties.Name
"=== Порт 8787 ==="
Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalPort, OwningProcess
"=== Статус моста ==="
try { Invoke-RestMethod 'http://127.0.0.1:8787/api/status' | ConvertTo-Json -Depth 6 } catch { "ERR: $($_.Exception.Message)" }
"=== Chrome ==="
Get-Process chrome -ErrorAction SilentlyContinue | Select-Object -First 1 Id, ProcessName
"=== Codex auth ==="
Test-Path (Join-Path $env:USERPROFILE '.codex\auth.json')
```

### 7.2. Функциональные тесты в DSH
Попроси пользователя открыть в DSH новый чат (пресет — обычный, например standard) и по очереди отправить сообщения. После каждого — сообщить ответ. Записывай результаты.

1) `Проверь браузер: вызови browser_status и покажи результат.`
   Ожидается: подключение к Chrome, активная вкладка.
2) `Покажи список открытых окон компьютера через computer_windows, затем сделай скриншот рабочего стола.`
   Ожидается: список окон + PNG-снимок (путь к картинке).
3) `Проверь Codex-субагента: вызови subagent_codex с задачей: «Ответь ровно: OK-DSH». Покажи его ответ.`
   Ожидается: `OK-DSH`. Если ошибка авторизации — Codex не залогинен: попроси пользователя войти в приложение Codex и повтори.
4) `Открой «Быстрые заметки» в боковой панели. Что там есть?`
   Ожидается: пункт «Быстрые заметки» в левой панели и страница заметок.
5) Визуальные проверки (пользователь): есть ли кнопка микрофона (голосовой ввод), доступен ли пресет/режим Agent Teams, открывается ли Inspector (если включён). Если чего-то нет — это может быть особенностью версии; зафиксируй, не ломай установку.

Если тест 1 или 2 не прошёл — вернись к Фазе 6 (мост/процесс) и к Фазе 5 (бандлы), исправь, перезапусти DSH и повтори тест.

---

## 11. ФАЗА 8 — КОПИЯ НАСТРОЕК (опционально, но желательно)

Цель — повторить настройки эталона. Ставь через UI (Настройки/шестерёнка). Если пункта нет в этой версии — пропусти и запиши в отчёт.

| Настройка | Значение на эталоне |
|---|---|
| Модель агента по умолчанию | DeepSeek-аккаунт, модель `deepseek-flash`, reasoning effort **max** |
| Разрешения | пресет **danger-full-access** (approval never); пресеты read-only/workspace-write — с запросом подтверждения |
| Тема | light (светлая) |
| Чат | компактный транскрипт, подробная статистика производительности, ссылки открывать в новой вкладке |
| Пресет агента | default `standard`, выбранный по умолчанию `cordis` (Create) |
| Субагенты | maxDepth 8; разрешённые модели: `deepseek-flash`, `deepseek-v4-pro` |
| Веб-поиск/фетч | deepseek-search-api / deepseek-fetch-api |
| Аккаунт/онбординг | purpose development, process compact, completion completed, usage detailed, developerTools true |

> Предупреждение для пользователя: `danger-full-access` = агент без подтверждений может менять файлы и запускать команды. На домашнем ПК можно выбрать более безопасный `workspace-write` + «спрашивать»; спроси пользователя, какой режим оставить. Если он не хочет рисковать — оставь безопасный и запиши отклонение.

Точный YAML-сниппет для `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml` — в Приложении D. Применяй его только если пользователь хочет побитовую копию и UI не хватает:
1) Закрой DSH.
2) Сделай бэкап: `. "$env:USERPROFILE\dsh-home-setup\paths.ps1"; Copy-Item (Join-Path $PROFILE_DIR 'cordis.patch.yml') (Join-Path $PROFILE_DIR ('cordis.patch.yml.bak-' + (Get-Date -Format 'yyyyMMdd-HHmmss')))`.
3) Смержи записи (не затирай существующие; добавляй/заменяй по `id`).
4) Запусти DSH; если старт сломался — верни бэкап и перезапусти.
5) Убедись, что настройки применились (модель/тема/разрешения).

---

## 12. ФАЗА 9 — ОТЧЁТ И ЗАВЕРШЕНИЕ

1) Создай `%USERPROFILE%\dsh-home-setup\REPORT.md` по шаблону Приложения E.
2) Скопируй отчёт в OneDrive-папку проекта, чтобы он вернулся на рабочий ПК:
```powershell
. "$env:USERPROFILE\dsh-home-setup\paths.ps1"
$received = Join-Path $WS 'dsh-home-setup\received'
New-Item -ItemType Directory -Force -Path $received | Out-Null
Copy-Item (Join-Path $SETUP 'REPORT.md') (Join-Path $received ("REPORT-{0}-{1}.md" -f $env:COMPUTERNAME, (Get-Date -Format 'yyyyMMdd-HHmm'))) -Force
```
3) В чат пользователю — короткий итог: что установлено, версия, какие тесты прошли, что осталось вручную, где лог/отчёт. Без «простыни».
4) Если что-то не удалось — честно перечисли в отчёте и в чате, не выдавай частичный успех за полный.

---

## 13. ТРОУБЛЕШУТИНГ

| Симптом | Вероятная причина | Действие |
|---|---|---|
| SmartScreen «Windows защитила ваш компьютер» | Незнакомый установщик | Проверь подпись (Фаза 5c); если Valid — «Подробнее → Выполнить всё равно». Если подпись невалидна — СТОП. |
| Установщик молча не ставит (`/S`, код 2) | Preflight старого установленного DSH/обновления | Удали старую версию через «Параметры → Приложения», установи заново, `~/.dsh` сохрани. |
| `dsh` не найден в терминале | PATH не обновился | Используй полный путь `$DSH_CLI`; PATH добавлен, новый терминал подхватит. |
| Ссылка входа не открывается | Браузер по умолчанию/сеть | «Скопировать ссылку для входа» → открыть в браузере вручную. |
| Окно «Feishu/test environment» | Проверка политики обновлений nightly-сборки | Продолжай, если можно; иначе установи свежий официальный установщик; зафиксируй. |
| DSH не стартует после бандла | Recovery отключил сторонние бандлы / кривой YAML | `.plugin-manager\logs`; исправь YAML (UTF-8 без BOM, одинарные кавычки, отступы); удали бандл и поставь заново. |
| Официального бандла нет на странице | Версия/каталог другие | `plugin_manager list_bundles` (маршрут B) или пропусти; зафиксируй. |
| «Already installed» при установке локального | Пакет уже стоит | Сначала Remove/`remove_bundle`, затем install. |
| Порт 8787 занят (`EADDRINUSE`) | Зависший старый мост | Найди процесс, останови после подтверждения, перезапусти DSH. |
| Панель расширения «Отключено» | Мост не запущен/Chrome не тот профиль | Проверь бандл и порт 8787, открой панель, перезапусти Chrome/DSH. |
| В чате нет `mcp__browser__*` | Бандл выключен/нужен рестарт | Плагины → включить browser-bridge, перезапустить DSH. |
| В чате нет `computer_*` | Бандл выключен/рестарт | То же для computer-control. |
| `subagent_codex` падает на `initialize` | Нет входа Codex (`~/.codex/auth.json`) | Войти в Codex, повторить; проверить `CODEX_HOME`. |
| Установка официального бандла просит build scripts | pnpm 11 блокирует скрипты | Показать пользователю список, получить согласие, «Разрешить и повторить». |
| OneDrive-файлы «облачные» и не читаются | Files On-Demand | Скачать папку локально/«Всегда хранить на устройстве», повторить копирование. |
| Кириллица/пробелы в пути ломают YAML | Кавычки/кодировка | Все пути в одинарных кавычках, UTF-8 без BOM; проверь файл глазами. |
| Антивирус ругается на PS-скрипты computer-control | Эвристика | Не отключай защиту; при согласии пользователя добавь папку `%LOCALAPPDATA%\dsh-home` в исключения. |
| DSH сломался после правки `cordis.patch.yml` | Ошибка YAML | Верни `.bak`, перезапусти, правь по одному изменению. |
| Локальные бандлы несовместимы с новой версией | API изменился | Откат на 0.2.1-rc.5 (Фаза 5C). |

---

## 14. ПРИЛОЖЕНИЯ

### Приложение A — эталонный список инстансов (порядок включения)

| № | Пакет | Тип | Что даёт | Как включить | Как проверить |
|---|---|---|---|---|---|
| 1 | `@deepseek-ai/dsh-base` | базовый | ядро DSH | обычно включён | приложение работает |
| 2 | `@deepseek-ai/dsh-web-app` | базовый | веб-интерфейс | обычно включён | UI открывается |
| 3 | `@deepseek-ai/dsh-experimental-agent-team-profile` | официальный | Agent Teams | Плагины → On / `install_bundle` | бандл в списке, пресет/команды доступны |
| 4 | `@deepseek-ai/dsh-experimental-voice-input-bundle` | официальный | голосовой ввод | Плагины → On | кнопка микрофона в чате |
| 5 | `@deepseek-ai/dsh-experimental-auto-review` | официальный | авто-ревью | Плагины → On | бандл в списке |
| 6 | `@deepseek-ai/dsh-experimental-inspector-profile` | официальный | инспектор | Плагины → On | бандл в списке |
| 7 | `@deepseek-ai/dsh-subagent-codex` | официальный | Codex-субагент, инструмент `subagent_codex` | Плагины → On | тест из Фазы 7 |
| 8 | `@local/sidebar-quick-notes-ru` | локальный | «Быстрые заметки» | путь `...\plugins\quick-notes-ru` | пункт в боковой панели |
| 9 | `@local/dsh-browser-bridge` | локальный | Chrome-агент, `mcp__browser__*` | путь `...\plugins\dsh-browser-bridge` | `browser_status` |
| 10 | `@local/dsh-computer-control` | локальный | управление ПК, `computer_*` | путь `...\plugins\dsh-computer-control` | `computer_windows` |

Итоговый порядок `dsh.profile.bundles` на эталоне:
```json
["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app","@deepseek-ai/dsh-experimental-agent-team-profile","@deepseek-ai/dsh-experimental-voice-input-bundle","@deepseek-ai/dsh-experimental-auto-review","@deepseek-ai/dsh-experimental-inspector-profile","@deepseek-ai/dsh-subagent-codex","@local/sidebar-quick-notes-ru","@local/dsh-browser-bridge","@local/dsh-computer-control"]
```

### Приложение B — справочные пути эталонного ПК (для сверки; у тебя будут свои)

- Установка: `%LOCALAPPDATA%\Programs\DeepSeek Harness`
- exe: `...\DeepSeek Harness.exe`
- CLI: `...\resources\runtime\cli\bin\dsh.cmd`
- DSH_HOME: `%USERPROFILE%\.dsh`
- Профиль: `%USERPROFILE%\.dsh\profiles\desktop`
- Рантайм-node: `%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`
- Рабочие исходники: `<OneDrive>\Документы\deepseek-harness\default-workspace` (у эталона `C:\Users\teh-t\OneDrive\Документы\...`)
- Локальная копия для дома: `%LOCALAPPDATA%\dsh-home` — там `chrome-browser-agent\{bridge,extension,chat}`, `plugins\{dsh-browser-bridge,dsh-computer-control,quick-notes-ru}`, `screenshots`
- Расширение (загружается в Chrome): `%LOCALAPPDATA%\dsh-home\chrome-browser-agent\extension`
- Мост: `%LOCALAPPDATA%\dsh-home\chrome-browser-agent\bridge\bridge.cjs`, порт 8787
- Скриншоты браузера: `%LOCALAPPDATA%\dsh-home\screenshots`
- Панельный чат: `%LOCALAPPDATA%\dsh-home\chrome-browser-agent\chat\chat-server.cjs`, порт 8792, второй мост 8788
- Установщики: `https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-<версия>-win-x64.exe`
- Официальный сайт: `https://www.deepseek.com/harness/`

### Приложение C — шаблон `cordis.patch.yml` для browser-bridge (генерируется в Фазе 4)

```yaml
- insert:
    - id: browser-bridge-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: browser
        transport: stdio
        command: '<NODE.EXE>'
        args:
          - '<...>\chrome-browser-agent\bridge\bridge.cjs'
          - '--port'
          - '8787'
          - '--screenshots'
          - '<...>\dsh-home\screenshots'
        cwd: '<...>\chrome-browser-agent\bridge'
        toolCallTimeoutMs: 45000
        failOnStartupError: false
```

### Приложение D — настройки эталона (`cordis.patch.yml` рабочего ПК)

```yaml
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: deepseek-account
    model: deepseek-flash
    reasoningEffort: max
- id: ui-settings-account
  name: "@deepseek-ai/dsh-client-ui-settings-account"
  config:
    version: 1
    step: done
    purpose: development
    process: compact
    completion: completed
    usage: detailed
    developerTools: true
- id: ui-chat
  name: "@deepseek-ai/dsh-client-ui-chat"
  config:
    transcriptView: compact
    performanceUsage: detailed
    linkOpening: new-tab
- id: ui-settings
  name: "@deepseek-ai/dsh-client-ui-settings"
  config:
    enabled: true
- id: subagent
  name: "@deepseek-ai/dsh-subagent"
  config:
    maxDepth: 8
- id: subagent-model-selection-settings
  name: "@deepseek-ai/dsh-tool-subagent/model-selection-settings"
  config:
    enabled: true
    allowedModels:
      - provider: deepseek-account
        model: deepseek-flash
      - provider: deepseek-account
        model: deepseek-v4-pro
- id: web
  name: "@deepseek-ai/dsh-web"
  config:
    searchProvider: deepseek-search-api
    fetchProvider: deepseek-fetch-api
- id: agent-preset-registry
  name: "@deepseek-ai/dsh-agent-preset-registry"
  config:
    default: standard
    selectedDefault: cordis
- id: ui-theme
  name: "@deepseek-ai/dsh-client-ui-theme"
  config:
    preference: light
- id: permission
  name: "@deepseek-ai/dsh-permission-presets"
  config:
    presets:
      read-only:
        sandbox: read-only
        approval: ask
      workspace-write:
        sandbox: workspace-write
        approval: ask
      danger-full-access:
        sandbox: danger-full-access
        approval: never
    defaultPreset: danger-full-access
```

### Приложение E — шаблон финального `REPORT.md`

```markdown
# Отчёт: установка DSH на домашний ПК

- Дата/время:
- Компьютер/пользователь:
- Версия DSH (фактическая):
- Путь установки:
- Профиль: %USERPROFILE%\.dsh\profiles\desktop
- Итог: УСПЕХ / ЧАСТИЧНО / ОШИБКА

## Инстансы
| Пакет | Статус | Проверка | Примечание |
|---|---|---|---|
| ... | включён/пропущен/ошибка | ... | ... |

## Настройки
| Настройка | Перенесена | Примечание |
|---|---|---|

## Chrome / браузерный мост
- Расширение загружено: да/нет
- Порт 8787: слушается/нет
- ext.connected:

## Codex-субагент
- ~/.codex/auth.json: есть/нет
- Тест subagent_codex: OK / ошибка (текст)

## Отклонения и что делать
- ...

## Что осталось вручную
- ...

## Логи
- %USERPROFILE%\dsh-home-setup\install-log.md
- checks\phase0.txt, checks\acceptance.txt

## Рекомендации
- Обновления DSH (nightly): ...
- Безопасность: ...
```

### Приложение F — маршрут B (сообщение для DSH-агента)

Смотри **Часть 2** этого файла ниже. Скопируй её содержимое в чат DSH (пресет Create/cordis, полный доступ или подтверждение каждого шага).

### Приложение G — контрольные данные установщиков

| Версия | URL | Размер (байт) | SHA-512 (base64) |
|---|---|---|---|
| 0.2.2-rc.2 | `https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.2-rc.2-win-x64.exe` | 299 659 528 | `5rRAkVruKkm4KELAbTqV8ZFrMwSo3oESnzXb9ebkJWPCMe6WuHORQZR63uY+BqAc6sBdyBtwSelsCGh0k1NcJA==` |
| 0.2.2-rc.1 | `https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.2-rc.1-win-x64.exe` | 293 425 336 | `swcK0J6ofGkaAWLRpOes2ca7CWO8vuM5Vp0FRnQ/DG3q+Z+OhvsgLz3hIiSYpRUETY+fEz+Ww86fNa0jiVIifw==` |
| 0.2.1-rc.5 | `https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.1-rc.5-win-x64.exe` | 289 408 544 | — (сверяй подпись/размер) |

**Основная проверка безопасности — Authenticode-подпись и официальный домен; SHA-512 — дополнительная сверка.**

---

## 15. ФИНАЛЬНЫЕ ОГРАНИЧЕНИЯ

- Не пытайся установить всё «одним скриптом» без проверок: установка DSH и плагинов требует действий пользователя в GUI.
- Не выдумывай пути/имена бандлов: если факт неизвестен — прочитай `package.json`/UI/`plugin_manager list_bundles`.
- Не трогай рабочие данные пользователя вне указанных папок.
- Если застрял больше чем на 2–3 попытки в одном месте — остановись, опиши проблему и спроси пользователя (или предложи откат на 0.2.1-rc.5).

Удачи. Начинай с Фазы 0 и веди пользователя по шагам.


---

# ЧАСТЬ 2. Резервный маршрут: сообщение для DSH-агента

Если установка плагинов через страницу «Плагины» не сработала — скопируй текст ниже в чат DSH (пресет Create/cordis, разрешения danger-full-access или подтверждение каждого запроса).

# Сообщение для DSH-агента: установить и включить все плагины-инстансы

<!--
Как использовать: скопируй ВЕСЬ текст ниже и вставь отдельным сообщением в чат DSH
на домашнем ПК. Нужен пресет агента «Create»/cordis и разрешения danger-full-access
(либо подтверждай каждый запрос plugin_manager вручную).
Это резервный маршрут (B); основной — установка через страницу «Плагины» в UI DSH.
-->

Ты — агент DSH на новом домашнем ПК. Задача: установить и включить все плагины-инстансы, как на рабочем ПК. Работай по шагам, после каждого шага сообщай короткий результат. Ничего не удаляй, не меняй настройки модели/темы и не устанавливай ничего, кроме перечисленного.

**Перед началом** проверь, что у тебя есть инструмент `plugin_manager` и доступ к локальным папкам. Если `plugin_manager` недоступен — остановись и скажи пользователю: «Переключи пресет агента на Create/cordis и включи разрешения danger-full-access (или подтверждай каждый запрос), затем повтори это сообщение».

## Шаг 1. Инвентаризация

Вызови:
```
plugin_manager({ "action": "list_bundles", "limit": 100 })
```

Найди в списке (по именам пакетов):
- официальные: `@deepseek-ai/dsh-subagent-codex`, `@deepseek-ai/dsh-experimental-agent-team-profile`, `@deepseek-ai/dsh-experimental-voice-input-bundle`, `@deepseek-ai/dsh-experimental-auto-review`, `@deepseek-ai/dsh-experimental-inspector-profile`;
- локальные (после установки): `@local/sidebar-quick-notes-ru`, `@local/dsh-browser-bridge`, `@local/dsh-computer-control`.

Для официальных, которых нет в профиле, запиши их `installTarget.spec` (он есть в списке у официальных on-demand записей).

## Шаг 2. Официальные бандлы — по порядку

1. `@deepseek-ai/dsh-experimental-agent-team-profile`
2. `@deepseek-ai/dsh-experimental-voice-input-bundle`
3. `@deepseek-ai/dsh-experimental-auto-review`
4. `@deepseek-ai/dsh-experimental-inspector-profile`
5. `@deepseek-ai/dsh-subagent-codex`

Для каждого:
- если он уже `installed` и `enabled` — пропусти, отметь «уже включён»;
- если запись «shipped optional» и выключена — `plugin_manager({ "action": "set_bundle", "target": "<пакет>", "enabled": true })`;
- если это on-demand запись с `installTarget.spec` — `plugin_manager({ "action": "install_bundle", "target": "<installTarget.spec>" })`;
- если бандла нет в списке — пропусти и запиши «отсутствует в этой версии».

Если установка вернула `pendingBuilds` (запрос на установочные скрипты) — **остановись**, покажи пользователю список пакетов, объясни, что это скрипты официального бандла DeepSeek, и повтори установку с `approvedBuilds` только после его явного «да». Никогда не подтверждай молча.

Если `nextStep` говорит про перезапуск — запомни это и продолжай; перезапуск сделаем в конце.

## Шаг 3. Локальные бандлы — по порядку

Сначала вычисли реальные пути (в PowerShell):
```
$local = Join-Path $env:LOCALAPPDATA 'dsh-home'
$local
@(
  (Join-Path $local 'plugins\quick-notes-ru'),
  (Join-Path $local 'plugins\dsh-browser-bridge'),
  (Join-Path $local 'plugins\dsh-computer-control')
) | ForEach-Object { "$(Test-Path $_)`t$_" }
```
Если какой-то папки нет — остановись и скажи пользователю, что не хватает файлов плагина (их должен был подготовить Codex на этапе 4).

Затем установи по порядку, подставляя **полные абсолютные пути** (не `%LOCALAPPDATA%`):
1. `<LOCALAPPDATA>\dsh-home\plugins\quick-notes-ru`
2. `<LOCALAPPDATA>\dsh-home\plugins\dsh-browser-bridge`
3. `<LOCALAPPDATA>\dsh-home\plugins\dsh-computer-control`

Для каждой папки выполни:
```
plugin_manager({ "action": "install_bundle", "target": "<абсолютный путь к папке>" })
```

Если ответ `already-installed` — сначала `plugin_manager({ "action": "remove_bundle", "target": "<имя пакета>" })`, затем установи снова.

Ожидаемые имена: `@local/sidebar-quick-notes-ru`, `@local/dsh-browser-bridge`, `@local/dsh-computer-control`.

## Шаг 4. Перезапуск

Если хотя бы один результат сообщил `restart-required` — скажи пользователю: «Полностью закрой DSH (иконка в трее → Выход) и открой снова. После перезапуска напиши “готово”», — и дождись.

## Шаг 5. Проверка

Снова вызови `plugin_manager({ "action": "list_bundles", "limit": 100 })` и проверь:
- все 8 внешних бандлов (5 официальных + 3 локальных) установлены и включены;
- базовые `@deepseek-ai/dsh-base` и `@deepseek-ai/dsh-web-app` на месте.

Покажи пользователю таблицу: пакет | статус | примечание. Затем проверь доступность инструментов `browser_status`, `computer_windows`, `subagent_codex` (если в этой сессии их нет — скажи, что после перезапуска они появятся).

## Ограничения

- Не удаляй существующие бандлы и не выключай базовые.
- Не устанавливай ничего, кроме официальных бандлов DSH и трёх локальных папок выше.
- Не меняй модель, тему, разрешения без просьбы пользователя.
- При ошибке покажи её текст и не импровизируй: скажи пользователю, что нужно исправить.


# ЧАСТЬ 3. Короткая памятка

- **Аккаунты не переносятся.** На домашнем ПК отдельно войди в DeepSeek (в DSH) и в Codex. Токены и пароли не копируй.
- **Исходники плагинов** берутся только из OneDrive-папки `deepseek-harness\default-workspace`. Если папки нет — Codex остановится и попросит её принести (OneDrive или флешка).
- **Версия DSH:** ставится свежая официальная (`0.2.2-rc.2`); если локальные плагины не заведутся — промт предусматривает откат на `0.2.1-rc.5`.
- **Проверка после установки:** в DSH новый чат → «вызови browser_status», «покажи окна computer_windows», «делегируй Codex задачу: ответь OK-DSH», в боковой панели — «Быстрые заметки». Расширение Chrome должно показывать «Подключено» (порт 8787).
- **Обновление плагинов позже:** скопируй свежие папки из OneDrive в `%LOCALAPPDATA%\dsh-home` (Фаза 4 промта), удали старые бандлы в DSH и установи заново.
- **Отчёт:** Codex сохранит `%USERPROFILE%\dsh-home-setup\REPORT.md` и вернёт копию в OneDrive-папку `dsh-home-setup\received` на рабочем ПК.
- **Безопасность:** эталонная настройка даёт агенту полный доступ к ПК (danger-full-access). Если не хочешь — разреши Codex оставить безопасный режим (workspace-write + подтверждения).
