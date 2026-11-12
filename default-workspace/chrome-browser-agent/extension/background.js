/**
 * DSH Browser Agent - background service worker.
 *
 * Owns the connection to the local DSH bridge (bridge.cjs) through HTTP
 * long-polling, executes browser actions on request, and broadcasts state/log
 * events to the side panel.
 */
'use strict';

const VERSION = '2.2.0';
const DEFAULTS = {
  port: 8787,
  chatPort: 8788,
  dshUrl: 'http://127.0.0.1:51711',
  paused: false,
  instructions: '',
  showOrb: false,
  animations: false,
};

let cfg = { ...DEFAULTS, clientId: null };
let connected = false;
let lastConnectError = '';
const connectedPorts = new Set();
const pollStates = new Map();
let activeTab = null;
let lastSnapshot = null;
let logEntries = [];
let lastHelloAt = 0;
let lastStatusSignature = '';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stamp() {
  return new Date().toTimeString().slice(0, 8);
}

function normalizeTab(tab) {
  if (!tab) return null;
  return {
    id: tab.id,
    title: tab.title || '',
    url: tab.url || '',
    active: !!tab.active,
    windowId: tab.windowId,
  };
}

async function broadcast(message) {
  try {
    await chrome.runtime.sendMessage(message);
  } catch {
    /* no side panel listening */
  }
}

async function loadState() {
  const stored = await chrome.storage.local.get({
    port: DEFAULTS.port,
    chatPort: DEFAULTS.chatPort,
    dshUrl: DEFAULTS.dshUrl,
    paused: DEFAULTS.paused,
    instructions: DEFAULTS.instructions,
    showOrb: DEFAULTS.showOrb,
    animations: DEFAULTS.animations,
    clientId: null,
  });
  cfg = { ...DEFAULTS, ...stored };
  if (!cfg.clientId) {
    cfg.clientId = crypto.randomUUID();
    await chrome.storage.local.set({ clientId: cfg.clientId });
  }
  await refreshActiveTab(false);
}

function updateBadge() {
  try {
    if (cfg.paused) {
      chrome.action.setBadgeText({ text: 'II' });
      chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
    } else if (connected) {
      chrome.action.setBadgeText({ text: 'ON' });
      chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch { /* ignore */ }
}

function buildState() {
  return {
    version: VERSION,
    connected,
    connectError: lastConnectError,
    port: cfg.port,
    chatPort: cfg.chatPort,
    dshUrl: cfg.dshUrl,
    paused: !!cfg.paused,
    instructions: cfg.instructions || '',
    showOrb: cfg.showOrb !== false,
    animations: cfg.animations === true,
    activeTab,
    log: logEntries.slice(-60),
  };
}

async function broadcastStatus(force) {
  updateBadge();
  const signature = JSON.stringify({
    connected,
    err: lastConnectError,
    paused: cfg.paused,
    instructions: cfg.instructions,
    port: cfg.port,
    dshUrl: cfg.dshUrl,
    tab: activeTab ? [activeTab.id, activeTab.url, activeTab.title] : null,
  });
  if (!force && signature === lastStatusSignature) return;
  lastStatusSignature = signature;
  await broadcast({ type: 'event', kind: 'status', status: buildState() });
}

function addLog(entry) {
  logEntries.push(entry);
  if (logEntries.length > 200) logEntries = logEntries.slice(-120);
  broadcast({ type: 'event', kind: 'log', entry }).catch(() => {});
}

function bridgePorts() {
  const ports = new Set();
  for (const candidate of [cfg.port, cfg.chatPort]) {
    const port = Number(candidate);
    if (Number.isFinite(port) && port > 0 && port < 65536) ports.add(port);
  }
  return [...ports];
}

function setConnected(port, next, error) {
  if (next) {
    connectedPorts.add(port);
    lastConnectError = '';
  } else {
    connectedPorts.delete(port);
    if (error) lastConnectError = String(error.message || error);
  }
  const was = connected;
  connected = connectedPorts.size > 0;
  updateBadge();
  if (!was && connected) sendHello(port).catch(() => {});
  broadcastStatus(false).catch(() => {});
  if (connected) syncOverlay();
}

async function refreshActiveTab(publish = true) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    activeTab = normalizeTab(tab) || activeTab;
  } catch { /* ignore */ }
  if (publish) {
    broadcastStatus(false).catch(() => {});
    sendHelloAll().catch(() => {});
    syncOverlay();
  }
  return activeTab;
}

async function sendHello(port) {
  const targetPort = Number(port) || cfg.port;
  try {
    const res = await fetch(`http://127.0.0.1:${targetPort}/api/hello`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        clientId: cfg.clientId,
        version: VERSION,
        paused: !!cfg.paused,
        instructions: cfg.instructions || '',
        activeTab,
        userAgent: navigator.userAgent,
      }),
    });
    if (!res.ok) throw new Error('hello HTTP ' + res.status);
    lastHelloAt = Date.now();
    setConnected(targetPort, true);
  } catch (err) {
    if (connectedPorts.has(targetPort)) setConnected(targetPort, false, err);
    else lastConnectError = String((err && err.message) || err);
  }
}

async function sendHelloAll() {
  for (const port of bridgePorts()) {
    await sendHello(port).catch(() => {});
  }
}

function abortPoll() {
  for (const state of pollStates.values()) {
    state.active = false;
    try {
      if (state.controller) state.controller.abort();
    } catch { /* ignore */ }
  }
  pollStates.clear();
}

async function pollLoop(port) {
  if (pollStates.has(port)) return;
  const state = { active: true, controller: null };
  pollStates.set(port, state);
  try {
    while (state.active) {
      try {
        const controller = new AbortController();
        state.controller = controller;
        const timer = setTimeout(() => controller.abort(), 30000);
        let res;
        try {
          res = await fetch(`http://127.0.0.1:${port}/api/poll?client=${encodeURIComponent(cfg.clientId)}`, {
            signal: controller.signal,
            cache: 'no-store',
          });
        } finally {
          clearTimeout(timer);
          state.controller = null;
        }
        if (!state.active) break;
        if (res.status === 204) {
          setConnected(port, true);
          continue;
        }
        if (!res.ok) throw new Error('poll HTTP ' + res.status);
        const body = await res.json();
        setConnected(port, true);
        if (body && body.action) {
          await handleAction(body.action, port);
        }
      } catch (err) {
        if (!state.active) break;
        if (err && err.name === 'AbortError') continue;
        setConnected(port, false, err);
        await sleep(1500);
      }
    }
  } finally {
    pollStates.delete(port);
  }
}

function ensurePollLoops() {
  for (const port of bridgePorts()) {
    pollLoop(port).catch(() => {});
  }
}

// ------------------------------------------------------------- page calls ---

function isRestrictedUrl(url) {
  return !url || !/^(https?|file):/i.test(url);
}

async function getTargetTab(tabId) {
  if (tabId) {
    try {
      return await chrome.tabs.get(Number(tabId));
    } catch {
      throw new Error('Tab ' + tabId + ' was not found (it may have been closed).');
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) throw new Error('No active tab in the current window.');
  return tab;
}

function assertAccessible(tab) {
  if (isRestrictedUrl(tab.url)) {
    throw new Error(
      'Cannot run on this page (' + (tab.url || 'unknown') + '). Chrome internal pages (chrome://, chrome-extension://, the Chrome Web Store) are blocked; open a normal http(s) page.',
    );
  }
}

async function injectContentScript(tab) {
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content.js'] });
  } catch (err) {
    // Some frames (about:blank, PDF viewers) cannot be injected - ignore.
  }
}

async function ensureScripts(tab) {
  assertAccessible(tab);
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => {
        const api = globalThis.__dshAgent;
        return Boolean(api && api.version >= 3);
      },
    });
    if (results.length && results.every((r) => r.result === true)) return;
  } catch { /* fall through to injection */ }
  await injectContentScript(tab);
  await sleep(80);
}

function parseRef(ref) {
  const text = String(ref || '').trim();
  let match = /^@e(\d+)$/.exec(text);
  if (match) return { frameId: 0, localRef: 'e' + match[1] };
  match = /^@f(\d+)e(\d+)$/.exec(text);
  if (match) return { frameId: Number(match[1]), localRef: 'e' + match[2] };
  // tolerate plain "e12"
  match = /^e(\d+)$/.exec(text);
  if (match) return { frameId: 0, localRef: 'e' + match[1] };
  throw new Error('Invalid element ref "' + text + '". Use a ref from the latest browser_snapshot, e.g. @e12.');
}

async function callFrames(tab, method, args, frameId) {
  const target = frameId == null ? { tabId: tab.id, allFrames: true } : { tabId: tab.id, frameIds: [frameId] };
  const results = await chrome.scripting.executeScript({
    target,
    func: (m, a) => {
      const api = globalThis.__dshAgent;
      if (!api) return { __missing: true };
      return api[m](a || {});
    },
    args: [method, args || {}],
  });
  if (results.some((r) => r.result && r.result.__missing)) {
    await injectContentScript(tab);
    await sleep(80);
    return await chrome.scripting.executeScript({
      target,
      func: (m, a) => {
        const api = globalThis.__dshAgent;
        if (!api) return { __missing: true };
        return api[m](a || {});
      },
      args: [method, args || {}],
    });
  }
  return results;
}

// ---------------------------------------------------------------- overlay ---

/**
 * Run one on-page overlay method (top frame by default) and swallow page errors:
 * overlay feedback must never fail the action that triggered it.
 */
async function runOverlay(tab, method, args, frameId) {
  try {
    if (!tab || isRestrictedUrl(tab.url)) return null;
    await ensureScripts(tab).catch(() => {});
    const results = await callFrames(tab, method, args || {}, frameId == null ? 0 : frameId);
    const data = (results.find((r) => r.result) || {}).result;
    return data == null ? null : data;
  } catch {
    return null;
  }
}

let overlaySyncTimer = null;
/** Push connection/pause/orb state into the page overlay (debounced). */
function syncOverlay() {
  if (overlaySyncTimer) return;
  if (!cfg.showOrb && !cfg.animations) return;
  overlaySyncTimer = setTimeout(async () => {
    overlaySyncTimer = null;
    const tab = activeTab;
    if (!tab || !tab.id) return;
    await runOverlay(tab, 'overlayStatus', {
      connected,
      paused: !!cfg.paused,
      showOrb: cfg.showOrb !== false,
    });
  }, 220);
}

/**
 * Запомнить элементы последнего снимка, чтобы уметь восстанавливать @ref,
 * когда React/SPA перерисовал страницу и старые ссылки умерли.
 */
function rememberSnapshot(tab, snapshotData) {
  if (!tab || !snapshotData || !Array.isArray(snapshotData.elements)) return;
  lastSnapshot = {
    tabId: tab.id,
    url: snapshotData.url,
    at: Date.now(),
    elements: snapshotData.elements
      .filter((element) => /^@e\d+$/.test(String(element.ref || '')))
      .map((element) => ({
        ref: String(element.ref).slice(1),
        tag: element.tag || '',
        role: element.role || '',
        name: element.name || '',
        selector: element.selector || '',
      })),
  };
}

async function findElementByRefMemory(tab, localRef) {
  const info = lastSnapshot && lastSnapshot.tabId === tab.id
    ? lastSnapshot.elements.find((entry) => entry.ref === localRef)
    : null;
  if (!info || (!info.name && !info.selector)) return '';
  try {
    const results = await callFrames(tab, 'find', {
      text: info.name || '',
      tag: info.tag || '',
      role: info.role || '',
      limit: 12,
    });
    const data = (results.find((entry) => entry.result) || {}).result;
    if (data && Array.isArray(data.matches) && data.matches.length > 0) {
      const best = data.matches.find((entry) => entry.ref) || data.matches[0];
      return best.ref || '';
    }
  } catch { /* page busy - no recovery */ }
  return '';
}

/** Самовосстановление ref: свежий снимок + повторный клик по найденному элементу. */
async function recoverStaleRef(tab, localRef, action) {
  try {
    await handleSnapshot({ tabId: tab.id, includeText: false, maxElements: 250 });
  } catch {
    return '';
  }
  const freshRef = await findElementByRefMemory(tab, localRef);
  if (!freshRef) return '';
  addLog({ ts: stamp(), action: 'heal', params: { ref: '@' + localRef, next: '@' + freshRef, for: action }, ok: true, error: '', durationMs: 0 });
  return freshRef;
}

/** Дождаться, пока DOM перестанет меняться после действия. */
async function settlePage(tab, frameId) {
  try {
    const results = await callFrames(tab, 'waitStable', { quietMs: 200, timeoutMs: 1200 }, frameId == null ? 0 : frameId);
    const data = (results.find((entry) => entry.result) || {}).result;
    return data || null;
  } catch {
    return null;
  }
}

async function waitForTabComplete(tabId, timeoutMs) {
  const started = Date.now();
  await sleep(250);
  let tab = await chrome.tabs.get(tabId);
  while (Date.now() - started < timeoutMs) {
    if (tab.status === 'complete') return tab;
    await sleep(150);
    tab = await chrome.tabs.get(tabId);
  }
  return tab;
}

async function listTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs
    .map(normalizeTab)
    .sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || a.id - b.id);
}

// --------------------------------------------------------------- actions ---

async function handleSnapshot(params) {
  const tab = await getTargetTab(params.tabId);
  await ensureScripts(tab);
  const results = await callFrames(tab, 'snapshot', {
    includeText: params.includeText !== false,
    maxElements: params.maxElements || 150,
  });
  let main = null;
  const elements = [];
  const frames = [];
  for (const entry of results) {
    const frameId = entry.frameId == null ? 0 : entry.frameId;
    const result = entry.result;
    if (!result || result.__missing) continue;
    if (frameId === 0) main = result;
    else if (result.elements && result.elements.length) frames.push({ frameId, url: result.url });
    for (const el of result.elements || []) {
      elements.push({
        ...el,
        ref: frameId === 0 ? '@' + el.ref : '@f' + frameId + el.ref,
      });
    }
  }
  const limit = Math.max(1, Math.min(600, (params.maxElements || 150) * 3));
  const snapshotData = {
    url: (main && main.url) || tab.url,
    title: (main && main.title) || tab.title,
    viewport: main && main.viewport,
    scrollY: main && main.scrollY,
    activeElement: main && main.activeElement,
    elements: elements.slice(0, limit),
    text: (main && main.text) || '',
    frames,
  };
  rememberSnapshot(tab, snapshotData);
  if (cfg.animations) runOverlay(tab, 'overlayScan', { count: snapshotData.elements.length });
  return snapshotData;
}

async function handleNavigate(params) {
  const url = String(params.url || '');
  if (!/^(https?|file):/i.test(url)) throw new Error('navigate: only http(s):// and file:// URLs are allowed, got: ' + url);
  let tab;
  if (params.newTab) {
    tab = await chrome.tabs.create({ url, active: true });
  } else {
    tab = await getTargetTab(params.tabId);
    if (isRestrictedUrl(tab.url)) {
      // The active tab is a chrome:// or extension page: Chrome does not let us
      // navigate it. Reuse any normal tab, or open a fresh one.
      const candidates = await chrome.tabs.query({});
      const usable = candidates.find((t) => t.id !== tab.id && !isRestrictedUrl(t.url));
      if (usable) {
        await chrome.tabs.update(usable.id, { active: true });
        tab = usable;
      } else {
        tab = await chrome.tabs.create({ url, active: true });
      }
    }
    await chrome.tabs.update(tab.id, { url, active: true });
  }
  const completed = await waitForTabComplete(tab.id, 30000);
  await sleep(Math.max(0, Math.min(15000, Number(params.waitMs) || 400)));
  try {
    await ensureScripts(completed);
  } catch { /* page may still be loading */ }
  const fresh = await chrome.tabs.get(tab.id);
  await refreshActiveTab();
  return { tabId: fresh.id, url: fresh.url, title: fresh.title };
}

async function handleClick(params) {
  const { frameId, localRef } = parseRef(params.ref);
  const tab = await getTargetTab(params.tabId);
  await ensureScripts(tab);
  const runClick = async (ref) => {
    const results = await callFrames(tab, 'click', { ref }, frameId).catch(() => []);
    const data = (results.find((entry) => entry.result) || {}).result;
    return data || { error: 'The page did not respond to the click script (frame may be busy).', missing: true };
  };
  let data = await runClick(localRef);
  let healed = false;
  if (data.error || data.missing) {
    const freshRef = await recoverStaleRef(tab, localRef, 'click');
    if (freshRef) {
      const retried = await runClick(freshRef);
      if (!retried.error) {
        data = retried;
        healed = true;
      }
    }
  }
  if (data.error) throw new Error(data.error);
  await sleep(120);
  if (cfg.animations) runOverlay(tab, 'overlayPulse', { ref: localRef }, frameId);
  const settled = await settlePage(tab, frameId);
  const fresh = await chrome.tabs.get(tab.id).catch(() => tab);
  return {
    ...data,
    ...(healed ? { selfHealed: true, note: 'ref was stale; the element was re-found by text and clicked' } : {}),
    ...(settled ? { settled: settled.stable, settleMs: settled.waitedMs } : {}),
    tabId: fresh.id,
    url: fresh.url,
    title: fresh.title,
  };
}

async function handleType(params) {
  const text = String(params.text == null ? '' : params.text);
  let frameId = 0;
  let localRef = null;
  if (params.ref) {
    const parsed = parseRef(params.ref);
    frameId = parsed.frameId;
    localRef = parsed.localRef;
  }
  const tab = await getTargetTab(params.tabId);
  await ensureScripts(tab);
  const runType = async (ref) => {
    const results = await callFrames(
      tab,
      'type',
      { ref, text, clear: params.clear !== false, submit: !!params.submit },
      frameId,
    ).catch(() => []);
    const data = (results.find((entry) => entry.result) || {}).result;
    return data || { error: 'The page did not respond to the type script (frame may be busy).', missing: true };
  };
  let data = await runType(localRef);
  let healed = false;
  if ((data.error || data.missing) && localRef) {
    const freshRef = await recoverStaleRef(tab, localRef, 'type');
    if (freshRef) {
      const retried = await runType(freshRef);
      if (!retried.error) {
        data = retried;
        healed = true;
      }
    }
  }
  if (data.error) throw new Error(data.error);
  await sleep(120);
  if (cfg.animations) runOverlay(tab, 'overlayType', { ref: localRef }, frameId);
  const settled = await settlePage(tab, frameId);
  const fresh = await chrome.tabs.get(tab.id).catch(() => tab);
  return {
    ...data,
    ...(healed ? { selfHealed: true } : {}),
    ...(settled ? { settled: settled.stable, settleMs: settled.waitedMs } : {}),
    tabId: fresh.id,
    url: fresh.url,
    title: fresh.title,
  };
}

async function handlePressKey(params) {
  const key = String(params.key || 'Enter');
  const tab = await getTargetTab(params.tabId);
  await ensureScripts(tab);
  const results = await callFrames(tab, 'pressKey', { key }, 0);
  const data = (results.find((r) => r.result) || {}).result;
  if (!data) throw new Error('The page did not respond to the key script.');
  await sleep(250);
  const fresh = await chrome.tabs.get(tab.id).catch(() => tab);
  return { ...data, tabId: fresh.id, url: fresh.url, title: fresh.title };
}

async function handleScroll(params) {
  const tab = await getTargetTab(params.tabId);
  await ensureScripts(tab);
  const results = await callFrames(tab, 'scroll', { direction: params.direction || 'down', amount: params.amount || 600 }, 0);
  const data = (results.find((r) => r.result) || {}).result;
  if (!data) throw new Error('The page did not respond to the scroll script.');
  await sleep(150);
  return data;
}

async function handleScreenshot(params) {
  const tab = params.tabId ? await getTargetTab(params.tabId) : await getTargetTab();
  if (!tab.active) {
    await chrome.tabs.update(tab.id, { active: true });
    try {
      await chrome.windows.update(tab.windowId, { focused: true });
    } catch { /* ignore */ }
    await sleep(350);
  }
  await sleep(150);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const fresh = await chrome.tabs.get(tab.id).catch(() => tab);
  return { dataUrl, tab: normalizeTab(fresh) };
}

async function handleWait(params) {
  const wantMs = Math.max(0, Math.min(20000, Number(params.ms) || 0));
  const needle = params.text ? String(params.text) : '';
  const tab = await getTargetTab(params.tabId);
  await ensureScripts(tab);
  const started = Date.now();
  const overall = Math.min(20000, Math.max(wantMs, needle ? 15000 : 0));
  let matched = !needle;
  if (needle) {
    while (Date.now() - started < overall) {
      try {
        const results = await callFrames(tab, 'hasText', { text: needle }, 0);
        const data = (results.find((r) => r.result) || {}).result;
        if (data && data.found) {
          matched = true;
          break;
        }
      } catch { /* page navigating */ }
      await sleep(250);
    }
  } else {
    await sleep(wantMs);
  }
  while (Date.now() - started < wantMs) await sleep(50);
  const fresh = await chrome.tabs.get(tab.id).catch(() => tab);
  return { elapsedMs: Date.now() - started, matched, text: needle || null, tabId: fresh.id, url: fresh.url, title: fresh.title };
}

async function handleTabs(params) {
  const action = params.action || 'list';
  if (action === 'list') return { tabs: await listTabs(), activeTab: activeTab };

  if (action === 'open') {
    const url = String(params.url || '');
    if (!/^(https?|file):/i.test(url)) throw new Error('tabs open: only http(s):// and file:// URLs are allowed');
    const tab = await chrome.tabs.create({ url, active: true });
    await waitForTabComplete(tab.id, 20000);
    const fresh = await chrome.tabs.get(tab.id);
    await refreshActiveTab();
    return { tabs: await listTabs(), opened: normalizeTab(fresh) };
  }

  if (action === 'activate') {
    const tab = await getTargetTab(params.tabId);
    await chrome.tabs.update(tab.id, { active: true });
    try {
      await chrome.windows.update(tab.windowId, { focused: true });
    } catch { /* ignore */ }
    await refreshActiveTab();
    return { tabs: await listTabs() };
  }

  if (action === 'close') {
    const tab = await getTargetTab(params.tabId);
    await chrome.tabs.remove(tab.id);
    await sleep(200);
    await refreshActiveTab();
    return { tabs: await listTabs() };
  }

  throw new Error('tabs: unknown action ' + action);
}

async function setInstructions(text) {
  cfg.instructions = String(text || '');
  await chrome.storage.local.set({ instructions: cfg.instructions });
  await sendHelloAll().catch(() => {});
  await broadcastStatus(true);
  return { ok: true, instructions: cfg.instructions };
}

async function performAction(action, params) {
  switch (action) {
    case 'status':
      return {
        connected,
        paused: !!cfg.paused,
        instructions: cfg.instructions,
        version: VERSION,
        activeTab,
        tabs: await listTabs(),
      };
    case 'tabs':
      return await handleTabs(params);
    case 'snapshot':
      return await handleSnapshot(params);
    case 'navigate':
      return await handleNavigate(params);
    case 'click':
      return await handleClick(params);
    case 'type':
      return await handleType(params);
    case 'press_key':
      return await handlePressKey(params);
    case 'scroll':
      return await handleScroll(params);
    case 'screenshot':
      return await handleScreenshot(params);
    case 'wait':
      return await handleWait(params);
    case 'instructions':
      return await setInstructions(params.text);
    default:
      throw new Error('Unknown action: ' + action);
  }
}

async function postResult(id, ok, data, error, port) {
  const targetPort = Number(port) || cfg.port;
  try {
    await fetch(`http://127.0.0.1:${targetPort}/api/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ id, ok, data, error, activeTab, instructions: cfg.instructions }),
    });
  } catch (err) {
    // Bridge is gone; nothing else we can do.
  }
}

function summarizeParams(action, params) {
  try {
    if (action === 'click') return { ref: params.ref };
    if (action === 'type') return { ref: params.ref || '(focused)', text: String(params.text || '').slice(0, 60), submit: !!params.submit };
    if (action === 'navigate') return { url: String(params.url || '').slice(0, 120), newTab: !!params.newTab };
    if (action === 'press_key') return { key: params.key };
    if (action === 'scroll') return { direction: params.direction, amount: params.amount };
    if (action === 'tabs') return { action: params.action, url: params.url, tabId: params.tabId };
    if (action === 'wait') return { ms: params.ms, text: params.text ? String(params.text).slice(0, 40) : undefined };
    if (action === 'instructions') return { text: String(params.text || '').slice(0, 60) };
    return {};
  } catch {
    return {};
  }
}

async function handleAction(action, port) {
  const started = Date.now();
  const name = action.action;
  const params = action.params || {};
  let data = null;
  let error = '';
  try {
    if (cfg.paused && name !== 'status' && name !== 'instructions') {
      throw new Error('Browser agent is paused (extension panel). Ask the user to resume.');
    }
    data = await performAction(name, params);
  } catch (err) {
    error = String((err && err.message) || err);
  }
  addLog({
    ts: stamp(),
    action: name,
    params: summarizeParams(name, params),
    ok: !error,
    error: error || '',
    durationMs: Date.now() - started,
  });
  const fresh = await refreshActiveTab(false).catch(() => activeTab);
  await postResult(action.id, !error, error ? null : data, error || undefined, port);
  await broadcastStatus(true);
  if (fresh) {
    activeTab = fresh;
    if (cfg.animations) {
      runOverlay(fresh, 'overlayActivity', {
        label: name,
        ok: !error,
        ...(error ? { error: error.slice(0, 120) } : {}),
      });
    }
  }
}

// --------------------------------------------------------- panel messages ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;
  const type = message.type;
  if (type === 'getState') {
    sendResponse(buildState());
    return false;
  }
  if (type === 'setConfig') {
    (async () => {
      if (Number.isFinite(Number(message.port))) {
        const port = Math.max(1, Math.min(65535, Math.round(Number(message.port))));
        if (port !== cfg.port) {
          cfg.port = port;
          await chrome.storage.local.set({ port });
          abortPoll();
        }
      }
      if (typeof message.dshUrl === 'string' && message.dshUrl.trim()) {
        cfg.dshUrl = message.dshUrl.trim();
        await chrome.storage.local.set({ dshUrl: cfg.dshUrl });
      }
      if (typeof message.chatPort !== 'undefined' && Number.isFinite(Number(message.chatPort))) {
        const chatPort = Math.max(1, Math.min(65535, Math.round(Number(message.chatPort))));
        if (chatPort !== cfg.chatPort) {
          cfg.chatPort = chatPort;
          await chrome.storage.local.set({ chatPort });
          abortPoll();
        }
      }
      ensurePollLoops();
      await sendHelloAll().catch(() => {});
      await broadcastStatus(true);
      syncOverlay();
      sendResponse(buildState());
    })().catch((err) => sendResponse({ error: String((err && err.message) || err) }));
    return true;
  }
  if (type === 'reconnect') {
    abortPoll();
    sendHelloAll().catch(() => {});
    ensurePollLoops();
    sendResponse({ ok: true });
    return false;
  }
  if (type === 'setPaused') {
    (async () => {
      cfg.paused = !!message.paused;
      await chrome.storage.local.set({ paused: cfg.paused });
      await sendHelloAll().catch(() => {});
      await broadcastStatus(true);
      syncOverlay();
      sendResponse(buildState());
    })();
    return true;
  }
  if (type === 'setInstructions') {
    (async () => {
      await setInstructions(message.text);
      sendResponse(buildState());
    })().catch((err) => sendResponse({ error: String((err && err.message) || err) }));
    return true;
  }
  if (type === 'openDsh') {
    chrome.tabs.create({ url: cfg.dshUrl }).catch(() => {});
    sendResponse({ ok: true });
    return false;
  }
  if (type === 'overlayVision' || type === 'overlayPicker') {
    (async () => {
      const tab = await getTargetTab();
      await ensureScripts(tab).catch(() => {});
      const method = type === 'overlayVision' ? 'overlayVision' : 'overlayPicker';
      const data = await runOverlay(tab, method, { on: !!message.on });
      sendResponse({ ok: true, data });
    })().catch((err) => sendResponse({ error: String((err && err.message) || err) }));
    return true;
  }
  if (type === 'overlayClear') {
    (async () => {
      const tab = await getTargetTab();
      const data = await runOverlay(tab, 'overlayClear', {});
      sendResponse({ ok: true, data });
    })().catch((err) => sendResponse({ error: String((err && err.message) || err) }));
    return true;
  }
  if (type === 'screenshot') {
    (async () => {
      const data = await handleScreenshot({});
      sendResponse({ ok: true, dataUrl: data.dataUrl, tab: data.tab });
    })().catch((err) => sendResponse({ error: String((err && err.message) || err) }));
    return true;
  }
  if (type === 'setOrb') {
    (async () => {
      cfg.showOrb = !!message.show;
      await chrome.storage.local.set({ showOrb: cfg.showOrb });
      syncOverlay();
      await broadcastStatus(true);
      sendResponse(buildState());
    })().catch((err) => sendResponse({ error: String((err && err.message) || err) }));
    return true;
  }
  if (type === 'setAnimations') {
    (async () => {
      cfg.animations = !!message.enabled;
      await chrome.storage.local.set({ animations: cfg.animations });
      syncOverlay();
      await broadcastStatus(true);
      sendResponse(buildState());
    })().catch((err) => sendResponse({ error: String((err && err.message) || err) }));
    return true;
  }
  if (type === 'pickerResult') {
    const payload = message.payload || {};
    addLog({
      ts: stamp(),
      action: 'picker',
      params: { ref: payload.ref, name: payload.name },
      ok: true,
      error: '',
      durationMs: 0,
    });
    broadcast({ type: 'event', kind: 'picker', payload }).catch(() => {});
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

// -------------------------------------------------------------- tab events ---

let tabEventTimer = null;
function scheduleTabRefresh() {
  if (tabEventTimer) clearTimeout(tabEventTimer);
  tabEventTimer = setTimeout(async () => {
    tabEventTimer = null;
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const next = normalizeTab(tab);
      if (next && (!activeTab || activeTab.id !== next.id || activeTab.url !== next.url || activeTab.title !== next.title)) {
        activeTab = next;
        await broadcastStatus(true);
        await sendHelloAll().catch(() => {});
        syncOverlay();
      }
    } catch { /* ignore */ }
  }, 600);
}

chrome.tabs.onActivated.addListener(scheduleTabRefresh);
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.title || changeInfo.status === 'complete') scheduleTabRefresh();
});
chrome.tabs.onRemoved.addListener(scheduleTabRefresh);

// -------------------------------------------------------------- lifecycle ---

let watchdogInstalled = false;
async function ensureWatchdog() {
  if (watchdogInstalled) return;
  watchdogInstalled = true;
  try {
    await chrome.alarms.create('dsh-browser-agent-watchdog', { periodInMinutes: 0.5 });
  } catch { /* ignore */ }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'dsh-browser-agent-watchdog') return;
  ensurePollLoops();
  if (Date.now() - lastHelloAt > 60000) sendHelloAll().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  init().catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  init().catch(() => {});
});

async function init() {
  await loadState();
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch { /* older Chrome */ }
  await ensureWatchdog();
  updateBadge();
  await broadcastStatus(true);
  syncOverlay();
  await sendHelloAll().catch(() => {});
  ensurePollLoops();
}

init().catch((err) => {
  console.error('DSH Browser Agent init failed', err);
});
