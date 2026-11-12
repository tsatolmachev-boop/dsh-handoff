/**
 * Host-половина пакета «Управление компьютером» (Windows).
 *
 * Регистрирует девять инструментов `computer_*`, которые работают с реальным
 * рабочим столом пользователя: скриншоты, список окон, фокус окна, мышь,
 * клавиатура, прокрутка и текстовый буфер обмена.
 *
 * Пакет импортирует только встроенные модули Node.js: он устанавливается в
 * профиль как локальный связанный (link) бандл и не имеет зависимостей.
 * Каждая операция выполняется отдельным процессом Windows PowerShell 5.1
 * (`ps/*.ps1`), который вызывает Win32 через P/Invoke и пишет результат в
 * UTF-8 JSON-файл, путь которого передаётся в `DSH_CC_RESULT`.
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'computer-control'
export const inject = ['tools']

const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT_DIR = path.join(PACKAGE_DIR, 'ps')
const TEMP_ROOT = path.join(tmpdir(), 'dsh-computer-control')
const RESULT_DIR = path.join(TEMP_ROOT, 'results')
const SCREENSHOT_DIR = path.join(TEMP_ROOT, 'screenshots')
const SCRIPT_TIMEOUT_MS = 30_000
const MAX_TEXT_LENGTH = 8000
const MAX_WINDOWS = 120
const MAX_COORDINATE = 100_000
const POWERSHELL_CANDIDATES = [
  process.env.DSH_COMPUTER_POWERSHELL,
  'powershell.exe',
  'pwsh.exe',
  'pwsh',
].filter((candidate) => typeof candidate === 'string' && candidate.length > 0)

let directoriesReady
let powershellPath
let resultSeq = 0

function ensureDirectories() {
  directoriesReady ??= Promise.all([
    mkdir(RESULT_DIR, { recursive: true }),
    mkdir(SCREENSHOT_DIR, { recursive: true }),
  ]).then(() => undefined)
  return directoriesReady
}

function tail(text, limit = 1600) {
  const value = String(text ?? '').trim()
  if (value.length === 0) return '(no output)'
  return value.length <= limit ? value : `…${value.slice(-limit)}`
}

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload ?? {}), 'utf8').toString('base64')
}

function checkPowerShell(executable) {
  return new Promise((resolve) => {
    try {
      execFile(
        executable,
        ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'],
        { windowsHide: true, timeout: 8000 },
        (error) => resolve(!error),
      )
    } catch {
      resolve(false)
    }
  })
}

async function getPowerShell() {
  if (powershellPath !== undefined) return powershellPath
  for (const candidate of POWERSHELL_CANDIDATES) {
    if (await checkPowerShell(candidate)) {
      powershellPath = candidate
      return candidate
    }
  }
  throw new Error(
    `computer control: no usable PowerShell executable (tried: ${POWERSHELL_CANDIDATES.join(', ')})`,
  )
}

/**
 * Запустить один PowerShell-скрипт пакета и вернуть разобранный JSON-результат.
 * @param {string} scriptName имя файла в `ps/`.
 * @param {object} payload данные вызова, кодируются в base64 и передаются в `DSH_CC_PAYLOAD`.
 * @param {{ timeoutMs?: number, signal?: AbortSignal }} options отмена и таймаут.
 * @returns {Promise<any>}
 */
async function runScript(scriptName, payload, options = {}) {
  const { timeoutMs = SCRIPT_TIMEOUT_MS, signal } = options
  await ensureDirectories()
  const executable = await getPowerShell()
  const resultPath = path.join(
    RESULT_DIR,
    `result-${process.pid}-${Date.now()}-${++resultSeq}.json`,
  )
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-STA',
    '-File',
    path.join(SCRIPT_DIR, scriptName),
  ]
  const env = {
    ...process.env,
    DSH_CC_PAYLOAD: encodePayload(payload),
    DSH_CC_RESULT: resultPath,
    DSH_CC_SHOTS: SCREENSHOT_DIR,
  }

  let stderr = ''
  try {
    await new Promise((resolve, reject) => {
      execFile(
        executable,
        args,
        { windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, env, signal },
        (error, _stdout, errorOutput) => {
          stderr = String(errorOutput ?? '')
          if (error) reject(error)
          else resolve()
        },
      )
    })
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR') {
      const aborted = new Error('computer control call aborted')
      aborted.name = 'AbortError'
      throw aborted
    }
    if (error?.code === 'ENOENT') powershellPath = undefined
    throw new Error(
      `computer control ${scriptName} failed: ${tail(stderr || error?.message || error)}`,
    )
  }

  let raw
  try {
    raw = await readFile(resultPath, 'utf8')
  } catch (error) {
    throw new Error(
      `computer control ${scriptName} produced no result (${tail(error?.message || error, 400)})`,
    )
  } finally {
    unlink(resultPath).catch(() => {})
  }

  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(`computer control ${scriptName} returned invalid JSON: ${tail(raw, 500)}`)
  }
}

function assertCoordinate(value, fieldName) {
  if (!Number.isInteger(value) || Math.abs(value) > MAX_COORDINATE) {
    throw new Error(`invalid ${fieldName}: expected an integer coordinate, got ${JSON.stringify(value)}`)
  }
}

function optionalCoordinates(args) {
  const hasX = args.x !== undefined
  const hasY = args.y !== undefined
  if (hasX !== hasY) throw new Error('invalid arguments: x and y must be provided together')
  if (hasX) {
    assertCoordinate(args.x, 'x')
    assertCoordinate(args.y, 'y')
  }
  return hasX ? { x: args.x, y: args.y } : {}
}

/** Virtual-key codes by name, plus the keys that must be pressed before ordinary keys. */
const MODIFIER_KEYS = {
  ctrl: 0x11,
  control: 0x11,
  shift: 0x10,
  alt: 0x12,
  menu: 0x12,
  win: 0x5b,
  lwin: 0x5b,
  rwin: 0x5c,
  meta: 0x5b,
}
const NAMED_KEYS = {
  enter: 0x0d,
  return: 0x0d,
  esc: 0x1b,
  escape: 0x1b,
  tab: 0x09,
  space: 0x20,
  backspace: 0x08,
  back: 0x08,
  delete: 0x2e,
  del: 0x2e,
  insert: 0x2d,
  ins: 0x2d,
  home: 0x24,
  end: 0x23,
  pageup: 0x21,
  pgup: 0x21,
  pagedown: 0x22,
  pgdn: 0x22,
  up: 0x26,
  down: 0x28,
  left: 0x25,
  right: 0x27,
  capslock: 0x14,
  printscreen: 0x2c,
  prtsc: 0x2c,
  pause: 0x13,
  numlock: 0x90,
  scrolllock: 0x91,
  plus: 0xbb,
  minus: 0xbd,
  '=': 0xbb,
  '-': 0xbd,
  ',': 0xbc,
  '.': 0xbe,
  '/': 0xbf,
  ';': 0xba,
  "'": 0xde,
  '[': 0xdb,
  ']': 0xdd,
  '\\': 0xdc,
  '`': 0xc0,
}
const MODIFIER_CODES = new Set([0x11, 0x10, 0x12, 0x5b, 0x5c])

function virtualKeyForToken(token, combo) {
  if (Object.hasOwn(MODIFIER_KEYS, token)) return MODIFIER_KEYS[token]
  if (Object.hasOwn(NAMED_KEYS, token)) return NAMED_KEYS[token]
  if (/^[a-z]$/.test(token)) return 0x41 + token.charCodeAt(0) - 0x61
  if (/^[0-9]$/.test(token)) return 0x30 + token.charCodeAt(0) - 0x30
  const fKey = /^f([1-9]|1[0-9]|2[0-4])$/.exec(token)
  if (fKey) return 0x70 + Number(fKey[1]) - 1
  throw new Error(
    `unknown key token "${token}" in "${combo}" (use names like ctrl, shift, alt, win, enter, esc, tab, space, f1..f24, letters, digits, + - , . / ; ' [ ] \\ \`)`,
  )
}

/**
 * Разобрать комбинацию вида `ctrl+shift+esc` в список virtual-key кодов.
 * Модификаторы всегда нажимаются первыми, отпускаются в обратном порядке.
 */
function parseKeyCombo(combo) {
  if (typeof combo !== 'string' || combo.trim().length === 0) {
    throw new Error('invalid keys: expected a non-empty string such as "ctrl+s"')
  }
  const tokens = combo
    .trim()
    .toLowerCase()
    .split('+')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
  if (tokens.length === 0) throw new Error('invalid keys: expected at least one key')
  if (tokens.length > 6) throw new Error(`invalid keys: too many tokens in "${combo}"`)

  const parsed = tokens.map((token) => ({
    token,
    virtualKey: virtualKeyForToken(token, combo),
  }))
  const modifiers = parsed.filter((entry) => MODIFIER_CODES.has(entry.virtualKey))
  const ordinary = parsed.filter((entry) => !MODIFIER_CODES.has(entry.virtualKey))
  const ordered = [...modifiers, ...ordinary]
  return { tokens, virtualKeys: ordered.map((entry) => entry.virtualKey) }
}

function objectSchema(properties) {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  }
}

function parametersSchema(properties, required = []) {
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  }
}

function presentCall(title, args) {
  return { card: 'generic', title, kind: 'other', rawInput: args }
}

function textResult(text) {
  return [{ type: 'text', text }]
}

const computerScreenshot = {
  name: 'computer_screenshot',
  description:
    'Capture the Windows desktop to a PNG file and return its absolute path, pixel size, and monitor layout. Use read_image on the path to look at the screen. Omit `screen` to capture every monitor as one image; pass a 1-based monitor index to capture one monitor. Coordinates used by the other computer_* tools are physical pixels of this same virtual desktop.',
  parameters: parametersSchema({
    screen: {
      type: 'integer',
      description: '1-based monitor index from a previous call; omit to capture the whole virtual desktop.',
    },
  }),
  output: {
    schema: objectSchema({
      path: { type: 'string', description: 'Absolute PNG path.' },
      width: { type: 'integer' },
      height: { type: 'integer' },
      monitors: {
        type: 'array',
        items: objectSchema({
          index: { type: 'integer' },
          name: { type: 'string' },
          primary: { type: 'boolean' },
          x: { type: 'integer' },
          y: { type: 'integer' },
          width: { type: 'integer' },
          height: { type: 'integer' },
        }),
      },
    }),
    render: (_args, value) =>
      textResult(
        `Screenshot saved: ${value.path} (${value.width}x${value.height}; ${value.monitors.length} monitor(s)). View it with read_image.`,
      ),
  },
  async execute(args, exec) {
    if (args.screen !== undefined && (!Number.isInteger(args.screen) || args.screen < 1)) {
      throw new Error('invalid screen: expected a positive integer monitor index')
    }
    const result = await runScript('screenshot.ps1', { screen: args.screen }, { signal: exec?.signal })
    return {
      path: String(result.path),
      width: Number(result.width),
      height: Number(result.height),
      monitors: Array.isArray(result.monitors) ? result.monitors : [],
    }
  },
  presentCall: (args) => presentCall('Capture desktop screenshot', args),
}

const computerWindows = {
  name: 'computer_windows',
  description:
    'List visible top-level windows on the Windows desktop with title, process name, PID, bounds, minimized state, and which one is foreground. Use it to find where to click, which window to focus, or what is currently on screen.',
  parameters: parametersSchema({
    all: {
      type: 'boolean',
      description: 'Also include visible windows with an empty title (default false).',
    },
  }),
  output: {
    schema: objectSchema({
      foreground: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      count: { type: 'integer' },
      windows: {
        type: 'array',
        items: objectSchema({
          hwnd: { type: 'string' },
          title: { type: 'string' },
          className: { type: 'string' },
          pid: { type: 'integer' },
          processName: { type: 'string' },
          x: { type: 'integer' },
          y: { type: 'integer' },
          width: { type: 'integer' },
          height: { type: 'integer' },
          minimized: { type: 'boolean' },
          foreground: { type: 'boolean' },
        }),
      },
    }),
    render: (_args, value) => {
      const lines = value.windows.map(
        (window) =>
          `${window.foreground ? '*' : ' '} ${window.title || '(untitled)'} — ${window.processName} (pid ${window.pid}) at ${window.x},${window.y} ${window.width}x${window.height}${window.minimized ? ' [minimized]' : ''}`,
      )
      return textResult(
        `Foreground: ${value.foreground ?? '(unknown)'}\n${value.count} window(s):\n${lines.join('\n')}`,
      )
    },
  },
  async execute(args, exec) {
    const result = await runScript('windows.ps1', { all: args.all === true }, { signal: exec?.signal })
    const windows = Array.isArray(result.windows) ? result.windows.slice(0, MAX_WINDOWS) : []
    return {
      foreground: typeof result.foreground === 'string' ? result.foreground : null,
      count: windows.length,
      windows,
    }
  },
  presentCall: (args) => presentCall('List desktop windows', args),
}

const computerFocus = {
  name: 'computer_focus',
  description:
    'Bring a window whose title contains the given text (case-insensitive) to the foreground. Fails when no matching visible window exists, or when Windows refuses to activate the window (foreground lock); in that case verify the active window with computer_windows.',
  parameters: parametersSchema(
    {
      title: {
        type: 'string',
        description: 'Case-insensitive substring of the window title, e.g. "Notepad" or "Excel".',
      },
    },
    ['title'],
  ),
  output: {
    schema: objectSchema({
      hwnd: { type: 'string' },
      title: { type: 'string' },
      processName: { type: 'string' },
      pid: { type: 'integer' },
    }),
    render: (_args, value) =>
      textResult(`Focused window: ${value.title} — ${value.processName} (pid ${value.pid}, ${value.hwnd}).`),
  },
  async execute(args, exec) {
    if (typeof args.title !== 'string' || args.title.trim().length === 0) {
      throw new Error('invalid title: expected a non-empty string')
    }
    const result = await runScript('focus.ps1', { title: args.title }, { signal: exec?.signal })
    return {
      hwnd: String(result.hwnd),
      title: String(result.title),
      processName: String(result.processName),
      pid: Number(result.pid),
    }
  },
  presentCall: (args) => presentCall('Focus window', args),
}

const computerMove = {
  name: 'computer_move',
  description:
    'Move the mouse cursor to absolute coordinates in physical pixels of the virtual desktop (see computer_screenshot for the size). Returns the resulting cursor position.',
  parameters: parametersSchema(
    {
      x: { type: 'integer', description: 'Absolute X coordinate in physical pixels.' },
      y: { type: 'integer', description: 'Absolute Y coordinate in physical pixels.' },
    },
    ['x', 'y'],
  ),
  output: {
    schema: objectSchema({
      x: { type: 'integer' },
      y: { type: 'integer' },
    }),
    render: (_args, value) => textResult(`Cursor is at ${value.x},${value.y}.`),
  },
  async execute(args, exec) {
    assertCoordinate(args.x, 'x')
    assertCoordinate(args.y, 'y')
    const result = await runScript('move.ps1', { x: args.x, y: args.y }, { signal: exec?.signal })
    return { x: Number(result.x), y: Number(result.y) }
  },
  presentCall: (args) => presentCall('Move mouse cursor', args),
}

const computerClick = {
  name: 'computer_click',
  description:
    'Click a mouse button at the current cursor position or at absolute coordinates. count 2 makes a double click. The click affects the real desktop: take a screenshot and check the target window first.',
  parameters: parametersSchema({
    x: { type: 'integer', description: 'Absolute X coordinate; omit to click at the current position.' },
    y: { type: 'integer', description: 'Absolute Y coordinate; omit to click at the current position.' },
    button: {
      type: 'string',
      enum: ['left', 'right', 'middle'],
      description: 'Mouse button, default left.',
    },
    count: { type: 'integer', description: 'Number of clicks, 1..10 (2 = double click), default 1.' },
  }),
  output: {
    schema: objectSchema({
      x: { type: 'integer' },
      y: { type: 'integer' },
      button: { type: 'string' },
      count: { type: 'integer' },
    }),
    render: (_args, value) =>
      textResult(`${value.button} click x${value.count} at ${value.x},${value.y}.`),
  },
  async execute(args, exec) {
    const coordinates = optionalCoordinates(args)
    const button = args.button ?? 'left'
    if (!['left', 'right', 'middle'].includes(button)) {
      throw new Error('invalid button: expected left, right or middle')
    }
    const count = args.count ?? 1
    if (!Number.isInteger(count) || count < 1 || count > 10) {
      throw new Error('invalid count: expected an integer 1..10')
    }
    const result = await runScript(
      'click.ps1',
      { ...coordinates, button, count },
      { signal: exec?.signal },
    )
    return {
      x: Number(result.x),
      y: Number(result.y),
      button: String(result.button),
      count: Number(result.count),
    }
  },
  presentCall: (args) => presentCall('Mouse click', args),
}

const computerType = {
  name: 'computer_type',
  description:
    'Type text into the currently focused control using Unicode keyboard input, optionally pressing Enter afterwards. Focus the target window first (computer_focus / computer_click). Newlines and tabs are sent as Enter/Tab keys.',
  parameters: parametersSchema(
    {
      text: { type: 'string', description: 'Text to type. Maximum 8000 characters.' },
      enter: { type: 'boolean', description: 'Press Enter after typing (default false).' },
      delayMs: {
        type: 'integer',
        description: 'Optional delay in milliseconds between characters, 0..500, for slow applications.',
      },
    },
    ['text'],
  ),
  output: {
    schema: objectSchema({
      chars: { type: 'integer' },
      enter: { type: 'boolean' },
    }),
    render: (_args, value) =>
      textResult(`Typed ${value.chars} character(s)${value.enter ? ' and pressed Enter' : ''}.`),
  },
  async execute(args, exec) {
    if (typeof args.text !== 'string' || args.text.length === 0) {
      throw new Error('invalid text: expected a non-empty string')
    }
    if (args.text.length > MAX_TEXT_LENGTH) {
      throw new Error(`invalid text: maximum length is ${MAX_TEXT_LENGTH} characters`)
    }
    if (args.delayMs !== undefined && (!Number.isInteger(args.delayMs) || args.delayMs < 0 || args.delayMs > 500)) {
      throw new Error('invalid delayMs: expected an integer 0..500')
    }
    const result = await runScript(
      'type.ps1',
      { text: args.text, enter: args.enter === true, delayMs: args.delayMs },
      { signal: exec?.signal },
    )
    return { chars: Number(result.chars), enter: result.enter === true }
  },
  presentCall: (args) => presentCall('Type text', args),
}

const computerKey = {
  name: 'computer_key',
  description:
    'Press a keyboard shortcut or key, e.g. "ctrl+s", "alt+tab", "win", "ctrl+shift+esc", "enter", "up". Modifiers are pressed first. Windows intercepts Ctrl+Alt+Delete, so that combination cannot be synthesized.',
  parameters: parametersSchema(
    {
      keys: {
        type: 'string',
        description: 'Key combination with "+" separators, e.g. "ctrl+s" or "win". Letters, digits, f1..f24 and named keys (enter, esc, tab, space, home, end, up, down, ...) are supported.',
      },
    },
    ['keys'],
  ),
  output: {
    schema: objectSchema({
      keys: { type: 'array', items: { type: 'string' } },
      count: { type: 'integer' },
    }),
    render: (_args, value) => textResult(`Pressed ${value.keys.join('+') || `${value.count} key(s)`}.`),
  },
  async execute(args, exec) {
    const parsed = parseKeyCombo(args.keys)
    const result = await runScript(
      'key.ps1',
      { keys: parsed.virtualKeys, tokens: parsed.tokens },
      { signal: exec?.signal },
    )
    return {
      keys: Array.isArray(result.keys) ? result.keys : parsed.tokens,
      count: Number(result.count ?? parsed.tokens.length),
    }
  },
  presentCall: (args) => presentCall('Press keyboard shortcut', args),
}

const computerScroll = {
  name: 'computer_scroll',
  description:
    'Scroll the mouse wheel at the current cursor position or at absolute coordinates. Each click is one wheel notch (120 units).',
  parameters: parametersSchema(
    {
      direction: { type: 'string', enum: ['up', 'down'], description: 'Scroll direction.' },
      clicks: { type: 'integer', description: 'Number of wheel notches, 1..50, default 3.' },
      x: { type: 'integer', description: 'Optional absolute X coordinate to scroll at.' },
      y: { type: 'integer', description: 'Optional absolute Y coordinate to scroll at.' },
    },
    ['direction'],
  ),
  output: {
    schema: objectSchema({
      direction: { type: 'string' },
      clicks: { type: 'integer' },
    }),
    render: (_args, value) => textResult(`Scrolled ${value.direction} x${value.clicks}.`),
  },
  async execute(args, exec) {
    if (args.direction !== 'up' && args.direction !== 'down') {
      throw new Error('invalid direction: expected up or down')
    }
    const clicks = args.clicks ?? 3
    if (!Number.isInteger(clicks) || clicks < 1 || clicks > 50) {
      throw new Error('invalid clicks: expected an integer 1..50')
    }
    const coordinates = optionalCoordinates(args)
    const result = await runScript(
      'scroll.ps1',
      { direction: args.direction, clicks, ...coordinates },
      { signal: exec?.signal },
    )
    return { direction: String(result.direction), clicks: Number(result.clicks) }
  },
  presentCall: (args) => presentCall('Scroll mouse wheel', args),
}

const computerClipboard = {
  name: 'computer_clipboard',
  description:
    'Read or write the Windows text clipboard. action "get" returns the current text; action "set" replaces it and returns what was written. Useful to move long text without synthesizing every keystroke.',
  parameters: parametersSchema(
    {
      action: { type: 'string', enum: ['get', 'set'], description: 'get reads the clipboard, set replaces it.' },
      text: { type: 'string', description: 'Text to place on the clipboard; required for action "set".' },
    },
    ['action'],
  ),
  output: {
    schema: objectSchema({
      action: { type: 'string' },
      text: { type: 'string' },
    }),
    render: (_args, value) =>
      textResult(
        value.action === 'get'
          ? `Clipboard text (${value.text.length} chars): ${value.text}`
          : `Clipboard replaced (${value.text.length} chars).`,
      ),
  },
  async execute(args, exec) {
    if (args.action !== 'get' && args.action !== 'set') {
      throw new Error('invalid action: expected get or set')
    }
    if (args.action === 'set' && typeof args.text !== 'string') {
      throw new Error('invalid text: a string is required when action is "set"')
    }
    const result = await runScript(
      'clipboard.ps1',
      { action: args.action, ...(args.action === 'set' ? { text: args.text } : {}) },
      { signal: exec?.signal },
    )
    return { action: String(result.action), text: String(result.text ?? '') }
  },
  presentCall: (args) => presentCall('Clipboard access', args),
}

const TOOLS = [
  computerScreenshot,
  computerWindows,
  computerFocus,
  computerMove,
  computerClick,
  computerType,
  computerKey,
  computerScroll,
  computerClipboard,
]

export function apply(ctx) {
  if (process.platform !== 'win32') return
  for (const tool of TOOLS) ctx.tools.register(tool)
}
