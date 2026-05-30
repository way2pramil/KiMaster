/**
 * KiMaster SPA Router — hash-based routing with View Transition support.
 * Minimal, no dependencies.
 *
 * Usage:
 *   import { Router } from './Router.js';
 *   Router.on('/', () => renderDashboard());
 *   Router.on('/drc', () => renderDrc());
 *   Router.start();
 *
 * @module Router
 */

import { store } from './State.js';
import { AnimationKit } from '../design/animations/index.js';

/** @type {Map<string, () => void | Promise<void>>} */
const _routes = new Map();

/** @type {HTMLElement|null} */
let _container = null;

/** @type {string} */
let _notFoundRoute = '/';

export const Router = {
  /**
   * Register a route handler.
   * @param {string} path
   * @param {() => void | Promise<void>} handler
   */
  on(path, handler) {
    _routes.set(path, handler);
    return Router;
  },

  /**
   * Set the container element for view transitions.
   * @param {HTMLElement} el
   */
  setContainer(el) {
    _container = el;
    return Router;
  },

  /**
   * Set the fallback route for unknown paths.
   * @param {string} path
   */
  notFound(path) {
    _notFoundRoute = path;
    return Router;
  },

  /** Initialize and start listening to hash changes. */
  start() {
    window.addEventListener('hashchange', Router._resolve);
    Router._resolve();
    return Router;
  },

  stop() {
    window.removeEventListener('hashchange', Router._resolve);
  },

  /**
   * Navigate to a route programmatically.
   * @param {string} path
   */
  navigate(path) {
    window.location.hash = path;
  },

  /** @returns {string} current route path */
  get current() {
    return window.location.hash.slice(1) || '/';
  },

  _resolve() {
    const path = Router.current;
    const handler = _routes.get(path) ?? _routes.get(_notFoundRoute);

    store.activeRoute = path;

    const sidebar = document.getElementById('main-sidebar');
    if (sidebar) sidebar.setAttribute('active-route', path);

    if (!handler) return;

    if (_container) {
      AnimationKit.routeTransition(_container, async () => {
        _container.innerHTML = '';
        await handler();
      });
    } else {
      handler();
    }
  },
};
