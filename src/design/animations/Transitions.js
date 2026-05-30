/**
 * Page and panel transition system.
 * Uses native View Transitions API where available, falls back to opacity/y.
 * @module Transitions
 */

import { animate } from 'motion';

/** @returns {boolean} */
const supportsViewTransitions = () =>
  typeof document !== 'undefined' && 'startViewTransition' in document;

/**
 * Route transition: swap the view container content with animation.
 * @param {HTMLElement} container
 * @param {() => void | Promise<void>} updateFn - function that performs the DOM update
 * @returns {Promise<void>}
 */
export async function routeTransition(container, updateFn) {
  if (supportsViewTransitions()) {
    await document.startViewTransition(updateFn).finished;
    return;
  }
  await animate(container, { opacity: [1, 0], y: [0, -8] }, { duration: 0.12, easing: 'ease-in' }).finished;
  await updateFn();
  await animate(container, { opacity: [0, 1], y: [8, 0] }, { duration: 0.18, easing: 'ease-out' }).finished;
}

/**
 * Panel slide open (right-side panels, bottom drawers, etc.).
 * @param {HTMLElement} panel
 * @param {'right'|'left'|'bottom'} from
 */
export async function panelOpen(panel, from = 'right') {
  panel.style.display = 'flex';
  const axis = from === 'bottom' ? 'y' : 'x';
  const origin = from === 'right' ? panel.offsetWidth : from === 'left' ? -panel.offsetWidth : panel.offsetHeight;
  await animate(
    panel,
    { opacity: [0, 1], [axis]: [origin, 0] },
    { duration: 0.28, easing: [0.34, 1.56, 0.64, 1] }
  ).finished;
}

/**
 * Panel slide close.
 * @param {HTMLElement} panel
 * @param {'right'|'left'|'bottom'} to
 * @returns {Promise<void>}
 */
export async function panelClose(panel, to = 'right') {
  const axis = to === 'bottom' ? 'y' : 'x';
  const target = to === 'right' ? panel.offsetWidth : to === 'left' ? -panel.offsetWidth : panel.offsetHeight;
  await animate(
    panel,
    { opacity: [1, 0], [axis]: [0, target] },
    { duration: 0.2, easing: 'ease-in' }
  ).finished;
  panel.style.display = 'none';
}

/**
 * Sidebar collapse/expand.
 * @param {HTMLElement} sidebar
 * @param {boolean} collapsed
 */
export function sidebarToggle(sidebar, collapsed) {
  const targetWidth = collapsed
    ? getComputedStyle(document.documentElement).getPropertyValue('--km-sidebar-collapsed').trim()
    : getComputedStyle(document.documentElement).getPropertyValue('--km-sidebar-width').trim();

  animate(sidebar, { width: targetWidth }, {
    duration: 0.22,
    easing: [0.4, 0, 0.2, 1],
  });
}

/**
 * CSS view-transition keyframes injection (call once at app init).
 */
export function injectViewTransitionStyles() {
  if (document.getElementById('km-vt-styles')) return;
  const style = document.createElement('style');
  style.id = 'km-vt-styles';
  style.textContent = `
    @keyframes km-vt-slide-out {
      to { opacity: 0; transform: translateY(-6px); }
    }
    @keyframes km-vt-slide-in {
      from { opacity: 0; transform: translateY(6px); }
    }
    ::view-transition-old(root) {
      animation: 120ms var(--km-ease-in) both km-vt-slide-out;
    }
    ::view-transition-new(root) {
      animation: 180ms var(--km-ease-out) both km-vt-slide-in;
    }
  `;
  document.head.appendChild(style);
}
