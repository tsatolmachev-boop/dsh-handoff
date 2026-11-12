#!/usr/bin/env node
/**
 * DSH Browser Bridge
 * ------------------------------------------------------------------
 * Two roles in one process:
 *   1. MCP server over stdio (spawned by @deepseek-ai/dsh-mcp-client)
 *      so the DeepSeek Harness agent gets `mcp__browser__*` tools.
 *   2. Local HTTP server (127.0.0.1 only) with long-polling, used by the
 *      "DSH Browser Agent" Chrome extension to receive actions and post
 *      their results.
 *
 * Zero dependencies. CommonJS on purpose: the parent DSH installation may
 * define "type": "module" for .js files; .cjs is always CommonJS.
 *
 * IMPORTANT: stdout carries JSON-RPC only. All logging goes to stderr.
 */
'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const VERSION = '1.0.0';
const PROTOCOL_VERSION = '2025-06-18';
const SERVER_NAME = 'dsh-browser-bridge';

const ACTION_TIMEOUT_MS = 30000;
const POLL_TIMEOUT_MS = 25000;
const STALE_MS = 15000;
const MAX_BODY_BYTES = 30 * 1024 * 1024;

function log(...args) {
  try {
    process.stderr.write('[dsh-browser-bridge] ' + args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ') + '\n');
  } catch { /* ignore */ }
}

// Protect stdout: any accidental console.log goes to stderr.
for (const k of ['log', 'info', 'debug', 'trace']) console[k] = (...a) => log(...a);

// ---------------------------------------------------------------- args ---
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') out.port = Number(argv[++i]);
    else if (a.startsWith('--port=')) out.port = Number(a.slice(7));
    else if (a === '--screenshots') out.screenshots = argv[++i];
    else if (a.startsWith('--screenshots=')) out.screenshots = a.slice(14);
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const opts = parseArgs(process.argv.slice(2));
const PORT = Number.isFinite(opts.port) && opts.port > 0 ? opts.port : 8765;
const SHOT_DIR = path.resolve(
  opts.screenshots || process.env.DSH_BROWSER_SCREENSHOT_DIR || path.join(os.tmpdir(), 'dsh-browser-agent', 'screenshots'),
);
try {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
} catch (err) {
  log('cannot create screenshot dir', SHOT_DIR, err.message);
}

// ------------------------------------------------------- extension state ---
const ext = {
  clientId: null,
  version: null,
  paused: false,
  instructions: '',
  activeTab: null,
  lastSeen: 0,
  userAgent: null,
};
let activePolls = 0;
/** @type {Array<{res: http.ServerResponse, timer: NodeJS.Timeout|null, finish: Function}>} */
const pollWaiters = [];
/** @type {Array<{id: string, action: string, params: object, ts: number}>} */
const actionQueue = [];
/** @type {Map<string, {resolve: Function, reject: Function, timer: NodeJS.Timeout, action: string}>} */
const pending = new Map();

function extConnected() {
  return activePolls > 0 || Date.now() - ext.lastSeen < STALE_MS;
}

function statusText() {
  const lines = [];
  if (extConnected()) {
    lines.push(`Extension: connected${ext.version ? ' (v' + ext.version + ')' : ''} | paused: ${ext.paused ? 'YES' : 'no'}`);
  } else {
    lines.push('Extension: NOT CONNECTED.');
    lines.push('Ask the user to open Chrome with the "DSH Browser Agent" extension enabled, then open its side panel (click the extension icon).');
  }
  lines.push(`Bridge: 127.0.0.1:${PORT} | screenshots dir: ${SHOT_DIR}`);
  const t = ext.activeTab;
  lines.push(
    t
      ? `Active tab: [${t.id}] "${t.title || ''}" - ${t.url || ''}`
      : 'Active tab: (unknown - connect the extension or call browser_tabs)',
  );
  lines.push(`User role instructions: ${ext.instructions ? JSON.stringify(ext.instructions) : '(none)'}`);
  return lines.join('\n');
}

function formatTabs(data) {
  const tabs = Array.isArray(data && data.tabs) ? data.tabs : [];
  if (!tabs.length) return 'No tabs reported.';
  const lines = [`Tabs (${tabs.length}):`];
  for (const t of tabs) {
    lines.push(`[${t.id}]${t.active ? ' *active*' : ''} "${t.title || ''}" - ${t.url || ''}`);
  }
  return lines.join('\n');
}

function formatSnapshot(data) {
  if (!data || typeof data !== 'object') return '(empty snapshot)';
  const lines = [];
  lines.push(`URL: ${data.url || ''}`);
  lines.push(`TITLE: ${data.title || ''}`);
  if (data.viewport) lines.push(`VIEWPORT: ${data.viewport.width}x${data.viewport.height} | scrollY=${data.scrollY || 0}`);
  if (data.activeElement) lines.push(`FOCUS: ${data.activeElement}`);
  const els = Array.isArray(data.elements) ? data.elements : [];
  lines.push('');
  lines.push(`ELEMENTS (${els.length}):`);
  for (const el of els) {
    const flags = [];
    if (el.disabled) flags.push('disabled');
    if (el.checked) flags.push('checked');
    if (el.editable) flags.push('editable');
    if (el.expanded) flags.push('expanded');
    if (el.selected) flags.push('selected');
    if (el.href) flags.push('href=' + el.href);
    if (el.type) flags.push('type=' + el.type);
    if (el.value !== undefined && el.value !== null && el.value !== '') flags.push('value=' + JSON.stringify(String(el.value).slice(0, 80)));
    const name = el.name ? ' "' + String(el.name).slice(0, 120) + '"' : '';
    const role = el.role ? ' [' + el.role + ']' : '';
    lines.push(`${el.ref} <${el.tag}>${role}${name}${flags.length ? ' (' + flags.join(', ') + ')' : ''}`);
  }
  if (Array.isArray(data.frames) && data.frames.length) {
    lines.push('');
    lines.push(`FRAMES: ${data.frames.map((f) => f.frameId + ' ' + (f.url || '')).join(' | ')}`);
  }
  if (data.text) {
    lines.push('');
    lines.push('PAGE TEXT (visible):');
    lines.push(String(data.text).slice(0, 12000));
  }
  return lines.join('\n');
}

function formatClickResult(action, params, data) {
  const parts = [`Performed ${action}${params && params.ref ? ' on ' + params.ref : ''}.`];
  if (data && data.title) parts.push(`Tab: [${data.tabId || '?'}] "${data.title}" - ${data.url || ''}`);
  if (data && data.frameUrl) parts.push(`Frame: ${data.frameUrl}`);
  if (data && data.text) parts.push(`Target: ${data.text}`);
  if (data && data.note) parts.push(data.note);
  return parts.join('\n');
}

// ------------------------------------------------------------ action bus ---
function replyJSON(res, code, obj) {
  if (res.writableEnded) return;
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function deliverAction(env) {
  while (pollWaiters.length) {
    const w = pollWaiters.shift();
    if (!w) break;
    if (w.res.writableEnded || w.res.destroyed) continue;
    try {
      w.finish(200, { action: env, serverTime: Date.now() });
      log('dispatched action', env.action, env.id);
      return true;
    } catch (err) {
      log('dispatch failed', err && err.message);
      continue;
    }
  }
  actionQueue.push(env);
  return true;
}

function sendAction(action, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!extConnected()) {
      reject(
        new Error(
          'The Chrome extension "DSH Browser Agent" is not connected. Ask the user to open Chrome, click the extension icon to open its side panel, and make sure the panel shows "Подключено".',
        ),
      );
      return;
    }
    if (ext.paused && action !== 'instructions' && action !== 'status') {
      reject(new Error('The browser agent is PAUSED by the user in the extension panel. Ask the user to click "Продолжить" before any browser action.'));
      return;
    }
    const id = crypto.randomUUID();
    const env = { id, action, params: params || {}, ts: Date.now() };
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Browser action "${action}" timed out after ${Math.round(timeoutMs / 1000)}s. The page may be busy; try browser_status and a fresh browser_snapshot.`));
    }, timeoutMs || ACTION_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer, action });
    deliverAction(env);
  });
}

// ------------------------------------------------------------- MCP tools ---
const TOOLS = [
  {
    name: 'status',
    description:
      'Check the browser bridge: whether the Chrome extension is connected, whether the agent is paused, the active tab, and the user-defined role instructions. Call this first in any browser task.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'tabs',
    description:
      'List, open, close or activate browser tabs. Actions: list | open (needs url) | close (needs tabId) | activate (needs tabId).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'open', 'close', 'activate'] },
        tabId: { type: 'number', description: 'Chrome tab id' },
        url: { type: 'string', description: 'URL to open (action=open)' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'snapshot',
    description:
      'Get the current page as text: URL, title, visible page text and a numbered list of interactive elements (@e1, @e2 ...). Always call this before clicking or typing; refs become stale after any action or page change.',
    inputSchema: {
      type: 'object',
      properties: {
        tab_id: { type: 'number', description: 'Optional tab id, defaults to the active tab' },
        include_text: { type: 'boolean', description: 'Include visible page text (default true)' },
        max_elements: { type: 'number', description: 'Max interactive elements, default 150, max 400' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'navigate',
    description: 'Navigate the active tab (or a new tab) to a URL and wait for the page to load. Returns the resulting URL/title; then call browser_snapshot.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute URL, e.g. https://web.max.ru/' },
        new_tab: { type: 'boolean', description: 'Open in a new tab instead of the active one' },
        wait_ms: { type: 'number', description: 'Extra wait after load, default 400' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'click',
    description:
      'Click an element from the latest snapshot by its ref (e.g. "@e12"). Dispatches real pointer/mouse events. Take a fresh snapshot afterwards to verify the result.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Element ref from the latest browser_snapshot, e.g. @e12' },
        tab_id: { type: 'number' },
      },
      required: ['ref'],
      additionalProperties: false,
    },
  },
  {
    name: 'type',
    description: 'Type text into an input/textarea/contenteditable from the latest snapshot (by ref), or into the focused element when ref is omitted. Optionally submit with Enter.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Element ref from the latest snapshot, e.g. @e7' },
        text: { type: 'string', description: 'Text to type' },
        clear: { type: 'boolean', description: 'Clear the field first (default true)' },
        submit: { type: 'boolean', description: 'Press Enter after typing (default false)' },
        tab_id: { type: 'number' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'press_key',
    description: 'Press a keyboard key on the focused element: Enter, Escape, Tab, ArrowUp, ArrowDown, Backspace, PageDown, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key name, e.g. Enter, Escape, Tab, ArrowDown' },
        tab_id: { type: 'number' },
      },
      required: ['key'],
      additionalProperties: false,
    },
  },
  {
    name: 'scroll',
    description: 'Scroll the page or the largest scrollable container (chat/message list). Direction: up | down | top | bottom.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'] },
        amount: { type: 'number', description: 'Pixels for up/down, default 600' },
        tab_id: { type: 'number' },
      },
      required: ['direction'],
      additionalProperties: false,
    },
  },
  {
    name: 'screenshot',
    description: 'Capture a PNG screenshot of the visible tab area and save it to disk. Returns the file path; the image itself can be opened with a file/image reading tool.',
    inputSchema: {
      type: 'object',
      properties: {
        tab_id: { type: 'number', description: 'Optional tab id; it will be brought to front first' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'wait',
    description: 'Wait for a number of milliseconds and/or until the given text appears on the page. Useful after clicks that load content.',
    inputSchema: {
      type: 'object',
      properties: {
        ms: { type: 'number', description: 'Milliseconds to wait (max 20000)' },
        text: { type: 'string', description: 'Text to wait for in the page body' },
        tab_id: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'instructions',
    description:
      'Read the user-defined role/instructions for the browser agent. Pass text to update them (the user can also edit them in the extension panel).',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'New role/instructions to store' },
      },
      additionalProperties: false,
    },
  },
];

const SERVER_INSTRUCTIONS = [
  'DSH Browser Bridge controls the user\'s real Chrome browser through the "DSH Browser Agent" extension.',
  'Workflow: browser_status -> browser_snapshot -> browser_click / browser_type -> browser_snapshot to verify.',
  'Element refs (@e12) come from the latest snapshot and go stale after any action or page change; take a new snapshot each time.',
  'These actions run in the user\'s real browser with their real logged-in accounts. Prefer read-only steps; do not buy, delete, publish, or message third parties without explicit user confirmation.',
  'If browser_status says the agent is paused, or the extension is not connected, stop and tell the user what to do.',
  'If the user configured role instructions, browser_status returns them; follow them.',
].join(' ');

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

async function callTool(name, args) {
  args = args && typeof args === 'object' ? args : {};
  switch (name) {
    case 'status':
      return { content: [{ type: 'text', text: statusText() }] };

    case 'tabs': {
      const action = args.action;
      if (!['list', 'open', 'close', 'activate'].includes(action)) {
        throw new Error('tabs: action must be one of list, open, close, activate');
      }
      if (action === 'open' && (!args.url || typeof args.url !== 'string')) throw new Error('tabs: url is required for action=open');
      if ((action === 'close' || action === 'activate') && !Number.isFinite(Number(args.tabId))) throw new Error('tabs: tabId is required for action=' + action);
      const data = await sendAction(
        'tabs',
        { action, tabId: args.tabId == null ? undefined : Number(args.tabId), url: args.url },
        20000,
      );
      return { content: [{ type: 'text', text: formatTabs(data) }] };
    }

    case 'snapshot': {
      const data = await sendAction(
        'snapshot',
        {
          tabId: args.tab_id == null ? undefined : Number(args.tab_id),
          includeText: args.include_text !== false,
          maxElements: clamp(args.max_elements, 1, 400, 150),
        },
        30000,
      );
      return { content: [{ type: 'text', text: formatSnapshot(data) }] };
    }

    case 'navigate': {
      if (!args.url || typeof args.url !== 'string') throw new Error('navigate: url is required');
      const data = await sendAction(
        'navigate',
        { url: args.url, newTab: !!args.new_tab, waitMs: clamp(args.wait_ms, 0, 15000, 400) },
        45000,
      );
      return {
        content: [
          {
            type: 'text',
            text:
              `Navigation complete.\nURL: ${data && data.url}\nTITLE: ${data && data.title}\nTAB: ${data && data.tabId}\n` +
              'Call browser_snapshot to see the page elements.',
          },
        ],
      };
    }

    case 'click': {
      if (!args.ref || typeof args.ref !== 'string') throw new Error('click: ref is required, e.g. @e12');
      const data = await sendAction('click', { ref: args.ref, tabId: args.tab_id == null ? undefined : Number(args.tab_id) }, 25000);
      return { content: [{ type: 'text', text: formatClickResult('click', args, data) }] };
    }

    case 'type': {
      if (typeof args.text !== 'string') throw new Error('type: text must be a string');
      const data = await sendAction(
        'type',
        {
          ref: args.ref || null,
          text: args.text,
          clear: args.clear !== false,
          submit: !!args.submit,
          tabId: args.tab_id == null ? undefined : Number(args.tab_id),
        },
        25000,
      );
      return { content: [{ type: 'text', text: formatClickResult('type', args, data) }] };
    }

    case 'press_key': {
      if (!args.key || typeof args.key !== 'string') throw new Error('press_key: key is required');
      const data = await sendAction('press_key', { key: args.key, tabId: args.tab_id == null ? undefined : Number(args.tab_id) }, 15000);
      return { content: [{ type: 'text', text: `Pressed ${args.key}.` + (data && data.note ? ' ' + data.note : '') }] };
    }

    case 'scroll': {
      const direction = ['up', 'down', 'top', 'bottom'].includes(args.direction) ? args.direction : 'down';
      const data = await sendAction(
        'scroll',
        { direction, amount: clamp(args.amount, 50, 5000, 600), tabId: args.tab_id == null ? undefined : Number(args.tab_id) },
        15000,
      );
      return {
        content: [
          {
            type: 'text',
            text: `Scrolled ${direction}. ${data && data.scrollY != null ? 'scrollY=' + data.scrollY : ''}${data && data.container ? ' container=' + data.container : ''}`,
          },
        ],
      };
    }

    case 'screenshot': {
      const data = await sendAction(
        'screenshot',
        { tabId: args.tab_id == null ? undefined : Number(args.tab_id) },
        25000,
      );
      const m = typeof data.dataUrl === 'string' ? /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(data.dataUrl) : null;
      if (!m) throw new Error('screenshot: extension returned an unexpected image payload');
      const extName = m[1] === 'jpeg' ? 'jpg' : m[1];
      const file = path.join(SHOT_DIR, `shot-${new Date().toISOString().replace(/[:.]/g, '-')}.${extName}`);
      fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
      const info = data.tab ? `tab [${data.tab.id}] "${data.tab.title || ''}" - ${data.tab.url || ''}` : 'tab (unknown)';
      return { content: [{ type: 'text', text: `Screenshot saved: ${file}\nfrom ${info}` }] };
    }

    case 'wait': {
      const data = await sendAction(
        'wait',
        {
          ms: clamp(args.ms, 0, 20000, 0),
          text: typeof args.text === 'string' && args.text ? args.text : null,
          tabId: args.tab_id == null ? undefined : Number(args.tab_id),
        },
        25000,
      );
      const parts = [`Waited ${data && data.elapsedMs != null ? data.elapsedMs : '?'} ms.`];
      if (data && data.text) parts.push(data.matched ? 'Text found on page.' : 'Text NOT found (timeout).');
      return { content: [{ type: 'text', text: parts.join(' ') }] };
    }

    case 'instructions': {
      if (typeof args.text === 'string') {
        ext.instructions = args.text;
        try {
          await sendAction('instructions', { text: args.text }, 10000);
        } catch (err) {
          log('could not push instructions to extension:', err.message);
        }
        return { content: [{ type: 'text', text: 'Role instructions updated:\n' + args.text }] };
      }
      return { content: [{ type: 'text', text: ext.instructions || '(no role instructions configured)' }] };
    }

    default:
      throw new Error('Unknown tool: ' + name);
  }
}

// -------------------------------------------------------------- MCP loop ---
function writeMCP(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function mcpError(id, code, message) {
  writeMCP({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handleRequest(id, method, params) {
  switch (method) {
    case 'initialize':
      writeMCP({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: VERSION },
          instructions: SERVER_INSTRUCTIONS,
        },
      });
      return;
    case 'ping':
      writeMCP({ jsonrpc: '2.0', id, result: {} });
      return;
    case 'tools/list':
      writeMCP({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      return;
    case 'tools/call': {
      const toolName = params && params.name;
      const tool = TOOLS.find((t) => t.name === toolName);
      if (!tool) {
        mcpError(id, -32602, 'Unknown tool: ' + String(toolName));
        return;
      }
      try {
        const result = await callTool(toolName, params.arguments);
        writeMCP({ jsonrpc: '2.0', id, result });
      } catch (err) {
        writeMCP({
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: 'Browser tool error: ' + (err && err.message ? err.message : String(err)) }], isError: true },
        });
      }
      return;
    }
    case 'resources/list':
      writeMCP({ jsonrpc: '2.0', id, result: { resources: [] } });
      return;
    case 'resources/templates/list':
      writeMCP({ jsonrpc: '2.0', id, result: { resourceTemplates: [] } });
      return;
    case 'prompts/list':
      writeMCP({ jsonrpc: '2.0', id, result: { prompts: [] } });
      return;
    case 'logging/setLevel':
      writeMCP({ jsonrpc: '2.0', id, result: {} });
      return;
    default:
      mcpError(id, -32601, 'Method not found: ' + String(method));
  }
}

function handleMCPMessage(msg) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return;
  if (typeof msg.method === 'string') {
    if (msg.id !== undefined && msg.id !== null) {
      handleRequest(msg.id, msg.method, msg.params || {}).catch((err) => mcpError(msg.id, -32603, String((err && err.message) || err)));
    } else if (msg.method === 'notifications/cancelled' && msg.params && msg.params.requestId !== undefined) {
      const requestId = String(msg.params.requestId);
      for (const [id] of pending) {
        if (id === requestId) {
          const entry = pending.get(id);
          pending.delete(id);
          clearTimeout(entry.timer);
          entry.reject(new Error('Cancelled by client'));
        }
      }
    }
    return;
  }
  // Server never sends requests, so client responses are ignored.
}

let mcpBuffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  mcpBuffer += chunk;
  let idx;
  while ((idx = mcpBuffer.indexOf('\n')) >= 0) {
    const line = mcpBuffer.slice(0, idx).replace(/\r$/, '');
    mcpBuffer = mcpBuffer.slice(idx + 1);
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      log('invalid JSON on stdin:', line.slice(0, 300));
      continue;
    }
    try {
      handleMCPMessage(msg);
    } catch (err) {
      log('MCP handler error:', err && err.stack ? err.stack : err);
    }
  }
});
process.stdin.on('end', () => {
  setTimeout(() => shutdown(0), 150);
});

// ------------------------------------------------------------- HTTP side ---
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function normalizeActiveTab(tab) {
  if (!tab || typeof tab !== 'object') return null;
  return { id: Number(tab.id), title: String(tab.title || ''), url: String(tab.url || '') };
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (req.method === 'GET' && url.pathname === '/api/status') {
      replyJSON(res, 200, {
        ok: true,
        bridge: { name: SERVER_NAME, version: VERSION, port: PORT },
        ext: {
          connected: extConnected(),
          clientId: ext.clientId,
          version: ext.version,
          paused: ext.paused,
          instructions: ext.instructions,
          activeTab: ext.activeTab,
          lastSeen: ext.lastSeen,
        },
        queue: actionQueue.length,
        pending: pending.size,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/poll') {
      const client = url.searchParams.get('client');
      if (client) ext.clientId = client;
      ext.lastSeen = Date.now();
      if (actionQueue.length) {
        replyJSON(res, 200, { action: actionQueue.shift(), serverTime: Date.now() });
        return;
      }
      activePolls++;
      let done = false;
      const waiter = {
        res,
        timer: null,
        finish(code, payload) {
          if (done) return;
          done = true;
          activePolls = Math.max(0, activePolls - 1);
          if (waiter.timer) clearTimeout(waiter.timer);
          const at = pollWaiters.indexOf(waiter);
          if (at >= 0) pollWaiters.splice(at, 1);
          if (res.writableEnded) return;
          if (code === 204) {
            res.writeHead(204, { 'Cache-Control': 'no-store' });
            res.end();
          } else {
            replyJSON(res, code, payload);
          }
        },
      };
      waiter.timer = setTimeout(() => waiter.finish(204), POLL_TIMEOUT_MS);
      pollWaiters.push(waiter);
      req.on('close', () => waiter.finish(204));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/hello') {
      const body = await readBody(req);
      ext.clientId = body.clientId || ext.clientId;
      ext.version = body.version || ext.version;
      ext.paused = !!body.paused;
      ext.instructions = typeof body.instructions === 'string' ? body.instructions : ext.instructions;
      ext.userAgent = body.userAgent || ext.userAgent;
      ext.activeTab = normalizeActiveTab(body.activeTab) || ext.activeTab;
      ext.lastSeen = Date.now();
      log('hello from extension', ext.clientId, 'v' + ext.version, 'paused=' + ext.paused);
      replyJSON(res, 200, { ok: true, server: SERVER_NAME, bridgeVersion: VERSION });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/result') {
      const body = await readBody(req);
      const id = String(body.id || '');
      const entry = pending.get(id);
      ext.lastSeen = Date.now();
      if (body.activeTab) ext.activeTab = normalizeActiveTab(body.activeTab) || ext.activeTab;
      if (body.instructions !== undefined) ext.instructions = String(body.instructions || '');
      if (entry) {
        pending.delete(id);
        clearTimeout(entry.timer);
        if (body.ok) {
          log('result ok', entry.action);
          entry.resolve(body.data);
        } else {
          log('result error', entry.action, body.error);
          entry.reject(new Error(body.error || 'Browser action failed'));
        }
      } else {
        log('result for unknown action id', id);
      }
      replyJSON(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      replyJSON(res, 200, { ok: true, version: VERSION });
      return;
    }

    replyJSON(res, 404, { ok: false, error: 'not found' });
  } catch (err) {
    log('HTTP error on', url.pathname, err && err.message);
    replyJSON(res, 400, { ok: false, error: String((err && err.message) || err) });
  }
});

let listenRetry = 0;
function listen() {
  httpServer.listen(PORT, '127.0.0.1', () => {
    log(`HTTP listening on http://127.0.0.1:${PORT} | screenshots: ${SHOT_DIR}`);
  });
  httpServer.once('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      listenRetry++;
      const delay = Math.min(5000, 500 * listenRetry);
      log(`port ${PORT} busy, retry in ${delay} ms`);
      setTimeout(() => {
        try {
          httpServer.close();
        } catch { /* ignore */ }
        httpServer.listen(PORT, '127.0.0.1');
      }, delay);
      return;
    }
    log('HTTP server error:', err && err.message);
  });
}
listen();

// ------------------------------------------------------------- lifecycle ---
let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    httpServer.close();
  } catch { /* ignore */ }
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    try {
      entry.reject(new Error('bridge shutting down'));
    } catch { /* ignore */ }
  }
  process.exit(code || 0);
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
process.on('uncaughtException', (err) => log('uncaught exception:', err && err.stack ? err.stack : err));
process.on('unhandledRejection', (err) => log('unhandled rejection:', err && err.stack ? err.stack : err));

log(`started v${VERSION} | port=${PORT} | node=${process.version}`);
