/**
 * @module Dashboard/widget-sdk/defineWidget
 * @summary Tiny factory that wraps a widget config into a HTMLElement class
 *          using `<km-wgt-shell>` as the frame.
 *
 * Lifecycle:
 *   1. connectedCallback() — create the shell, run `setup` (sync) and `load` (async)
 *   2. load() resolves — setState triggers re-render
 *   3. on error — shell shows the error state with a "Retry" action
 *   4. on empty (state === 'empty' with no data) — shell shows the empty state
 *   5. on disconnect — abort any in-flight load
 *
 * The widget receives a render() callback that should return a template string
 * (or a DOM Node). Re-rendering replaces the slot content of the shell.
 *
 * @typedef {Object} WidgetContext
 * @property {HTMLElement}    host    - the widget element itself
 * @property {KmWgtShell}     shell   - the inner shell element (read-only)
 * @property {Object}         state   - current reactive state (don't mutate)
 * @property {(patch:Object) => void} setState - merge a patch into state, re-render
 * @property {() => Promise<void>}     reload   - abort and re-run load()
 * @property {AbortSignal}             signal   - aborted on disconnect / reload
 *
 * @typedef {Object} WidgetConfig
 * @property {string}   id
 * @property {string}   label
 * @property {string}   icon       - km-icon name
 * @property {number}   [defaultW=3]
 * @property {number}   [defaultH=2]
 * @property {(ctx:WidgetContext) => void} [setup]   - sync init, subscribe to store
 * @property {(ctx:WidgetContext) => Promise<any>} [load] - async data fetch
 * @property {(ctx:WidgetContext) => void} [onMount] - called after first mount, for attaching listeners
 * @property {(ctx:WidgetContext) => void} [onUnmount] - called before disconnect
 * @property {(state:any) => boolean} [isEmpty]       - when true, shell shows empty state
 * @property {string}   [emptyMessage='Nothing to show yet']
 * @property {string}   [errorMessage]
 * @property {string}   [loadingMessage='Loading…']
 * @property {(ctx:WidgetContext) => string|Node} render
 * @property {(ctx:WidgetContext) => string} [badge] - returns badge text (or '' to hide)
 *
 * @example
 *   import { defineWidget } from './widget-sdk/defineWidget.js';
 *
 *   defineWidget({
 *     id: 'hello',
 *     label: 'Hello',
 *     icon: 'sparkles',
 *     defaultW: 6, defaultH: 1,
 *     load: async ({ setState }) => {
 *       const data = await fetchGreeting();
 *       setState({ data });
 *     },
 *     render: ({ state }) => `<p>${state.data ?? ''}</p>`,
 *   });
 */

import { Logger } from '../../../../core/Logger.js';
import '../../../ui/KmWgtShell/KmWgtShell.js';

let _seq = 0;

/**
 * @param {WidgetConfig} cfg
 * @returns {typeof HTMLElement}
 */
export function defineWidget(cfg) {
  if (!cfg?.id)        throw new Error('defineWidget: id is required');
  if (!cfg.render)     throw new Error('defineWidget: render() is required');
  if (!cfg.icon)       Logger.warn('defineWidget', `${cfg.id}: no icon`);
  if (!cfg.label)      cfg = { ...cfg, label: cfg.id };

  const tag = `km-wgt-${cfg.id}-${++_seq}-sdk`;

  class KmSdkWidget extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._state = {};
      this._abort = null;
      this._unsub = [];
      this._renderToken = 0;
    }

    connectedCallback() {
      this._mount();
    }

    disconnectedCallback() {
      try { cfg.onUnmount?.(this._ctx); } catch {}
      this._abort?.abort();
      for (const u of this._unsub) try { u(); } catch {}
      this._unsub = [];
    }

    _mount() {
      // 1. Set up shell attributes from the config (reactive; future attr changes on cfg could re-render)
      this.shadowRoot.innerHTML = '';
      const shell = document.createElement('km-wgt-shell');
      shell.setAttribute('icon', cfg.icon || 'box');
      shell.setAttribute('label', cfg.label);
      shell.setAttribute('state', 'loading');
      this.shadowRoot.appendChild(shell);
      this._shell = shell;

      // 2. Build the context the user callbacks see
      const self = this;
      const ctx = {
        host:  self,
        shell: self._shell,
        get state() { return self._state; },
        setState: (patch) => self._setState(patch),
        reload: () => self._runLoad(),
        signal: null, // assigned per-load
      };
      this._ctx = ctx;

      // 3. Run sync setup (subscriptions, etc.)
      try { cfg.setup?.(ctx); } catch (e) {
        Logger.error('defineWidget', `${cfg.id} setup failed`, e);
      }

      // 4. onMount — for attaching event listeners on the host
      try { cfg.onMount?.(ctx); } catch (e) {
        Logger.error('defineWidget', `${cfg.id} onMount failed`, e);
      }

      // 5. Kick off the initial load
      this._runLoad();
    }

    _setState(patch) {
      this._state = { ...this._state, ...patch };
      this._render();
    }

    async _runLoad() {
      if (!cfg.load) {
        this._setState({ __loaded: true });
        this._shell.setAttribute('state', 'ok');
        this._render();
        return;
      }

      // Tear down any in-flight load
      this._abort?.abort();
      const ac = new AbortController();
      this._abort = ac;
      this._ctx.signal = ac.signal;

      this._shell.setAttribute('state', 'loading');
      this._shell.setStateMessage('loading', { message: cfg.loadingMessage ?? 'Loading…' });

      const token = ++this._renderToken;
      try {
        const result = await cfg.load(this._ctx);
        if (token !== this._renderToken || ac.signal.aborted) return;
        if (result !== undefined) this._state = { ...this._state, ...(result ?? {}) };
        const empty = cfg.isEmpty?.(this._state) ?? !_hasContent(this._state);
        this._shell.setAttribute('state', empty ? 'empty' : 'ok');
        this._shell.setStateMessage(empty ? 'empty' : 'ok', {
          message: empty ? (cfg.emptyMessage ?? 'Nothing to show yet') : '',
        });
        this._render();
      } catch (e) {
        if (ac.signal.aborted) return;
        Logger.error('defineWidget', `${cfg.id} load failed`, e);
        this._shell.setAttribute('state', 'error');
        this._shell.setStateMessage('error', {
          message: cfg.errorMessage ?? e?.message ?? 'Could not load widget',
          action: { label: 'Retry', onClick: () => this._runLoad() },
        });
      }
    }

    _render() {
      if (!this._shell) return;
      const token = ++this._renderToken;
      const out = (() => {
        try { return cfg.render(this._ctx); }
        catch (e) {
          Logger.error('defineWidget', `${cfg.id} render failed`, e);
          this._shell.setAttribute('state', 'error');
          this._shell.setStateMessage('error', {
            message: e?.message ?? 'Render failed',
            action: { label: 'Retry', onClick: () => this._runLoad() },
          });
          return '';
        }
      })();

      // Defer to next frame so we don't fight the slot update. Use setTimeout
      // instead of rAF — some headless/backgrounded contexts throttle rAF
      // heavily, which made body content never land in the test browser.
      setTimeout(() => {
        if (token !== this._renderToken || !this.isConnected) return;
        this._replaceBody(out);
        // Update badge if provided
        try {
          const b = cfg.badge?.(this._ctx);
          this._shell.setAttribute('badge', b ?? '');
        } catch (e) {
          Logger.warn('defineWidget', `${cfg.id} badge failed`, e);
        }
      }, 0);
    }

    _replaceBody(content) {
      // Append into the shell's light DOM so the shell's own <slot>
      // projects the body. Appending into `this` (the widget) wouldn't work
      // because the slot lives in the shell's shadow root, not the widget's.
      const target = this._shell;
      [...target.children].forEach(c => c.remove());
      if (content == null || content === '') return;

      let node;
      if (typeof content === 'string') {
        const tpl = document.createElement('template');
        tpl.innerHTML = content.trim();
        node = tpl.content;
      } else {
        node = content;
      }
      target.appendChild(node);
    }
  }

  if (!customElements.get(tag)) customElements.define(tag, KmSdkWidget);
  return { tag, ctor: KmSdkWidget, cfg };
}

// Heuristic: state has content if it has any non-internal, non-null property
function _hasContent(state) {
  for (const k of Object.keys(state)) {
    if (k.startsWith('__')) continue;
    const v = state[k];
    if (v == null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && v !== null && Object.keys(v).length === 0) continue;
    return true;
  }
  return false;
}
