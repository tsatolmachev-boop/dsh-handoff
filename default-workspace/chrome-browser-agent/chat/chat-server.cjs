#!/usr/bin/env node
/**
 * DSH Browser Chat — локальный «мозг» для боковой панели расширения.
 *
 * Почему отдельный процесс:
 *   - рисует чат в панели и не требует DSH-окна;
 *   - сам ведёт tool-loop через второй экземпляр browser-bridge (порт 8788);
 *   - DeepSeek-аккаунт DSH уже залогинен — берём его токен из ~/.dsh/.credentials.yaml
 *     и ходим в Anthropic-совместимый Messages API (https://api.deepseek.com/anthropic).
 *
 * Эндпоинты:
 *   POST /api/chat   { messages: [{role, content}], prompt }  → NDJSON-поток событий
 *   GET  /api/health
 *
 * События NDJSON: {type:'text',delta}, {type:'thinking'}, {type:'action',name,input},
 *                 {type:'action_done',name,ok,summary}, {type:'error',message}, {type:'done'}
 */
'use strict';

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const VERSION = '1.0.0';
const PORT = Number(process.env.DSH_CHAT_PORT || 8792);
const BRIDGE_PORT = 8788;
const BRIDGE_SCRIPT = path.join(__dirname, '..', 'bridge', 'bridge.cjs');
const SHOT_DIR = path.join(__dirname, '..', '.screenshots');
const CREDENTIALS_FILE = path.join(os.homedir(), '.dsh', '.credentials.yaml');
const API_ROOT = process.env.DSH_CHAT_API_ROOT || 'https://api.deepseek.com/anthropic';
const MODEL = process.env.DSH_CHAT_MODEL || 'deepseek-flash';
const MAX_STEPS = 8;
const MAX_TOKENS = 4096;

const SYSTEM_PROMPT = [
  'Ты — DSH Browser Agent: браузерный агент внутри настоящего Chrome пользователя.',
  'У тебя есть инструменты: status, tabs, snapshot, navigate, click, type, press_key, scroll, screenshot, wait.',
  'Всегда работай по схеме: status → snapshot → действие → snapshot для проверки.',
  'Ссылки @eN берутся из последнего snapshot и устаревают после любого действия — делай новый snapshot.',
  'Отвечай кратко, по-русски, без лишних рассуждений. Сначала действие, потом результат.',
  'Не делай покупок, удалений, отправки сообщений третьим лицам и публикаций без явного подтверждения пользователя.',
].join(' ');

const TOOL_LABELS = {
  status: 'проверяю браузер',
  tabs: 'вкладки',
  snapshot: 'читаю страницу',
  navigate: 'переход',
  click: 'клик',
  type: 'ввод текста',
  press_key: 'клавиша',
  scroll: 'прокрутка',
  screenshot: 'скриншот',
  wait: 'ожидание',
  instructions: 'роль',
};

function log(...args) {
  try {
    process.stderr.write('[dsh-chat] ' + args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n');
  } catch { /* ignore */ }
}

// ------------------------------------------------------------- credentials ---
function readAccountToken() {
  try {
    const text = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
    const block = /deepseek-account-platform\/default:[\s\S]{0,600}?token:\s*(\S+)/.exec(text);
    if (block) return block[1];
  } catch { /* ignore */ }
  return '';
}

// --------------------------------------------------------- MCP bridge child ---
class BridgeClient {
  constructor() {
    this.child = null;
    this.buffer = '';
    this.seq = 0;
    this.pending = new Map();
    this.tools = [];
    this.ready = null;
  }

  start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      try {
        this.child = spawn(
          process.execPath,
          [BRIDGE_SCRIPT, '--port', String(BRIDGE_PORT), '--screenshots', SHOT_DIR],
          { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
        );
      } catch (error) {
        reject(error);
        return;
      }
      this.child.stderr.on('data', (chunk) => log('bridge stderr:', String(chunk).trim().slice(0, 300)));
      this.child.on('exit', (code) => log('bridge exited', code));
      this.child.stdout.on('data', (chunk) => this.onData(chunk));
      this.child.on('error', (error) => log('bridge spawn error:', error.message));

      this.request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'dsh-browser-chat', version: VERSION },
      })
        .then(() => this.request('tools/list', {}))
        .then((result) => {
          this.tools = Array.isArray(result && result.tools) ? result.tools : [];
          log('bridge ready, tools:', this.tools.length);
          resolve(this);
        })
        .catch((error) => {
          log('bridge init failed:', error.message);
          reject(error);
        });
    });
    return this.ready;
  }

  onData(chunk) {
    this.buffer += String(chunk);
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, '');
      this.buffer = this.buffer.slice(index + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message && message.id !== undefined && this.pending.has(message.id)) {
        const entry = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(message.error.message || 'MCP error'));
        else entry.resolve(message.result);
      }
    }
  }

  request(method, params, timeoutMs = 45000) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('MCP timeout: ' + method));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }) + '\n');
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  async callTool(name, input) {
    const result = await this.request('tools/call', { name, arguments: input || {} });
    const blocks = result && Array.isArray(result.content) ? result.content : [];
    const text = blocks.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
    return { text: text || '(no output)', isError: Boolean(result && result.isError) };
  }

  stop() {
    try { this.child.kill(); } catch { /* ignore */ }
  }
}

const bridge = new BridgeClient();

// ------------------------------------------------------- Anthropic messages ---
function requestMessages(payload, token, handlers) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const url = new URL(API_ROOT + '/v1/messages');
    const request = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'x-dsh-auth-token': token,
          'anthropic-version': '2023-06-01',
          accept: 'text/event-stream',
        },
      },
      (response) => {
        if (response.statusCode !== 200) {
          let text = '';
          response.on('data', (chunk) => { text += chunk; });
          response.on('end', () => reject(new Error('LLM HTTP ' + response.statusCode + ': ' + text.slice(0, 400))));
          return;
        }
        let buffer = '';
        const content = [];
        let current = null;
        let stopReason = null;
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          buffer += chunk;
          let index;
          while ((index = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, index).replace(/\r$/, '');
            buffer = buffer.slice(index + 1);
            if (!line.startsWith('data:')) continue;
            const json = line.slice(5).trim();
            if (!json || json === '[DONE]') continue;
            let event;
            try {
              event = JSON.parse(json);
            } catch {
              continue;
            }
            handleEvent(event);
          }
        });
        response.on('end', () => resolve({ content: finalizeContent(content), stopReason }));
        function finalizeContent(blocks) {
          return blocks.filter(Boolean).map((block) => {
            if (block.type === 'tool_use') {
              try {
                block.input = block.inputText ? JSON.parse(block.inputText) : {};
              } catch {
                block.input = {};
              }
              delete block.inputText;
            }
            return block;
          });
        }
        function handleEvent(event) {
          switch (event.type) {
            case 'content_block_start': {
              const block = event.content_block || {};
              if (block.type === 'text') {
                current = { type: 'text', text: '' };
              } else if (block.type === 'tool_use') {
                current = { type: 'tool_use', id: block.id, name: block.name, inputText: '' };
              } else {
                current = { type: 'thinking', text: '' };
              }
              content[event.index] = current;
              break;
            }
            case 'content_block_delta': {
              const delta = event.delta || {};
              if (delta.type === 'text_delta' && current && current.type === 'text') {
                current.text += delta.text || '';
                handlers.onText(delta.text || '');
              } else if (delta.type === 'input_json_delta' && current && current.type === 'tool_use') {
                current.inputText += delta.partial_json || '';
              } else if (delta.type === 'thinking_delta') {
                handlers.onThinking();
              }
              break;
            }
            case 'content_block_stop':
              current = null;
              break;
            case 'message_delta':
              if (event.delta && event.delta.stop_reason) stopReason = event.delta.stop_reason;
              break;
            case 'error':
              handlers.onError(event.error && event.error.message ? event.error.message : 'LLM stream error');
              break;
            default:
              break;
          }
        }
      },
    );
    request.on('error', reject);
    request.setTimeout(120000, () => request.destroy(new Error('LLM request timeout')));
    request.write(body);
    request.end();
  });
}

function toolsForModel(tools) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description || '',
    input_schema: tool.inputSchema || { type: 'object', properties: {} },
  }));
}

function summarizeResult(result) {
  const text = String((result && result.text) || '');
  return text.length > 6000 ? text.slice(0, 6000) + '\n…[обрезано]' : text;
}

async function runAgent({ history, prompt, send }) {
  await bridge.start();
  const token = readAccountToken();
  if (!token) {
    send({ type: 'error', message: 'Не нашёл токен DeepSeek в ~/.dsh/.credentials.yaml. Войдите в DSH заново.' });
    send({ type: 'done' });
    return;
  }
  const messages = [];
  for (const entry of history || []) {
    if (!entry || !entry.content) continue;
    const role = entry.role === 'assistant' ? 'assistant' : 'user';
    messages.push({ role, content: [{ type: 'text', text: String(entry.content) }] });
  }
  messages.push({ role: 'user', content: [{ type: 'text', text: String(prompt || '') }] });

  for (let step = 0; step < MAX_STEPS; step++) {
    let assistantText = '';
    const payload = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages,
      tools: toolsForModel(bridge.tools),
      stream: true,
    };
    const { content, stopReason } = await requestMessages(payload, token, {
      onText: (delta) => { assistantText += delta; send({ type: 'text', delta }); },
      onThinking: () => send({ type: 'thinking' }),
      onError: (message) => send({ type: 'error', message }),
    });
    const assistantContent = content.filter((block) => block && (block.type !== 'text' || block.text));
    messages.push({ role: 'assistant', content: assistantContent });
    const toolUses = assistantContent.filter((block) => block.type === 'tool_use');
    if (stopReason !== 'tool_use' || toolUses.length === 0) break;
    const results = [];
    for (const toolUse of toolUses) {
      send({ type: 'action', name: toolUse.name, input: toolUse.input, label: TOOL_LABELS[toolUse.name] || toolUse.name });
      let outcome;
      try {
        outcome = await bridge.callTool(toolUse.name, toolUse.input);
      } catch (error) {
        outcome = { text: 'Tool error: ' + (error && error.message ? error.message : String(error)), isError: true };
      }
      send({ type: 'action_done', name: toolUse.name, ok: !outcome.isError, summary: summarizeResult(outcome) });
      results.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: [{ type: 'text', text: summarizeResult(outcome) }],
        ...(outcome.isError ? { is_error: true } : {}),
      });
    }
    messages.push({ role: 'user', content: results });
  }
  send({ type: 'done' });
}

// --------------------------------------------------------------- HTTP side ---
function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) {
        reject(new Error('body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    request.on('error', reject);
  });
}

const server = http.createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  if (request.method === 'GET' && url.pathname === '/api/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, version: VERSION, model: MODEL, bridgePort: BRIDGE_PORT }));
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/chat') {
    let body;
    try {
      body = await readBody(request);
    } catch (error) {
      response.writeHead(400, { 'content-type': 'text/plain' });
      response.end(String(error.message));
      return;
    }
    response.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    let closed = false;
    request.on('close', () => { closed = true; });
    const send = (event) => {
      if (closed) return;
      try {
        response.write(JSON.stringify(event) + '\n');
      } catch { /* client gone */ }
    };
    try {
      await runAgent({ history: body.messages, prompt: body.prompt, send });
    } catch (error) {
      send({ type: 'error', message: String((error && error.message) || error) });
      send({ type: 'done' });
    }
    response.end();
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  log(`listening on http://127.0.0.1:${PORT} | model=${MODEL} | bridge port=${BRIDGE_PORT}`);
});

process.on('SIGTERM', () => { bridge.stop(); server.close(); process.exit(0); });
process.on('SIGINT', () => { bridge.stop(); server.close(); process.exit(0); });
