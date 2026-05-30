/**
 * Micro-animations — small, GPU-accelerated interactions.
 * All durations reference CSS tokens via getComputedStyle.
 * @module Micro
 */

import { animate, spring } from 'motion';

/** @type {WeakMap<Element, () => void>} cleanup callbacks keyed by element */
const _cleanups = new WeakMap();

/**
 * Reads a CSS --km-duration-* token value in seconds.
 * @param {'fast'|'base'|'slow'|'xl'} name
 * @returns {number}
 */
function tokenDuration(name) {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(`--km-duration-${name}`)
    .trim();
  return raw.endsWith('ms') ? parseFloat(raw) / 1000 : parseFloat(raw);
}

/**
 * Button press feedback — quick scale bounce.
 * @param {HTMLElement} el
 */
export function buttonPress(el) {
  animate(el, { scale: [1, 0.94, 1] }, {
    duration: tokenDuration('fast'),
    easing: [0.34, 1.56, 0.64, 1],
  });
}

/**
 * Hover lift effect — slight translateY up.
 * @param {HTMLElement} el
 * @param {number} [px=2]
 */
export function hoverLift(el, px = 2) {
  animate(el, { y: -px, boxShadow: 'var(--km-shadow-md)' }, {
    duration: tokenDuration('base'),
    easing: 'ease-out',
  });
}

/**
 * Reverse hover lift.
 * @param {HTMLElement} el
 */
export function hoverLiftReset(el) {
  animate(el, { y: 0, boxShadow: 'var(--km-shadow-sm)' }, {
    duration: tokenDuration('fast'),
    easing: 'ease-in',
  });
}

/**
 * Fade in an element from opacity 0.
 * @param {HTMLElement} el
 * @param {{ delay?: number, duration?: number }} [opts]
 */
export function fadeIn(el, opts = {}) {
  const { delay = 0, duration = tokenDuration('base') } = opts;
  el.style.opacity = '0';
  animate(el, { opacity: [0, 1] }, { duration, delay, easing: 'ease-out' });
}

/**
 * Fade out and optionally remove the element.
 * @param {HTMLElement} el
 * @param {{ remove?: boolean }} [opts]
 */
export function fadeOut(el, opts = {}) {
  const duration = tokenDuration('fast');
  animate(el, { opacity: [1, 0] }, { duration, easing: 'ease-in' }).finished.then(() => {
    if (opts.remove) el.remove();
  });
}

/**
 * Scale-up entrance (used for cards, dialogs, dropdowns).
 * @param {HTMLElement} el
 * @param {{ delay?: number }} [opts]
 */
export function scaleIn(el, opts = {}) {
  const { delay = 0 } = opts;
  animate(
    el,
    { opacity: [0, 1], scale: [0.92, 1], y: [8, 0] },
    {
      duration: tokenDuration('slow'),
      delay,
      easing: [0.34, 1.56, 0.64, 1],
    }
  );
}

/**
 * Slide in from a direction.
 * @param {HTMLElement} el
 * @param {'left'|'right'|'top'|'bottom'} direction
 * @param {{ distance?: number, duration?: number, delay?: number }} [opts]
 */
export function slideIn(el, direction = 'bottom', opts = {}) {
  const { distance = 16, duration = tokenDuration('slow'), delay = 0 } = opts;
  const axis = direction === 'left' || direction === 'right' ? 'x' : 'y';
  const sign = direction === 'right' || direction === 'bottom' ? 1 : -1;
  animate(
    el,
    { opacity: [0, 1], [axis]: [distance * sign, 0] },
    { duration, delay, easing: [0.34, 1.56, 0.64, 1] }
  );
}

/**
 * Notification enter animation (slide + fade from right).
 * @param {HTMLElement} el
 */
export function notificationEnter(el) {
  animate(
    el,
    { opacity: [0, 1], x: [320, 0], scale: [0.95, 1] },
    { duration: tokenDuration('slow'), easing: [0.34, 1.56, 0.64, 1] }
  );
}

/**
 * Notification exit animation.
 * @param {HTMLElement} el
 * @returns {Promise<void>}
 */
export function notificationExit(el) {
  return animate(
    el,
    { opacity: [1, 0], x: [0, 320], scale: [1, 0.95] },
    { duration: tokenDuration('base'), easing: 'ease-in' }
  ).finished;
}

/**
 * Ripple effect originating from a pointer event.
 * @param {HTMLElement} container
 * @param {PointerEvent} event
 */
export function ripple(container, event) {
  const rect = container.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const size = Math.max(rect.width, rect.height) * 2;

  const rippleEl = document.createElement('span');
  Object.assign(rippleEl.style, {
    position: 'absolute',
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.18)',
    width: `${size}px`,
    height: `${size}px`,
    left: `${x - size / 2}px`,
    top: `${y - size / 2}px`,
    pointerEvents: 'none',
    transform: 'scale(0)',
  });

  container.style.position = container.style.position || 'relative';
  container.style.overflow = 'hidden';
  container.appendChild(rippleEl);

  animate(rippleEl, { scale: [0, 1], opacity: [0.6, 0] }, {
    duration: 0.5,
    easing: 'ease-out',
  }).finished.then(() => rippleEl.remove());
}

/**
 * Spinner rotation — attaches continuous rotation to an element.
 * Returns a cancel function.
 * @param {HTMLElement} el
 * @returns {() => void}
 */
export function spin(el) {
  const anim = animate(el, { rotate: 360 }, { duration: 0.8, repeat: Infinity, easing: 'linear' });
  return () => anim.stop();
}

/**
 * Pulse attention animation (used for badges, indicators).
 * @param {HTMLElement} el
 */
export function pulse(el) {
  animate(el, { scale: [1, 1.15, 1] }, {
    duration: tokenDuration('slow'),
    repeat: 2,
    easing: 'ease-in-out',
  });
}

/**
 * Shake for error feedback.
 * @param {HTMLElement} el
 */
export function shake(el) {
  animate(el, { x: [0, -8, 8, -6, 6, -3, 3, 0] }, {
    duration: 0.4,
    easing: 'ease-in-out',
  });
}
