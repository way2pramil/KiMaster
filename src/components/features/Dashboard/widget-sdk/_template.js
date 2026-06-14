/**
 * @module Dashboard/widget-sdk/_template
 * @summary Copy-paste starter for a new widget built on the SDK.
 *
 * How to use:
 *   1. Duplicate this file as `widgets/WidgetMyThing.js`.
 *   2. Edit the config object — id, label, icon, default size, render body.
 *   3. Import it from `Dashboard.js` to register the tag.
 *   4. Add the id to the `WIDGETS` registry (Dashboard.js line ~45).
 *
 * The exported `tag` constant is what Dashboard.js imports. The custom
 * element is auto-defined on import.
 *
 * Lifecycle overview (see `defineWidget.js` for the contract):
 *   - setup(ctx)      — sync, runs on connect. Subscribe to the store here.
 *   - load(ctx)       — async, returns the initial state patch. The signal
 *                       fires on disconnect; check it before slow awaits.
 *   - render(ctx)     — string or DOM node. Re-runs on every setState().
 *   - onMount(ctx)    — runs once after first mount; attach listeners here.
 *   - onUnmount(ctx)  — runs before disconnect; tear down manual listeners.
 *   - badge(ctx)      — return a small string (count, status) or '' to hide.
 *   - isEmpty(state)  — return true to show the empty state. Default: any
 *                       non-internal non-null/non-empty key counts as content.
 *
 * @example Minimal widget
 *   import { defineWidget } from '../widget-sdk/defineWidget.js';
 *   export const MY_THING_TAG = defineWidget({
 *     id: 'my-thing',
 *     label: 'My thing',
 *     icon: 'box',
 *     defaultW: 3, defaultH: 1,
 *     setup: ({ setState }) => setState({ items: [] }),
 *     load:  async ({ setState, signal }) => {
 *       const items = await fetchMyThings({ signal });
 *       setState({ items });
 *     },
 *     render: ({ state }) => `<div>${state.items?.length ?? 0} things</div>`,
 *   });
 */

import { defineWidget } from './defineWidget.js';

const CARD_CSS = /* css */`
  :host { display: block; height: 100%; }
  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 12px;
    min-height: 0;
  }
  .big {
    font-size: 28px;
    font-weight: 700;
    line-height: 1;
    color: var(--km-accent-hover);
    font-variant-numeric: tabular-nums;
  }
  .sub {
    font-size: 11px;
    color: var(--km-text-muted);
    font-family: var(--km-font-mono);
  }
`;

/**
 * @returns {{ tag: string, ctor: typeof HTMLElement, cfg: object }}
 */
export const MY_THING_TAG = defineWidget({
  id: 'my-thing',
  label: 'My thing',
  icon: 'box',
  defaultW: 3,
  defaultH: 1,
  emptyMessage: 'Nothing here yet',
  loadingMessage: 'Loading…',
  errorMessage: 'Could not load',

  setup({ setState }) {
    setState({ count: 0 });
  },

  async load({ setState, signal }) {
    // Replace with a real fetch. Honour `signal` so reloads/disconnects abort.
    await new Promise((r, j) => {
      const t = setTimeout(r, 400);
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        j(new DOMException('aborted', 'AbortError'));
      });
    });
    setState({ count: 42 });
  },

  render({ state }) {
    return /* html */`
      <style>${CARD_CSS}</style>
      <div class="body">
        <div class="big">${state.count ?? 0}</div>
        <div class="sub">things</div>
      </div>
    `;
  },

  badge({ state }) {
    return state.count ? String(state.count) : '';
  },
});
