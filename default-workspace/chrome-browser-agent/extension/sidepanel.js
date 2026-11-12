/**
 * DSH Browser Agent v2.2 — чат в боковой панели.
 *
 * Панель отправляет задачу локальному чат-серверу (`chat/chat-server.cjs`),
 * который ведёт LLM-цикл и дергает браузерные инструменты через второй
 * экземпляр моста (порт 8788). Здесь только UI и поток событий.
 *
 * NDJSON-события сервера: text, thinking, action, action_done, error, done.
 */
'use strict';

const CHAT_ENDPOINT = 'http://127.0.0.1:8792/api/chat';

const els = {
  dot: document.getElementById('dot'),
  versionChip: document.getElementById('versionChip'),
  paused: document.getElementById('paused'),
  pauseLabel: document.getElementById('pauseLabel'),
  chat: document.getElementById('chat'),
  empty: document.getElementById('empty'),
  examples: document.getElementById('examples'),
  input: document.getElementById('input'),
  send: document.getElementById('send'),
};

let connected = false;
let pausedState = false;
let busy = false;
let turns = [];

function scrollDown() {
  els.chat.scrollTop = els.chat.scrollHeight;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function nowLabel() {
  const date = new Date();
  return pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

async function sendToBackground(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        resolve(error ? { error: error.message } : response);
      });
    } catch (error) {
      resolve({ error: String((error && error.message) || error) });
    }
  });
}

function renderStatus(state) {
  if (!state || state.error) return;
  connected = Boolean(state.connected);
  pausedState = Boolean(state.paused);
  els.dot.className = 'dot' + (connected ? (pausedState ? ' paused' : ' on') : '');
  els.dot.title = connected ? (pausedState ? 'Мост: пауза' : 'Мост: подключено') : 'Мост не подключён';
  els.versionChip.textContent = 'v' + (state.version || '2.2.0');
  els.paused.checked = pausedState;
  els.pauseLabel.textContent = pausedState ? 'пауза' : 'работает';
}

async function refreshStatus() {
  const state = await sendToBackground({ type: 'getState' });
  if (state && !state.error) renderStatus(state);
}

/* ------------------------------------------------------------------ messages */

function hideEmpty() {
  if (els.empty && els.empty.parentNode) els.empty.parentNode.removeChild(els.empty);
}

function addUserMessage(text) {
  hideEmpty();
  const wrap = document.createElement('div');
  wrap.className = 'msg user';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  wrap.appendChild(bubble);
  els.chat.appendChild(wrap);
  scrollDown();
  return wrap;
}

function addAssistantMessage() {
  hideEmpty();
  const wrap = document.createElement('div');
  wrap.className = 'msg assistant';
  const actions = document.createElement('div');
  actions.className = 'actions';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  const typing = document.createElement('div');
  typing.className = 'typing';
  typing.innerHTML = '<i></i><i></i><i></i>';
  bubble.appendChild(typing);
  wrap.appendChild(actions);
  wrap.appendChild(bubble);
  els.chat.appendChild(wrap);
  scrollDown();
  return { wrap, bubble, actions, typing, text: '', current: new Map() };
}

function errorBubble(message) {
  hideEmpty();
  const wrap = document.createElement('div');
  wrap.className = 'msg assistant error';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = message;
  wrap.appendChild(bubble);
  els.chat.appendChild(wrap);
  scrollDown();
}

function appendText(controller, delta) {
  if (!delta) return;
  if (controller.typing && controller.typing.parentNode) controller.typing.remove();
  controller.text += delta;
  controller.bubble.textContent = controller.text;
  scrollDown();
}

const ACTION_ICONS = {
  status: '◈',
  tabs: '❐',
  snapshot: '◉',
  navigate: '➜',
  click: '⌖',
  type: '⌨',
  press_key: '⏎',
  scroll: '⇅',
  screenshot: '▣',
  wait: '⏳',
  instructions: '✎',
};

function startAction(controller, event) {
  if (controller.typing && controller.typing.parentNode) controller.typing.remove();
  const row = document.createElement('div');
  row.className = 'action';
  const spin = document.createElement('span');
  spin.className = 'spin';
  const icon = document.createElement('span');
  icon.className = 'ico';
  icon.textContent = ACTION_ICONS[event.name] || '•';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = event.label || event.name;
  const result = document.createElement('span');
  result.className = 'result';
  row.appendChild(spin);
  row.appendChild(icon);
  row.appendChild(label);
  row.appendChild(result);
  controller.actions.appendChild(row);
  const key = event.name + '#' + controller.actions.children.length;
  controller.current.set(key, row);
  scrollDown();
}

function finishAction(controller, event) {
  const rows = controller.actions.querySelectorAll('.action');
  const row = rows[rows.length - 1];
  if (!row) return;
  row.classList.add(event.ok ? 'done' : 'fail');
  const result = row.querySelector('.result');
  if (result && event.summary) {
    const firstLine = String(event.summary).split('\n').find((line) => line.trim()) || '';
    result.textContent = firstLine.slice(0, 90);
    result.title = String(event.summary).slice(0, 800);
  }
  scrollDown();
}

/* -------------------------------------------------------------------- stream */

async function streamChat(prompt) {
  const controller = addAssistantMessage();
  busy = true;
  els.send.disabled = true;
  let finished = false;
  try {
    const response = await fetch(CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: turns.slice(), prompt }),
    });
    if (!response.ok || !response.body) {
      throw new Error('chat server HTTP ' + response.status);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        handleEvent(controller, event);
        if (event.type === 'done') finished = true;
      }
    }
  } catch (error) {
    if (controller.typing && controller.typing.parentNode) controller.typing.remove();
    errorBubble(
      'Не могу связаться с чат-сервером (' +
        (error && error.message ? error.message : String(error)) +
        ').\nЗапустите: node chrome-browser-agent/chat/chat-server.cjs',
    );
  } finally {
    busy = false;
    els.send.disabled = false;
    if (!finished && controller.typing && controller.typing.parentNode) controller.typing.remove();
    turns.push({ role: 'user', content: prompt });
    turns.push({ role: 'assistant', content: controller.text || '(пустой ответ)' });
    if (turns.length > 24) turns = turns.slice(-24);
  }
}

function handleEvent(controller, event) {
  switch (event.type) {
    case 'text':
      appendText(controller, event.delta || '');
      break;
    case 'thinking':
      break;
    case 'action':
      startAction(controller, event);
      break;
    case 'action_done':
      finishAction(controller, event);
      break;
    case 'error':
      if (controller.typing && controller.typing.parentNode) controller.typing.remove();
      controller.text += (controller.text ? '\n\n' : '') + '⚠ ' + (event.message || 'Ошибка');
      controller.bubble.textContent = controller.text;
      controller.wrap.classList.add('error');
      scrollDown();
      break;
    case 'done':
      if (controller.typing && controller.typing.parentNode) controller.typing.remove();
      if (controller.text) controller.bubble.textContent = controller.text;
      scrollDown();
      break;
    default:
      break;
  }
}

/* --------------------------------------------------------------------- input */

function resizeInput() {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(132, els.input.scrollHeight) + 'px';
}

async function submit() {
  const text = els.input.value.trim();
  if (!text || busy) return;
  els.input.value = '';
  resizeInput();
  addUserMessage(text);
  await streamChat(text);
}

els.input.addEventListener('input', resizeInput);
els.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submit();
  }
});
els.send.addEventListener('click', submit);

els.examples.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-prompt]');
  if (!button) return;
  els.input.value = button.getAttribute('data-prompt') || '';
  resizeInput();
  submit();
});

els.paused.addEventListener('change', async () => {
  const state = await sendToBackground({ type: 'setPaused', paused: els.paused.checked });
  if (state && !state.error) renderStatus(state);
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'event' && message.kind === 'status' && message.status) {
    renderStatus(message.status);
  }
});

refreshStatus().catch(() => {});
resizeInput();
