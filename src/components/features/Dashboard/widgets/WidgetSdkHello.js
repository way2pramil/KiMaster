/**
 * @element km-wgt-sdk-hello-N-sdk
 * @summary Reference widget built on the defineWidget() SDK. Demonstrates:
 *   - setup() initializing state
 *   - load() simulating an async fetch (with optional error injection)
 *   - render() returning a template string
 *   - badge() returning a count
 *   - 4-state shell (loading / ok / empty / error) driven by the SDK
 *
 * Use `window.__kmSdkHelloFail = true` in DevTools to demo the error state.
 * The widget exposes its tag via the named export `SDK_HELLO_TAG`.
 */

import { defineWidget } from '../widget-sdk/defineWidget.js';

const CARD_CSS = /* css */`
  :host { display: block; height: 100%; }
  .card {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 4px;
    min-height: 0;
  }
  .big {
    font-size: 36px;
    font-weight: 700;
    letter-spacing: -0.04em;
    line-height: 1;
    color: var(--km-accent-hover);
    font-variant-numeric: tabular-nums;
  }
  .sub {
    font-size: 11px;
    color: var(--km-text-muted);
    font-family: var(--km-font-mono);
  }
  .row {
    display: flex;
    gap: 4px;
    margin-top: 4px;
  }
  .row button {
    background: none;
    border: 1px solid var(--km-alpha-15);
    color: var(--km-text-secondary);
    font: 500 10px/1 var(--km-font);
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
    transition: all 0.15s;
  }
  .row button:hover {
    border-color: var(--km-accent-border);
    color: var(--km-accent-hover);
    background: var(--km-accent-muted);
  }
`;

export const SDK_HELLO_TAG = defineWidget({
  id: 'sdk-hello',
  label: 'SDK Hello',
  icon: 'box',
  defaultW: 3,
  defaultH: 1,
  emptyMessage: 'No count yet',
  loadingMessage: 'Counting…',
  errorMessage: 'Couldn\'t count',

  setup({ setState }) {
    setState({ count: 0, tick: 0 });
  },

  async load({ setState, signal }) {
    await new Promise((r, j) => {
      const t = setTimeout(r, 600);
      signal?.addEventListener('abort', () => { clearTimeout(t); j(new DOMException('aborted','AbortError')); });
    });
    if (window.__kmSdkHelloFail) throw new Error('Demo failure (set window.__kmSdkHelloFail = false to clear)');
    return { count: 42, tick: Date.now() };
  },

  badge: ({ state }) => state.count ? `${state.count}` : '',

  onMount({ shell, setState, reload, state }) {
    // The body content lives in the shell's light DOM (slotted into the
    // shell's shadow root). So the click handler must attach to `shell`,
    // not `host`, for `e.target.closest('[data-act]')` to reach the buttons.
    shell.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'bump')   setState({ count: (state.count ?? 0) + 1 });
      if (act === 'reload') reload();
    });
  },

  render: ({ state }) => `
    <style>${CARD_CSS}</style>
    <div class="card">
      <div class="big">${state.count ?? '–'}</div>
      <div class="sub">${state.tick ? 'updated ' + new Date(state.tick).toLocaleTimeString() : 'awaiting data'}</div>
      <div class="row">
        <button id="sdk-bump" data-act="bump">Bump</button>
        <button id="sdk-reload" data-act="reload">Reload</button>
      </div>
    </div>
  `,
}).tag;
