/**
 * DSH Browser Agent - content script (isolated world, all frames).
 *
 * Exposes a tiny action API on globalThis.__dshAgent that background.js calls
 * through chrome.scripting.executeScript. Everything here must be
 * JSON-serializable and must never depend on closure state from the injection.
 */
(() => {
  'use strict';
  if (globalThis.__dshAgent && globalThis.__dshAgent.version >= 3) return;

  const REF_ATTR = 'data-dsh-ref';
  const HIGHLIGHT_COLOR = '#ffd34d';

  const INTERACTIVE_SELECTOR = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    'summary',
    '[contenteditable=""]',
    '[contenteditable="true"]',
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="option"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="combobox"]',
    '[role="searchbox"]',
    '[role="textbox"]',
    '[onclick]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  function cleanText(value, limit) {
    const text = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
    return limit ? text.slice(0, limit) : text;
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    if (el.closest('[hidden], [aria-hidden="true"], [data-dsh-skip]')) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  }

  function implicitRole(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return cleanText(explicit, 40);
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'summary') return 'button';
    if (tag === 'input') {
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'search') return 'searchbox';
      if (['submit', 'button', 'reset', 'image'].includes(type)) return 'button';
      return 'textbox';
    }
    if (el.isContentEditable) return 'textbox';
    return '';
  }

  function accessibleName(el) {
    const aria = el.getAttribute('aria-label');
    if (aria && cleanText(aria)) return cleanText(aria, 120);
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => cleanText((document.getElementById(id) || {}).innerText, 120))
        .filter(Boolean)
        .join(' ');
      if (text) return text.slice(0, 120);
    }
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (el.labels && el.labels[0]) {
        const label = cleanText(el.labels[0].innerText, 120);
        if (label) return label;
      }
      const placeholder = el.getAttribute('placeholder');
      if (placeholder && cleanText(placeholder)) return cleanText(placeholder, 120);
      const ariaPlaceholder = el.getAttribute('aria-placeholder');
      if (ariaPlaceholder && cleanText(ariaPlaceholder)) return cleanText(ariaPlaceholder, 120);
      const name = el.getAttribute('name');
      if (name) return cleanText(name, 120);
    }
    const title = el.getAttribute('title');
    if (title && cleanText(title)) return cleanText(title, 120);
    const alt = el.getAttribute('alt');
    if (alt && cleanText(alt)) return cleanText(alt, 120);
    if (el.isContentEditable) {
      const inner = cleanText(el.innerText, 120);
      return inner;
    }
    const text = cleanText(el.innerText, 120);
    if (text) return text;
    const img = el.querySelector && el.querySelector('img[alt]');
    if (img) return cleanText(img.getAttribute('alt'), 120);
    const value = el.getAttribute('value');
    if (value) return cleanText(value, 120);
    return '';
  }

  function describe(el) {
    if (!el || !(el instanceof Element)) return '';
    const name = accessibleName(el);
    const tag = el.tagName.toLowerCase();
    return name ? `${tag} "${name}"` : tag;
  }

  /**
   * Устойчивый CSS-селектор элемента: id, если уникален, иначе путь из
   * тегов/классов до 5 уровней вверх. Нужен модели и self-healing логике:
   * после ре-рендера страницы селектор остаётся рабочим дольше, чем @ref.
   */
  function cssSelector(el) {
    if (!el || el.nodeType !== 1) return '';
    const escape = (value) => {
      try { return CSS.escape(String(value)); } catch { return String(value).replace(/([^\w-])/g, '\\$1'); }
    };
    const uniqueId = (node) => {
      if (!node.id) return '';
      try {
        return document.querySelectorAll('#' + escape(node.id)).length === 1 ? '#' + escape(node.id) : '';
      } catch {
        return '';
      }
    };
    const ownId = uniqueId(el);
    if (ownId) return ownId;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      const id = uniqueId(node);
      if (id) {
        parts.unshift(id);
        break;
      }
      let part = node.tagName.toLowerCase();
      const classes = (node.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (classes.length) part += classes.map((name) => '.' + escape(name)).join('');
      const parent = node.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
        if (sameTag.length > 1) part += ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = node.parentElement;
      if (node === document.body || node === document.documentElement) break;
    }
    return parts.join(' > ');
  }

  function viewportRect(el) {
    const rect = el.getBoundingClientRect();
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  function clearRefs() {
    const tagged = document.querySelectorAll('[' + REF_ATTR + ']');
    for (const el of tagged) el.removeAttribute(REF_ATTR);
  }

  function collectCandidates(limit) {
    /** @type {Element[]} */
    const candidates = [];
    const seen = new Set();

    const push = (el) => {
      if (!el || seen.has(el)) return;
      seen.add(el);
      if (!isVisible(el)) return;
      candidates.push(el);
    };

    for (const el of document.querySelectorAll(INTERACTIVE_SELECTOR)) push(el);

    // SPA apps (such as web.max.ru) often use plain divs with cursor:pointer.
    const root = document.body || document.documentElement;
    if (root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node = walker.nextNode();
      let scanned = 0;
      while (node && scanned < 6000 && candidates.length < limit * 2 + 100) {
        scanned++;
        if (node instanceof HTMLElement && !seen.has(node)) {
          const tag = node.tagName.toLowerCase();
          if (tag === 'html' || tag === 'body' || tag === 'script' || tag === 'style' || tag === 'svg' || tag === 'path') {
            node = walker.nextNode();
            continue;
          }
          let label = cleanText(node.innerText, 120);
          if (!label) {
            label = cleanText(node.getAttribute('aria-label') || node.getAttribute('title'), 120);
          }
          if (label) {
            const style = getComputedStyle(node);
            if (style.cursor === 'pointer' && style.visibility !== 'hidden' && style.display !== 'none') {
              push(node);
            }
          }
        }
        node = walker.nextNode();
      }
    }

    // Stable DOM order.
    candidates.sort((a, b) => {
      const rel = a.compareDocumentPosition(b);
      if (rel & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (rel & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    // Drop nested duplicates: keep the outermost meaningful candidate.
    const kept = [];
    for (const el of candidates) {
      let skip = false;
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        if (seen.has(parent) && kept.includes(parent)) {
          const parentName = accessibleName(parent);
          const ownName = accessibleName(el);
          if (parentName && ownName && parentName.includes(ownName)) {
            skip = true;
            break;
          }
          const parentRect = parent.getBoundingClientRect();
          const ownRect = el.getBoundingClientRect();
          if (
            Math.abs(parentRect.width - ownRect.width) < 2 &&
            Math.abs(parentRect.height - ownRect.height) < 2 &&
            Math.abs(parentRect.top - ownRect.top) < 2
          ) {
            skip = true;
            break;
          }
        }
      }
      if (!skip) kept.push(el);
    }

    return kept.slice(0, limit);
  }

  function snapshot(params) {
    params = params || {};
    const includeText = params.includeText !== false;
    const maxElements = Math.max(1, Math.min(400, Number(params.maxElements) || 150));

    clearRefs();
    const candidates = collectCandidates(maxElements);
    /** @type {Array<object>} */
    const elements = [];
    candidates.forEach((el, index) => {
      const ref = 'e' + (index + 1);
      try {
        el.setAttribute(REF_ATTR, ref);
      } catch {
        return;
      }
      const tag = el.tagName.toLowerCase();
      const info = {
        ref,
        tag,
        role: implicitRole(el),
        name: accessibleName(el),
        selector: cssSelector(el),
        rect: viewportRect(el),
      };
      const type = el.getAttribute('type');
      if (type) info.type = String(type).slice(0, 20);
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') info.disabled = true;
      if ('checked' in el && el.checked) info.checked = true;
      if (el.getAttribute('aria-expanded') === 'true') info.expanded = true;
      if (el.getAttribute('aria-selected') === 'true') info.selected = true;
      if (tag === 'a' && el.href) info.href = String(el.href).slice(0, 140);
      if (el.isContentEditable) info.editable = true;
      if (tag === 'input' || tag === 'textarea') {
        if (!el.readOnly && !el.disabled) info.editable = true;
      }
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        const value = String(el.value == null ? '' : el.value).slice(0, 100);
        if (value) info.value = value;
        if (tag === 'select' && el.selectedOptions && el.selectedOptions[0]) {
          info.value = cleanText(el.selectedOptions[0].textContent, 100);
        }
      }
      elements.push(info);
    });

    const active = document.activeElement;
    let activeElement = '';
    if (active && active !== document.body) {
      activeElement = describe(active);
    }

    let text = '';
    if (includeText) {
      const raw = (document.body && document.body.innerText) || '';
      text = raw.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 9000);
    }

    return {
      url: String(location.href).slice(0, 500),
      title: String(document.title || '').slice(0, 300),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scrollY: Math.round(window.scrollY),
      activeElement,
      elements,
      text,
    };
  }

  /**
   * Найти интерактивные элементы по тексту/роли/тегу без нового @ref.
   * Это «нюх» агента: используется для самовосстановления ссылок после
   * ре-рендера страницы и для поиска цели, когда ref устарел.
   */
  function find(params) {
    params = params || {};
    const text = String(params.text || '').toLowerCase().trim();
    const role = String(params.role || '').toLowerCase().trim();
    const tag = String(params.tag || '').toLowerCase().trim();
    const limit = Math.max(1, Math.min(30, Number(params.limit) || 10));
    const matches = [];
    for (const el of collectCandidates(400)) {
      if (tag && el.tagName.toLowerCase() !== tag) continue;
      if (role && implicitRole(el).toLowerCase() !== role) continue;
      const name = accessibleName(el);
      if (text) {
        const haystack = (name + ' ' + cleanText(el.innerText, 200)).toLowerCase();
        if (!haystack.includes(text)) continue;
      }
      matches.push({
        tag: el.tagName.toLowerCase(),
        role: implicitRole(el),
        name,
        selector: cssSelector(el),
        rect: viewportRect(el),
        ref: el.getAttribute(REF_ATTR) || '',
      });
      if (matches.length >= limit) break;
    }
    return { count: matches.length, matches };
  }

  /**
   * Дождаться, пока DOM успокоится после действия: тишина в мутациях
   * `quietMs` подряд или общий таймаут. Агент не делает следующий шаг по
   * ещё не отрисованной странице.
   */
  function waitStable(params) {
    params = params || {};
    const quietMs = Math.max(50, Math.min(1000, Number(params.quietMs) || 220));
    const timeoutMs = Math.max(100, Math.min(5000, Number(params.timeoutMs) || 1200));
    const started = Date.now();
    const root = document.documentElement;
    if (!root || typeof MutationObserver === 'undefined') {
      return Promise.resolve({ stable: true, waitedMs: 0, mutations: 0, url: String(location.href) });
    }
    return new Promise((resolve) => {
      let mutations = 0;
      let quietTimer = 0;
      let finished = false;
      const observer = new MutationObserver(() => {
        mutations++;
        if (finished) return;
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, quietMs);
      });
      const finish = (stable) => {
        if (finished) return;
        finished = true;
        clearTimeout(failTimer);
        if (quietTimer) clearTimeout(quietTimer);
        try { observer.disconnect(); } catch { /* ignore */ }
        resolve({ stable: Boolean(stable), waitedMs: Date.now() - started, mutations, url: String(location.href) });
      };
      const failTimer = setTimeout(() => finish(false), timeoutMs);
      try {
        observer.observe(root, { subtree: true, childList: true, attributes: true });
        quietTimer = setTimeout(() => finish(true), quietMs);
      } catch {
        finish(true);
      }
    });
  }

  function getRefElement(ref) {
    const local = String(ref || '').replace(/^@/, '');
    if (!/^e\d+$/.test(local)) return null;
    return document.querySelector('[' + REF_ATTR + '="' + local + '"]');
  }

  function highlight(el) {
    try {
      const previous = el.getAttribute('data-dsh-outline');
      const previousOffset = el.getAttribute('data-dsh-outline-offset');
      el.style.setProperty('outline', '2px solid ' + HIGHLIGHT_COLOR, 'important');
      el.style.setProperty('outline-offset', '2px', 'important');
      el.setAttribute('data-dsh-outline', previous || '');
      el.setAttribute('data-dsh-outline-offset', previousOffset || '');
      setTimeout(() => {
        try {
          el.style.removeProperty('outline');
          el.style.removeProperty('outline-offset');
          el.removeAttribute('data-dsh-outline');
          el.removeAttribute('data-dsh-outline-offset');
        } catch { /* ignore */ }
      }, 900);
    } catch { /* ignore */ }
  }

  function mouseEventOptions(x, y, extra) {
    return Object.assign(
      {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        button: 0,
        buttons: 1,
        detail: 1,
      },
      extra || {},
    );
  }

  function clickElement(el) {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const base = mouseEventOptions(x, y);
    const pointerBase = Object.assign({}, base, { pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1 });

    const fire = (Ctor, type, extra) => {
      try {
        el.dispatchEvent(new Ctor(type, Object.assign({}, extra || {})));
      } catch { /* ignore */ }
    };

    if (typeof PointerEvent === 'function') {
      fire(PointerEvent, 'pointerover', Object.assign({}, pointerBase, { buttons: 0, pressure: 0 }));
      fire(PointerEvent, 'pointerenter', Object.assign({}, pointerBase, { buttons: 0, pressure: 0, bubbles: false }));
    }
    fire(MouseEvent, 'mouseover', Object.assign({}, base, { buttons: 0 }));
    fire(MouseEvent, 'mouseenter', Object.assign({}, base, { buttons: 0 }));
    if (typeof PointerEvent === 'function') fire(PointerEvent, 'pointerdown', pointerBase);
    fire(MouseEvent, 'mousedown', base);
    try {
      el.focus({ preventScroll: true });
    } catch { /* ignore */ }
    if (typeof PointerEvent === 'function') fire(PointerEvent, 'pointerup', Object.assign({}, pointerBase, { buttons: 0 }));
    fire(MouseEvent, 'mouseup', Object.assign({}, base, { buttons: 0 }));
    if (typeof el.click === 'function') {
      try {
        el.click();
      } catch { /* ignore */ }
    } else {
      fire(MouseEvent, 'click', Object.assign({}, base, { buttons: 0 }));
    }
    highlight(el);
  }

  function click(params) {
    const el = getRefElement(params && params.ref);
    if (!el) {
      return {
        error: 'Element ' + String(params && params.ref) + ' not found on the page. Take a new browser_snapshot - refs go stale after page changes.',
        missing: true,
      };
    }
    try {
      el.scrollIntoView({ block: 'center', inline: 'center' });
    } catch { /* ignore */ }
    const info = { tag: el.tagName.toLowerCase(), name: accessibleName(el), selector: cssSelector(el) };
    clickElement(el);
    return {
      tag: info.tag,
      text: info.name,
      selector: info.selector,
      frameUrl: String(location.href).slice(0, 300),
      note: 'Clicked via pointer/mouse events + el.click().',
    };
  }

  function setNativeValue(el, value) {
    const tag = el.tagName.toLowerCase();
    const proto = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(el, value);
    else el.value = value;
  }

  function selectAllContents(el) {
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    } catch { /* ignore */ }
  }

  function pressKeyOn(el, key) {
    const map = {
      Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
      Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
      Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
      Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
      Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
      ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
      ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
      ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
      ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
      PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
      PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
      Home: { key: 'Home', code: 'Home', keyCode: 36 },
      End: { key: 'End', code: 'End', keyCode: 35 },
      ' ': { key: ' ', code: 'Space', keyCode: 32 },
    };
    const spec = map[key] || { key: String(key), code: String(key), keyCode: 0 };
    const target = el || document.activeElement || document.body;
    const base = { key: spec.key, code: spec.code, keyCode: spec.keyCode, which: spec.keyCode, bubbles: true, cancelable: true, composed: true };
    const fire = (type) => {
      try {
        target.dispatchEvent(new KeyboardEvent(type, base));
      } catch { /* ignore */ }
    };
    fire('keydown');
    if (spec.keyCode === 13 || spec.keyCode === 32) fire('keypress');
    fire('keyup');
  }

  function type(params) {
    params = params || {};
    const text = params.text == null ? '' : String(params.text);
    const el = params.ref ? getRefElement(params.ref) : document.activeElement;
    if (!el) {
      return { error: params.ref ? 'Element ' + params.ref + ' not found. Take a new snapshot.' : 'Nothing is focused on the page.', missing: true };
    }
    try {
      el.scrollIntoView({ block: 'center', inline: 'center' });
    } catch { /* ignore */ }
    try {
      el.focus({ preventScroll: true });
    } catch { /* ignore */ }
    const tag = el.tagName.toLowerCase();
    const info = { tag, name: accessibleName(el) };
    const clear = params.clear !== false;

    if (el.isContentEditable) {
      if (clear) selectAllContents(el);
      let inserted = false;
      try {
        inserted = document.execCommand('insertText', false, text);
      } catch { /* ignore */ }
      if (!inserted) {
        el.textContent = text;
        try {
          el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        } catch {
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    } else if (tag === 'input' || tag === 'textarea') {
      if (clear) {
        try {
          el.select();
        } catch { /* ignore */ }
      }
      setNativeValue(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      el.focus();
      try {
        document.execCommand('insertText', false, text);
      } catch { /* ignore */ }
    }

    if (params.submit) pressKeyOn(el, 'Enter');
    highlight(el);
    return {
      tag,
      text: info.name,
      selector: cssSelector(el),
      frameUrl: String(location.href).slice(0, 300),
      note: params.submit ? 'Text entered and Enter pressed.' : 'Text entered.',
    };
  }

  function pressKey(params) {
    const el = document.activeElement || document.body;
    const name = params && params.key ? String(params.key) : 'Enter';
    const described = describe(el);
    pressKeyOn(el, name);
    return { note: 'Pressed ' + name + ' on ' + (described || 'page') + '.', frameUrl: String(location.href).slice(0, 300) };
  }

  let lastScrollTarget = null;

  function findScrollContainer() {
    if (lastScrollTarget && lastScrollTarget.isConnected) return lastScrollTarget;
    let best = null;
    let bestScore = 0;
    const all = document.querySelectorAll('body *');
    const limit = Math.min(all.length, 3000);
    for (let i = 0; i < limit; i++) {
      const el = all[i];
      const style = getComputedStyle(el);
      if (!/(auto|scroll|overlay)/.test(style.overflowY)) continue;
      const scrollable = el.scrollHeight - el.clientHeight;
      if (scrollable < 60) continue;
      const rect = el.getBoundingClientRect();
      const area = Math.max(0, Math.min(rect.width, window.innerWidth)) * Math.max(0, Math.min(rect.height, window.innerHeight));
      const score = area + scrollable;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    lastScrollTarget = best;
    return best;
  }

  function scroll(params) {
    params = params || {};
    const direction = params.direction || 'down';
    const amount = Math.max(50, Math.min(5000, Number(params.amount) || 600));
    const target = findScrollContainer();
    if (target) {
      if (direction === 'top') target.scrollTop = 0;
      else if (direction === 'bottom') target.scrollTop = target.scrollHeight;
      else target.scrollBy({ top: direction === 'up' ? -amount : amount, behavior: 'smooth' });
    } else {
      if (direction === 'top') window.scrollTo(0, 0);
      else if (direction === 'bottom') window.scrollTo(0, document.documentElement.scrollHeight);
      else window.scrollBy({ top: direction === 'up' ? -amount : amount, behavior: 'smooth' });
    }
    return {
      scrollY: Math.round(window.scrollY),
      container: target ? describe(target) : 'window',
      containerScrollTop: target ? Math.round(target.scrollTop) : undefined,
      frameUrl: String(location.href).slice(0, 300),
    };
  }

  function hasText(params) {
    const needle = params && params.text ? String(params.text) : '';
    const haystack = ((document.body && document.body.innerText) || '') + '\n';
    const inputValues = Array.from(document.querySelectorAll('input, textarea'))
      .map((el) => el.value || '')
      .join('\n');
    return {
      found: needle ? haystack.includes(needle) || inputValues.includes(needle) : true,
      url: String(location.href).slice(0, 300),
      title: String(document.title || '').slice(0, 200),
    };
  }

  // ============================================================= overlay =====
  // Видимый слой агента на странице: курсор, подсветка элементов (Vision),
  // пикер, анимации действий и плавающий статус. Живёт в Shadow DOM, чтобы
  // стили страницы его не ломали; CSS — constructed stylesheet, чтобы
  // строгий CSP страницы не блокировал оформление.

  const OVERLAY_HOST_ID = '__dsh-agent-overlay-host';
  const CURSOR_SVG =
    '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' +
    '<path d="M4 2 L20 12 L12.6 13.4 L17.2 21 L14 22.6 L9.4 15 L4.6 19.2 Z" ' +
    'fill="#e6feff" stroke="#0b1220" stroke-width="1.1" stroke-linejoin="round"/></svg>';

  const OVERLAY_CSS = `
    :host { all: initial; position: fixed; inset: 0; width: 0; height: 0; z-index: 2147483600; pointer-events: none; }
    * { box-sizing: border-box; }
    .veil { position: fixed; inset: 0; background: rgba(2,6,16,.42); opacity: 0; transition: opacity .25s ease; pointer-events: none; }
    .veil.on { opacity: 1; }
    .veil.picker { background: rgba(2,6,16,.22); }
    .layer { position: fixed; inset: 0; pointer-events: none; overflow: hidden; }
    .boxes { position: fixed; inset: 0; pointer-events: none; }
    .box { position: fixed; border: 1px solid rgba(103,232,249,.92); border-radius: 5px;
      background: rgba(103,232,249,.06);
      box-shadow: 0 0 14px rgba(103,232,249,.4), inset 0 0 10px rgba(103,232,249,.12);
      opacity: 0; animation: boxIn .22s ease forwards; }
    .box.v-link { border-color: rgba(167,139,250,.92); background: rgba(167,139,250,.08);
      box-shadow: 0 0 14px rgba(167,139,250,.4), inset 0 0 10px rgba(167,139,250,.12); }
    .box.v-input { border-color: rgba(251,191,36,.92); background: rgba(251,191,36,.07);
      box-shadow: 0 0 14px rgba(251,191,36,.35), inset 0 0 10px rgba(251,191,36,.1); }
    .badge { position: absolute; top: -14px; left: -1px; padding: 2px 5px; border-radius: 4px;
      background: #67e8f9; color: #02060f; font: 700 9px/1.2 ui-monospace, "Cascadia Mono", Consolas, monospace;
      letter-spacing: .06em; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,.45); }
    .box.v-link .badge { background: #a78bfa; color: #0b0616; }
    .box.v-input .badge { background: #fbbf24; color: #1a1203; }
    @keyframes boxIn { from { opacity: 0; transform: scale(.985); } to { opacity: .96; transform: none; } }
    .banner { position: fixed; top: 16px; left: 50%; display: flex; align-items: center; gap: 10px;
      padding: 8px 14px; border-radius: 999px; transform: translate(-50%, -10px); opacity: 0;
      background: rgba(3,9,20,.86); border: 1px solid rgba(103,232,249,.42);
      box-shadow: 0 0 30px rgba(103,232,249,.22); backdrop-filter: blur(10px);
      color: #dffcff; font: 700 10px/1 ui-monospace, "Cascadia Mono", Consolas, monospace;
      letter-spacing: .18em; transition: opacity .22s ease, transform .22s ease; white-space: nowrap; }
    .banner.on { opacity: 1; transform: translate(-50%, 0); }
    .banner .bdot { width: 6px; height: 6px; border-radius: 50%; background: #67e8f9;
      box-shadow: 0 0 10px #67e8f9; animation: blink 1.2s ease-in-out infinite; }
    .banner .meta { color: #7dd3fc; font-weight: 500; letter-spacing: .08em; }
    @keyframes blink { 0%, 100% { opacity: .25; } 50% { opacity: 1; } }
    .cursor { position: fixed; left: 0; top: 0; margin: -2px 0 0 -1px; opacity: 0; width: 22px; height: 22px;
      transition: left .4s cubic-bezier(.22,.9,.25,1), top .4s cubic-bezier(.22,.9,.25,1), opacity .18s ease;
      filter: drop-shadow(0 0 7px rgba(103,232,249,.95)); will-change: left, top; }
    .cursor.on { opacity: 1; }
    .cursor svg { display: block; }
    .cursor-tag { position: absolute; left: 18px; top: 16px; padding: 2px 5px; border-radius: 4px;
      background: rgba(3,9,20,.94); border: 1px solid rgba(103,232,249,.55); color: #67e8f9;
      font: 700 8px/1 ui-monospace, "Cascadia Mono", Consolas, monospace;
      letter-spacing: .1em; white-space: nowrap; box-shadow: 0 0 12px rgba(103,232,249,.35); }
    .ripple { position: fixed; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%;
      border: 2px solid #67e8f9; box-shadow: 0 0 20px #67e8f9; animation: ripple .75s ease-out forwards; }
    @keyframes ripple { from { transform: scale(.4); opacity: 1; } to { transform: scale(3.6); opacity: 0; } }
    .lock { position: fixed; border: 1px solid rgba(103,232,249,.9); border-radius: 6px;
      box-shadow: 0 0 22px rgba(103,232,249,.6); animation: lock .95s ease-out forwards; }
    @keyframes lock { 0% { opacity: 1; transform: scale(1.02); } 100% { opacity: 0; transform: scale(1); } }
    .typing { position: fixed; display: flex; gap: 3px; padding: 4px 8px; border-radius: 999px;
      background: rgba(3,9,20,.9); border: 1px solid rgba(103,232,249,.5);
      transform: translate(-50%, -140%); box-shadow: 0 0 14px rgba(103,232,249,.3); }
    .typing i { width: 4px; height: 4px; border-radius: 50%; background: #67e8f9; animation: typedot .9s infinite; }
    .typing i:nth-child(2) { animation-delay: .14s; }
    .typing i:nth-child(3) { animation-delay: .28s; }
    @keyframes typedot { 0%, 100% { opacity: .25; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-2px); } }
    .scan { position: fixed; left: 0; right: 0; height: 140px; top: -140px; pointer-events: none;
      background: linear-gradient(180deg, transparent, rgba(103,232,249,.16) 55%, rgba(103,232,249,.5));
      border-bottom: 1px solid rgba(160,247,255,.9); mix-blend-mode: screen;
      animation: scan 1.15s ease-in-out forwards; }
    @keyframes scan { 0% { top: -140px; opacity: 0; } 12% { opacity: 1; } 100% { top: 100%; opacity: 0; } }
    .toasts { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%);
      display: flex; flex-direction: column; align-items: center; gap: 6px; }
    .toast { padding: 9px 15px; border-radius: 999px; background: rgba(3,9,20,.92);
      border: 1px solid rgba(103,232,249,.45); color: #e6ffff; box-shadow: 0 0 26px rgba(103,232,249,.25);
      font: 600 11px/1.2 ui-monospace, "Cascadia Mono", Consolas, monospace; letter-spacing: .08em;
      animation: toastIn .22s ease; white-space: nowrap; max-width: 80vw; overflow: hidden; text-overflow: ellipsis; }
    .toast.warn { border-color: rgba(251,191,36,.6); color: #fde68a; }
    @keyframes toastIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    .orb { position: fixed; right: 16px; bottom: 16px; width: 12px; height: 12px; border-radius: 50%;
      background: #22c55e; box-shadow: 0 0 0 4px rgba(34,197,94,.14), 0 0 18px rgba(34,197,94,.85);
      pointer-events: auto; cursor: pointer; transition: transform .18s ease, background .18s ease;
      z-index: 2; }
    .orb:hover { transform: scale(1.3); }
    .orb.paused { background: #f59e0b; box-shadow: 0 0 0 4px rgba(245,158,11,.14), 0 0 18px rgba(245,158,11,.85); }
    .orb.off { background: #64748b; box-shadow: 0 0 0 4px rgba(100,116,139,.14), 0 0 12px rgba(100,116,139,.7); }
    .orb.flash { animation: orbFlash .5s ease; }
    @keyframes orbFlash { 0% { transform: scale(1); } 40% { transform: scale(1.7); } 100% { transform: scale(1); } }
    .orb-panel { position: absolute; right: 0; bottom: 22px; min-width: 220px; padding: 10px 12px;
      border-radius: 10px; background: rgba(2,7,17,.95); border: 1px solid rgba(103,232,249,.3);
      box-shadow: 0 14px 44px rgba(0,0,0,.6); color: #dffcff;
      font: 500 10.5px/1.5 ui-monospace, "Cascadia Mono", Consolas, monospace; letter-spacing: .05em;
      opacity: 0; transform: translateY(6px); transition: .16s ease; pointer-events: none; }
    .orb:hover .orb-panel { opacity: 1; transform: none; }
    .orb-title { color: #67e8f9; font-weight: 700; letter-spacing: .2em; font-size: 9.5px; }
    .orb-status { margin-top: 3px; color: #a5f3fc; letter-spacing: .14em; font-weight: 700; font-size: 9.5px; }
    .orb-last { margin-top: 4px; color: #94a3b8; font-size: 9.5px;
      max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pickerbox { position: fixed; border: 1.5px dashed rgba(255,107,214,.95); border-radius: 5px;
      background: rgba(255,107,214,.08); box-shadow: 0 0 18px rgba(255,107,214,.45); display: none; }
    .hidden { display: none !important; }
  `;

  const OVERLAY_HTML =
    '<div class="veil"></div>' +
    '<div class="layer">' +
    '<div class="boxes"></div>' +
    '<div class="pickerbox"></div>' +
    '<div class="cursor">' + CURSOR_SVG + '<span class="cursor-tag">DSH</span></div>' +
    '</div>' +
    '<div class="banner"><span class="bdot"></span><span class="banner-text">AGENT VISION</span><span class="meta banner-meta"></span></div>' +
    '<div class="toasts"></div>' +
    '<div class="orb hidden"><div class="orb-panel"><div class="orb-title">DSH BROWSER AGENT</div>' +
    '<div class="orb-status">ОНЛАЙН</div><div class="orb-last">ожидание задачи</div></div></div>';

  const ov = {
    host: null,
    shadow: null,
    cursor: null,
    layer: null,
    boxes: null,
    veil: null,
    banner: null,
    bannerText: null,
    bannerMeta: null,
    toasts: null,
    orb: null,
    orbStatus: null,
    orbLast: null,
    pickerBox: null,
    vision: false,
    picker: false,
    entries: [],
    timer: 0,
    cursorTimer: 0,
    status: { connected: false, paused: false, showOrb: false },
    lastAction: '',
  };

  function ovCopy(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => ovCopyFallback(text));
        return true;
      }
    } catch { /* ignore */ }
    return ovCopyFallback(text);
  }

  function ovCopyFallback(text) {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.documentElement.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      return true;
    } catch {
      return false;
    }
  }

  function ovEnsure() {
    if (ov.host && ov.host.isConnected) return ov.shadow;
    let host = document.getElementById(OVERLAY_HOST_ID);
    if (host) host.remove();
    host = document.createElement('div');
    host.id = OVERLAY_HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = OVERLAY_HTML;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(OVERLAY_CSS);
      shadow.adoptedStyleSheets = [sheet];
    } catch {
      const styleEl = document.createElement('style');
      styleEl.textContent = OVERLAY_CSS;
      shadow.appendChild(styleEl);
    }
    ov.host = host;
    ov.shadow = shadow;
    ov.veil = shadow.querySelector('.veil');
    ov.layer = shadow.querySelector('.layer');
    ov.boxes = shadow.querySelector('.boxes');
    ov.banner = shadow.querySelector('.banner');
    ov.bannerText = shadow.querySelector('.banner-text');
    ov.bannerMeta = shadow.querySelector('.banner-meta');
    ov.toasts = shadow.querySelector('.toasts');
    ov.cursor = shadow.querySelector('.cursor');
    ov.orb = shadow.querySelector('.orb');
    ov.orbStatus = shadow.querySelector('.orb-status');
    ov.orbLast = shadow.querySelector('.orb-last');
    ov.pickerBox = shadow.querySelector('.pickerbox');
    ov.orb.addEventListener('click', (event) => {
      event.stopPropagation();
      if (ov.vision) ovVision({ on: false });
      else ovVision({ on: true });
    });
    document.documentElement.appendChild(host);
    ovApplyStatus();
    return shadow;
  }

  function ovApplyStatus() {
    if (!ov.orb) return;
    const { connected, paused, showOrb } = ov.status;
    ov.orb.classList.toggle('hidden', showOrb === false);
    ov.orb.classList.toggle('paused', !!paused);
    ov.orb.classList.toggle('off', !connected);
    if (ov.orbStatus) ov.orbStatus.textContent = paused ? 'НА ПАУЗЕ' : connected ? 'ОНЛАЙН' : 'ОФФЛАЙН';
  }

  function ovToast(text, tone) {
    ovEnsure();
    const node = document.createElement('div');
    node.className = 'toast' + (tone ? ' ' + tone : '');
    node.textContent = String(text || '');
    ov.toasts.appendChild(node);
    while (ov.toasts.children.length > 3) ov.toasts.removeChild(ov.toasts.firstChild);
    setTimeout(() => {
      try { node.remove(); } catch { /* ignore */ }
    }, 2800);
    return { ok: true };
  }

  function ovHideCursorSoon() {
    if (ov.cursorTimer) clearTimeout(ov.cursorTimer);
    ov.cursorTimer = setTimeout(() => {
      if (ov.cursor) ov.cursor.classList.remove('on');
      ov.cursorTimer = 0;
    }, 1700);
  }

  function ovMoveCursor(x, y, opts) {
    ovEnsure();
    opts = opts || {};
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const wasHidden = !ov.cursor.classList.contains('on');
    if (wasHidden) ov.cursor.style.transition = 'opacity .15s ease';
    ov.cursor.style.left = Math.round(x) + 'px';
    ov.cursor.style.top = Math.round(y) + 'px';
    if (wasHidden) {
      void ov.cursor.offsetWidth;
      ov.cursor.style.transition = '';
    }
    ov.cursor.classList.add('on');
    ovOrbPulse();
    if (opts.ripple) setTimeout(() => ovRipple(x, y), opts.rippleDelay == null ? 380 : opts.rippleDelay);
    if (opts.hideAfter !== false) ovHideCursorSoon();
  }

  function ovOrbPulse() {
    if (!ov.orb) return;
    ov.orb.classList.remove('flash');
    void ov.orb.offsetWidth;
    ov.orb.classList.add('flash');
  }

  function ovRipple(x, y) {
    if (!ov.layer) return;
    const node = document.createElement('div');
    node.className = 'ripple';
    node.style.left = Math.round(x) + 'px';
    node.style.top = Math.round(y) + 'px';
    ov.layer.appendChild(node);
    setTimeout(() => {
      try { node.remove(); } catch { /* ignore */ }
    }, 800);
    ov.orbPulse();
  }

  function ovLock(rect) {
    if (!ov.layer) return;
    const node = document.createElement('div');
    node.className = 'lock';
    node.style.left = Math.round(rect.left - 4) + 'px';
    node.style.top = Math.round(rect.top - 4) + 'px';
    node.style.width = Math.round(rect.width + 8) + 'px';
    node.style.height = Math.round(rect.height + 8) + 'px';
    ov.layer.appendChild(node);
    setTimeout(() => {
      try { node.remove(); } catch { /* ignore */ }
    }, 1000);
  }

  function ovStatus(args) {
    args = args || {};
    ovEnsure();
    if (typeof args.connected === 'boolean') ov.status.connected = args.connected;
    if (typeof args.paused === 'boolean') ov.status.paused = args.paused;
    if (typeof args.showOrb === 'boolean') ov.status.showOrb = args.showOrb;
    ovApplyStatus();
    return { ok: true, status: ov.status };
  }

  function ovActivity(args) {
    args = args || {};
    ovEnsure();
    if (args.label) {
      ov.lastAction = String(args.label);
      if (ov.orbLast) ov.orbLast.textContent = 'LAST: ' + ov.lastAction;
    }
    ovApplyStatus();
    ovOrbPulse();
    if (args.ok === false) ovToast('ОШИБКА АГЕНТА: ' + String(args.error || args.label || '').slice(0, 70), 'warn');
    return { ok: true };
  }

  function ovScan(args) {
    ovEnsure();
    const count = args && Number.isFinite(Number(args.count)) ? Number(args.count) : null;
    const node = document.createElement('div');
    node.className = 'scan';
    ov.layer.appendChild(node);
    setTimeout(() => {
      try { node.remove(); } catch { /* ignore */ }
    }, 1300);
    if (ov.vision) ovLayout();
    return { ok: true, count };
  }

  function ovVision(args) {
    ovEnsure();
    const on = !args || args.on !== false;
    if (on) {
      if (ov.picker) ovPicker({ on: false });
      ov.vision = true;
      ov.entries = collectCandidates(180).map((el, index) => ({ el, ref: 'e' + (index + 1), node: null }));
      ov.veil.classList.add('on');
      ov.banner.classList.add('on');
      ov.bannerText.textContent = 'AGENT VISION';
      ov.bannerMeta.textContent = ov.entries.length + ' ЭЛЕМЕНТОВ · ESC — ЗАКРЫТЬ';
      ovLayout();
      if (ov.timer) clearInterval(ov.timer);
      ov.timer = setInterval(ovLayout, 300);
      if (!ov.visionBound) {
        ov.visionBound = true;
        window.addEventListener('scroll', () => { if (ov.vision) ovLayout(); }, true);
        window.addEventListener('resize', () => { if (ov.vision) ovLayout(); });
      }
    } else {
      ov.vision = false;
      if (ov.timer) { clearInterval(ov.timer); ov.timer = 0; }
      ov.veil.classList.remove('on');
      ov.banner.classList.remove('on');
      ov.boxes.innerHTML = '';
      ov.entries = [];
    }
    return { ok: true, on: ov.vision, count: ov.entries.length };
  }

  function ovLayout() {
    if (!ov.vision || !ov.boxes) return;
    const height = window.innerHeight;
    for (const entry of ov.entries) {
      const el = entry.el;
      if (!el || !el.isConnected) {
        if (entry.node) entry.node.style.display = 'none';
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2 || rect.bottom < -40 || rect.top > height + 40) {
        if (entry.node) entry.node.style.display = 'none';
        continue;
      }
      if (!entry.node) {
        const node = document.createElement('div');
        node.className = 'box';
        const tag = (el.tagName || '').toLowerCase();
        if (tag === 'a') node.classList.add('v-link');
        else if (tag === 'input' || tag === 'textarea' || tag === 'select') node.classList.add('v-input');
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = '@' + entry.ref;
        node.appendChild(badge);
        ov.boxes.appendChild(node);
        entry.node = node;
      }
      const node = entry.node;
      node.style.display = '';
      node.style.left = Math.round(rect.left) + 'px';
      node.style.top = Math.round(rect.top) + 'px';
      node.style.width = Math.round(Math.max(2, rect.width)) + 'px';
      node.style.height = Math.round(Math.max(2, rect.height)) + 'px';
    }
  }

  function ovPicker(args) {
    ovEnsure();
    const on = !args || args.on !== false;
    if (on) {
      if (ov.vision) ovVision({ on: false });
      ov.picker = true;
      ov.veil.classList.add('on', 'picker');
      ov.banner.classList.add('on');
      ov.bannerText.textContent = 'PICKER';
      ov.bannerMeta.textContent = 'КЛИКНИ ЭЛЕМЕНТ — @REF СКОПИРУЕТСЯ · ESC';
      window.addEventListener('pointermove', ovPickerMove, true);
      window.addEventListener('click', ovPickerClick, true);
    } else {
      ov.picker = false;
      window.removeEventListener('pointermove', ovPickerMove, true);
      window.removeEventListener('click', ovPickerClick, true);
      ov.veil.classList.remove('on', 'picker');
      ov.banner.classList.remove('on');
      if (ov.pickerBox) ov.pickerBox.style.display = 'none';
    }
    return { ok: true, on: ov.picker };
  }

  function ovPickerMove(event) {
    if (!ov.picker || !ov.pickerBox) return;
    const el = document.elementFromPoint(event.clientX, event.clientY);
    if (!el || el === document.documentElement || el === document.body) {
      ov.pickerBox.style.display = 'none';
      return;
    }
    const rect = el.getBoundingClientRect();
    ov.pickerBox.style.display = 'block';
    ov.pickerBox.style.left = Math.round(rect.left) + 'px';
    ov.pickerBox.style.top = Math.round(rect.top) + 'px';
    ov.pickerBox.style.width = Math.round(Math.max(2, rect.width)) + 'px';
    ov.pickerBox.style.height = Math.round(Math.max(2, rect.height)) + 'px';
  }

  function ovPickerClick(event) {
    if (!ov.picker) return;
    // Реальные клики пользователя перехватываем, а программные клики агента —
    // нет: иначе включённый пикер ломает работу агента.
    if (event && event.isTrusted === false) return;
    event.preventDefault();
    event.stopPropagation();
    const el = document.elementFromPoint(event.clientX, event.clientY);
    const ref = el ? ovResolveRef(el) : '';
    if (!ref) {
      ovToast('ЭТОТ ЭЛЕМЕНТ НЕ ИНТЕРАКТИВНЫЙ — ВОЗЬМИ КНОПКУ/ССЫЛКУ/ПОЛЕ', 'warn');
      return;
    }
    const name = (el && accessibleName(el)) || '';
    const tag = el ? el.tagName.toLowerCase() : '';
    const command = '@' + ref;
    ovCopy(command);
    ovToast('СКОПИРОВАНО: ' + command + (name ? ' · ' + String(name).slice(0, 34) : ''));
    try {
      chrome.runtime.sendMessage({
        type: 'pickerResult',
        payload: { ref: command, tag, name: String(name).slice(0, 120), command, url: String(location.href).slice(0, 300) },
      });
    } catch { /* extension context may be gone */ }
    ovPicker({ on: false });
  }

  function ovResolveRef(el) {
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const attr = node.getAttribute && node.getAttribute(REF_ATTR);
      if (attr) return attr;
    }
    try {
      const candidates = collectCandidates(200);
      let index = candidates.indexOf(el);
      if (index < 0) {
        for (let node = el.parentElement; node; node = node.parentElement) {
          index = candidates.indexOf(node);
          if (index >= 0) break;
        }
      }
      if (index >= 0) return 'e' + (index + 1);
    } catch { /* ignore */ }
    return '';
  }

  function ovElementForRef(ref) {
    const raw = String(ref || '').replace(/^@/, '');
    const direct = raw ? getRefElement(raw) : null;
    if (direct && direct.isConnected) return direct;
    const match = /^e(\d+)$/.exec(raw);
    if (!match) return null;
    try {
      const candidates = collectCandidates(180);
      return candidates[Number(match[1]) - 1] || null;
    } catch {
      return null;
    }
  }

  function ovPulse(args) {
    args = args || {};
    ovEnsure();
    const ref = String(args.ref || '').replace(/^@/, '');
    const el = ovElementForRef(ref);
    if (!el) return { ok: false, error: 'ref not found' };
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch { /* ignore */ }
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    ovMoveCursor(x, y, { ripple: true, rippleDelay: 400 });
    ovLock(rect);
    return { ok: true, ref, x, y };
  }

  function ovType(args) {
    args = args || {};
    ovEnsure();
    let el = null;
    if (args.ref) {
      el = ovElementForRef(args.ref);
    }
    if (!el) el = document.activeElement;
    if (!el || !el.getBoundingClientRect) return { ok: false };
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch { /* ignore */ }
    const rect = el.getBoundingClientRect();
    ovMoveCursor(rect.left + rect.width / 2, rect.top + rect.height / 2, { hideAfter: false });
    const tip = document.createElement('div');
    tip.className = 'typing';
    tip.innerHTML = '<i></i><i></i><i></i>';
    tip.style.left = Math.round(rect.left + rect.width / 2) + 'px';
    tip.style.top = Math.round(rect.top) + 'px';
    ov.layer.appendChild(tip);
    setTimeout(() => {
      try { tip.remove(); } catch { /* ignore */ }
    }, 1500);
    ovHideCursorSoon();
    return { ok: true };
  }

  function ovClear() {
    if (ov.vision) ovVision({ on: false });
    if (ov.picker) ovPicker({ on: false });
    if (ov.layer) {
      for (const node of Array.from(ov.layer.querySelectorAll('.ripple,.typing,.scan,.lock'))) {
        try { node.remove(); } catch { /* ignore */ }
      }
    }
    if (ov.cursor) ov.cursor.classList.remove('on');
    if (ov.veil) ov.veil.classList.remove('on', 'picker');
    if (ov.banner) ov.banner.classList.remove('on');
    if (ov.boxes) ov.boxes.innerHTML = '';
    return { ok: true };
  }

  window.addEventListener(
    'keydown',
    (event) => {
      if (event.altKey && event.shiftKey) {
        if (event.code === 'KeyV') {
          event.preventDefault();
          event.stopPropagation();
          ovVision({ on: !ov.vision });
          return;
        }
        if (event.code === 'KeyP') {
          event.preventDefault();
          event.stopPropagation();
          ovPicker({ on: !ov.picker });
          return;
        }
      }
      if (event.key === 'Escape' && (ov.picker || ov.vision)) {
        ovClear();
      }
    },
    true,
  );

  globalThis.__dshAgent = {
    snapshot,
    click,
    type,
    pressKey,
    scroll,
    hasText,
    find,
    waitStable,
    version: 3,
    overlayStatus: ovStatus,
    overlayActivity: ovActivity,
    overlayScan: ovScan,
    overlayPulse: ovPulse,
    overlayType: ovType,
    overlayVision: ovVision,
    overlayPicker: ovPicker,
    overlayClear: ovClear,
    overlayToast: ovToast,
  };
})();
