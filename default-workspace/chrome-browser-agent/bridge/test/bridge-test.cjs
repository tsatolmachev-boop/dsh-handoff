#!/usr/bin/env node
/**
 * Self-test for bridge.cjs: spawns the bridge, acts as an MCP client over
 * stdio AND as a mock Chrome extension over HTTP long-polling.
 *
 * Run:  node bridge/test/bridge-test.cjs
 */
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 8991;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOT_DIR = path.join(os.tmpdir(), 'dsh-browser-agent-test', 'shots');
const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

let failures = 0;
function check(name, ok, details) {
  if (ok) {
    console.log('  PASS ' + name);
  } else {
    failures++;
    console.log('  FAIL ' + name + (details ? ' -> ' + details : ''));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(BASE + '/api/health');
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await sleep(100);
  }
  return false;
}

// ------------------------------------------------------------- MCP client ---
function createMcpClient(child) {
  let buffer = '';
  let nextId = 1;
  const waiting = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch (err) {
        console.log('  [client] bad stdout JSON:', line.slice(0, 200));
        continue;
      }
      if (msg.id !== undefined && waiting.has(msg.id)) {
        const { resolve, reject, timer } = waiting.get(msg.id);
        waiting.delete(msg.id);
        clearTimeout(timer);
        if (msg.error) reject(new Error(msg.error.message || 'MCP error'));
        else resolve(msg.result);
      }
    }
  });
  function request(method, params) {
    const id = nextId++;
    const payload = { jsonrpc: '2.0', id, method, params: params || {} };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error('MCP request timeout: ' + method));
      }, 15000);
      waiting.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify(payload) + '\n');
    });
  }
  function notify(method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params: params || {} }) + '\n');
  }
  return { request, notify };
}

// ------------------------------------------------------- mock extension ---
function startMockExtension(state) {
  let running = true;
  const loop = (async () => {
    while (running) {
      try {
        const res = await fetch(`${BASE}/api/poll?client=mock-extension`, { signal: AbortSignal.timeout(30000) });
        if (res.status === 204) continue;
        if (!res.ok) {
          await sleep(500);
          continue;
        }
        const body = await res.json();
        const action = body.action;
        if (!action) continue;
        console.log('  [mock] action:', action.action, JSON.stringify(action.params));
        let data;
        let error = null;
        try {
          data = await mockPerform(action.action, action.params || {});
        } catch (err) {
          error = err.message;
        }
        await fetch(BASE + '/api/result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: action.id, ok: !error, data, error }),
        });
      } catch (err) {
        if (running) await sleep(300);
      }
    }
  })();

  async function mockPerform(action, params) {
    switch (action) {
      case 'snapshot':
        return {
          url: 'https://web.max.ru/',
          title: 'Непрочитанные чаты',
          viewport: { width: 1280, height: 800 },
          scrollY: 0,
          elements: [
            { ref: '@e1', tag: 'button', role: 'button', name: 'Написать', cursor: 'pointer' },
            { ref: '@e2', tag: 'div', role: 'button', name: 'ТекСтрой Оплаты' },
            { ref: '@e3', tag: 'div', name: 'Сообщение', editable: true },
          ],
          text: 'Написать\nТекСтрой Оплаты\nИрина снабжение: Договор отправили в эдо.',
        };
      case 'tabs':
        return { tabs: [{ id: 1, title: 'Непрочитанные чаты', url: 'https://web.max.ru/', active: true }] };
      case 'navigate':
        return { url: params.url, title: 'Max', tabId: 1 };
      case 'click':
        return { tabId: 1, title: 'Непрочитанные чаты', url: 'https://web.max.ru/', text: 'кнопка нажата' };
      case 'type':
        return { tabId: 1, title: 'Непрочитанные чаты', url: 'https://web.max.ru/', text: 'введено' };
      case 'scroll':
        return { scrollY: 600, container: 'window' };
      case 'press_key':
        return { note: 'ok' };
      case 'wait':
        return { elapsedMs: params.ms || 0, matched: true, text: params.text };
      case 'screenshot':
        return { dataUrl: PNG_1X1, tab: { id: 1, title: 'Непрочитанные чаты', url: 'https://web.max.ru/' } };
      case 'instructions':
        return { ok: true };
      default:
        throw new Error('mock: unknown action ' + action);
    }
  }

  return {
    stop() {
      running = false;
    },
    loop,
  };
}

async function postHello(patch) {
  const res = await fetch(BASE + '/api/hello', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: 'mock-extension',
      version: '9.9.9',
      paused: false,
      instructions: '',
      activeTab: { id: 1, title: 'Непрочитанные чаты', url: 'https://web.max.ru/' },
      ...patch,
    }),
  });
  return res.json();
}

// ------------------------------------------------------------------ main ---
(async () => {
  fs.rmSync(path.join(os.tmpdir(), 'dsh-browser-agent-test'), { recursive: true, force: true });
  console.log('--- bridge self-test ---');
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'bridge.cjs'), '--port', String(PORT), '--screenshots', SHOT_DIR], {
    cwd: path.join(__dirname, '..'),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d) => process.stderr.write('[bridge] ' + d));

  const healthy = await waitForHealth();
  check('bridge HTTP health endpoint', healthy);
  if (!healthy) {
    child.kill();
    process.exit(1);
  }

  const mcp = createMcpClient(child);
  const init = await mcp.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'bridge-test', version: '1.0.0' },
  });
  check('MCP initialize: protocolVersion', init.protocolVersion === '2025-06-18', JSON.stringify(init).slice(0, 200));
  check('MCP initialize: tools capability', !!init.capabilities && !!init.capabilities.tools);
  check('MCP initialize: instructions present', typeof init.instructions === 'string' && init.instructions.length > 20);
  mcp.notify('notifications/initialized');

  const list = await mcp.request('tools/list');
  const names = (list.tools || []).map((t) => t.name).sort();
  check('tools/list returns 11 tools', names.length === 11, names.join(','));
  for (const n of ['status', 'tabs', 'snapshot', 'navigate', 'click', 'type', 'press_key', 'scroll', 'screenshot', 'wait', 'instructions']) {
    check('tool ' + n + ' listed', names.includes(n));
  }

  const statusBefore = await mcp.request('tools/call', { name: 'status', arguments: {} });
  const textBefore = statusBefore.content[0].text;
  check('status before extension: NOT CONNECTED', textBefore.includes('NOT CONNECTED'));

  const snapshotOffline = await mcp.request('tools/call', { name: 'snapshot', arguments: {} });
  check('snapshot without extension: isError', snapshotOffline.isError === true);
  check(
    'snapshot without extension: helpful message',
    textBefore.includes('NOT CONNECTED') && /extension/i.test(snapshotOffline.content[0].text),
    snapshotOffline.content[0].text.slice(0, 160),
  );

  const hello = await postHello({ instructions: 'Ты — помощник по Max. Отвечай по-русски.' });
  check('hello accepted', hello.ok === true);
  const mock = startMockExtension();

  await sleep(300);
  const status = await mcp.request('tools/call', { name: 'status', arguments: {} });
  const statusText = status.content[0].text;
  check('status connected', /connected/i.test(statusText), statusText.slice(0, 120));
  check('status shows active tab', statusText.includes('web.max.ru'), statusText.slice(0, 200));
  check('status shows role instructions', statusText.includes('помощник по Max'));

  const snap = await mcp.request('tools/call', { name: 'snapshot', arguments: { include_text: true } });
  const snapText = snap.content[0].text;
  check('snapshot formatted URL', snapText.includes('URL: https://web.max.ru/'));
  check('snapshot lists element @e1', snapText.includes('@e1 <button>') && snapText.includes('"Написать"'));
  check('snapshot includes text', snapText.includes('PAGE TEXT') && snapText.includes('ТекСтрой Оплаты'));

  const nav = await mcp.request('tools/call', { name: 'navigate', arguments: { url: 'https://web.max.ru/123' } });
  check('navigate ok', nav.content[0].text.includes('https://web.max.ru/123'));

  const click = await mcp.request('tools/call', { name: 'click', arguments: { ref: '@e2' } });
  check('click ok', click.isError !== true && click.content[0].text.includes('@e2'), JSON.stringify(click).slice(0, 200));

  const typeRes = await mcp.request('tools/call', { name: 'type', arguments: { ref: '@e3', text: 'Привет', submit: true } });
  check('type ok', typeRes.isError !== true && typeRes.content[0].text.includes('@e3'));

  const tabs = await mcp.request('tools/call', { name: 'tabs', arguments: { action: 'list' } });
  check('tabs list ok', tabs.content[0].text.includes('[1]') && tabs.content[0].text.includes('web.max.ru'));

  const shot = await mcp.request('tools/call', { name: 'screenshot', arguments: {} });
  const shotText = shot.content[0].text;
  check('screenshot path returned', shotText.includes('Screenshot saved:'));
  const shotPath = shotText.replace('Screenshot saved: ', '').split('\n')[0].trim();
  check('screenshot file exists', fs.existsSync(shotPath) && fs.statSync(shotPath).size > 0, shotPath);

  const wait = await mcp.request('tools/call', { name: 'wait', arguments: { ms: 5, text: 'Привет' } });
  check('wait ok', wait.content[0].text.includes('Text found'));

  const scroll = await mcp.request('tools/call', { name: 'scroll', arguments: { direction: 'down' } });
  check('scroll ok', scroll.content[0].text.includes('scrollY=600'));

  const instr = await mcp.request('tools/call', { name: 'instructions', arguments: {} });
  check('instructions readable', instr.content[0].text.includes('помощник по Max'));

  await postHello({ paused: true });
  await sleep(200);
  const clickPaused = await mcp.request('tools/call', { name: 'click', arguments: { ref: '@e1' } });
  check('click while paused rejected', clickPaused.isError === true && /PAUSED/i.test(clickPaused.content[0].text), clickPaused.content[0].text.slice(0, 160));
  const statusPaused = await mcp.request('tools/call', { name: 'status', arguments: {} });
  check('status works while paused', /paused: YES/i.test(statusPaused.content[0].text));

  await postHello({ paused: false });
  await sleep(200);

  console.log(failures === 0 ? '\nRESULT: ALL TESTS PASSED' : `\nRESULT: ${failures} FAILURE(S)`);
  mock.stop();
  child.kill();
  await sleep(300);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('TEST CRASH:', err);
  process.exit(2);
});
