/**
 * Клиентская половина пакета «Быстрые заметки».
 *
 * Регистрирует пункт глобальной панели в `sidebar.panellist` и соответствующую
 * страницу в корневом keyed-слоте `main`. Кнопку, подпись, подсказку и
 * выделение рисует сама боковая панель; этот модуль даёт иконку и страницу.
 *
 * Плагин русскоязычный: обе встроенные локали несут один и тот же русский
 * текст, поэтому подписи не зависят от языка остального интерфейса.
 */
window.__ModuleLoader__.load({
  id: '@local/sidebar-quick-notes-ru',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'quick-notes-ru';
    const PANEL_ID = 'quick-notes-ru';
    // Тот же ключ, что у английской версии: ранее сохранённые заметки не теряются.
    const STORAGE_KEY = 'dsh.quick-notes.v1';

    const ru = {
      panel: 'Быстрые заметки',
      title: 'Быстрые заметки',
      subtitle: 'Черновик, который всегда под рукой в боковой панели.',
      'editor.label': 'Текст заметки',
      'editor.placeholder': 'Запишите мысль, напоминание или фрагмент текста. Заметка сохраняется автоматически в этом браузере.',
      'status.saved': 'Сохранено в этом браузере',
      'status.unavailable': 'Браузер не смог сохранить заметку',
      'status.characters.one': '{count} символ',
      'status.characters.few': '{count} символа',
      'status.characters.many': '{count} символов',
      'page.hint': 'Заметки хранятся только в этом браузере. Они не отправляются модели и не синхронизируются между устройствами.',
    };

    const CSS = [
      '.qn-page{box-sizing:border-box;height:100%;min-height:100%;overflow:auto;',
      'padding:calc(var(--dsh-frame-top-clearance,0px) + 28px) 28px 40px;',
      'background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);}',
      '.qn-shell{display:flex;flex-direction:column;gap:18px;width:100%;max-width:780px;margin:0 auto;}',
      '.qn-head{display:flex;align-items:center;gap:14px;}',
      '.qn-tile{display:flex;align-items:center;justify-content:center;flex:none;width:44px;height:44px;',
      'border:1px solid var(--dsw-alias-border-l1);border-radius:13px;',
      'background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary);}',
      '.qn-heading{min-width:0;}',
      '.qn-title{margin:0;font-size:22px;line-height:1.25;font-weight:600;letter-spacing:-.01em;}',
      '.qn-subtitle{margin:4px 0 0;font-size:13px;line-height:1.45;color:var(--dsw-alias-label-secondary);}',
      '.qn-card{display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);',
      'border-radius:14px;background:var(--dsw-alias-bg-layer-1);transition:border-color .15s ease;}',
      '.qn-card:focus-within{border-color:var(--dsw-alias-brand-primary);}',
      '.qn-input{box-sizing:border-box;width:100%;min-height:340px;padding:18px 20px;border:0;outline:none;',
      'resize:none;background:transparent;color:var(--dsw-alias-label-primary);',
      'font:inherit;font-size:14px;line-height:1.7;caret-color:var(--dsw-alias-brand-primary);}',
      '.qn-input::placeholder{color:var(--dsw-alias-label-secondary);opacity:.85;}',
      '.qn-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;',
      'padding:10px 16px;border-top:1px solid var(--dsw-alias-border-l1);',
      'font-size:12px;line-height:1.4;color:var(--dsw-alias-label-secondary);}',
      '.qn-status{display:inline-flex;align-items:center;gap:6px;}',
      '.qn-status::before{content:"";width:6px;height:6px;border-radius:50%;',
      'background:var(--dsw-alias-state-success-primary);}',
      '.qn-status-warn{color:var(--dsw-alias-state-warn-primary);}',
      '.qn-status-warn::before{background:var(--dsw-alias-state-warn-primary);}',
      '.qn-count{white-space:nowrap;}',
      '.qn-hint{margin:0;font-size:12.5px;line-height:1.5;color:var(--dsw-alias-label-secondary);}',
      '@media (max-width:640px){.qn-page{padding:calc(var(--dsh-frame-top-clearance,0px) + 16px) 16px 24px;}',
      '.qn-input{min-height:260px;}.qn-title{font-size:19px;}}',
    ].join('');

    /** Прочитать сохранённый текст заметки, не падая при недоступном хранилище. */
    function readNote() {
      try {
        const value = window.localStorage.getItem(STORAGE_KEY);
        return typeof value === 'string' ? value : '';
      } catch (_error) {
        return '';
      }
    }

    /** Сохранить текст заметки в этом браузере и сообщить, удалось ли это. */
    function writeNote(value) {
      try {
        window.localStorage.setItem(STORAGE_KEY, value);
        return true;
      } catch (_error) {
        return false;
      }
    }

    /** Форма русского числительного для счётчика символов. */
    function pluralKey(count) {
      const mod10 = count % 10;
      const mod100 = count % 100;
      if (mod10 === 1 && mod100 !== 11) return 'one';
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
      return 'many';
    }

    /**
     * Иконка пункта боковой панели: панель задаёт квадратный размер и признак
     * выбранного состояния.
     *
     * @param props - `size` в пикселях и `active` — выбрана ли панель.
     */
    function QuickNotesIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 18;
      const active = props.active === true;
      const strokeWidth = active ? 1.9 : 1.6;
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block', flex: 'none' },
        },
        h('path', {
          d: 'M7 3.75h6.75L18.25 8.1v12.15a1.6 1.6 0 0 1-1.6 1.6H7a1.6 1.6 0 0 1-1.6-1.6V5.35A1.6 1.6 0 0 1 7 3.75Z',
          stroke: 'currentColor',
          strokeWidth,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M13.6 3.9v4.35h4.5',
          stroke: 'currentColor',
          strokeWidth,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M8.75 12.1h6.5M8.75 15.4h6.5M8.75 18.7h3.9',
          stroke: 'currentColor',
          strokeWidth,
          strokeLinecap: 'round',
        }),
      );
    }

    /**
     * Глобальная страница «Быстрые заметки», зарегистрированная под ключом `main`.
     *
     * @param props - пропсы слота; `t` привязан к пространству имён плагина.
     */
    function QuickNotesPanel(props) {
      const t = props.t;
      const [note, setNote] = React.useState(readNote);
      const [stored, setStored] = React.useState(true);

      React.useEffect(() => {
        setStored(writeNote(note));
      }, [note]);

      return h(
        'div',
        { className: 'qn-page' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'qn-shell' },
          h(
            'header',
            { className: 'qn-head' },
            h('span', { className: 'qn-tile', 'aria-hidden': 'true' }, h(QuickNotesIcon, { size: 22, active: true })),
            h(
              'div',
              { className: 'qn-heading' },
              h('h1', { className: 'qn-title' }, t('title')),
              h('p', { className: 'qn-subtitle' }, t('subtitle')),
            ),
          ),
          h(
            'section',
            { className: 'qn-card' },
            h('textarea', {
              className: 'qn-input',
              value: note,
              rows: 12,
              spellCheck: false,
              autoComplete: 'off',
              placeholder: t('editor.placeholder'),
              'aria-label': t('editor.label'),
              onChange: (event) => {
                setNote(event.target.value);
              },
            }),
            h(
              'footer',
              { className: 'qn-foot' },
              h('span', { className: stored ? 'qn-status' : 'qn-status qn-status-warn', role: 'status' }, t(stored ? 'status.saved' : 'status.unavailable')),
              h('span', { className: 'qn-count' }, t('status.characters.' + pluralKey(note.length), { count: note.length })),
            ),
          ),
          h('p', { className: 'qn-hint' }, t('page.hint')),
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en: ru, zh: ru }), 'quick-notes-ru: dictionaries');
        const t = ctx.locale.bind(NS);
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 20,
              locale: NS,
              label: () => t('panel'),
            },
            QuickNotesIcon,
          ),
        );
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS,
            },
            QuickNotesPanel,
          ),
        );
      },
    };
  },
});
