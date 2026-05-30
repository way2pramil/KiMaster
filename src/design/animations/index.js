/**
 * AnimationKit — centralized animation API for KiMaster.
 * Import this singleton anywhere; never import Micro or Transitions directly
 * from feature code — always go through AnimationKit.
 */

import * as Micro from './Micro.js';
import * as Transitions from './Transitions.js';

export const AnimationKit = {
  // Micro interactions
  buttonPress:        Micro.buttonPress,
  hoverLift:          Micro.hoverLift,
  hoverLiftReset:     Micro.hoverLiftReset,
  fadeIn:             Micro.fadeIn,
  fadeOut:            Micro.fadeOut,
  scaleIn:            Micro.scaleIn,
  slideIn:            Micro.slideIn,
  notificationEnter:  Micro.notificationEnter,
  notificationExit:   Micro.notificationExit,
  ripple:             Micro.ripple,
  spin:               Micro.spin,
  pulse:              Micro.pulse,
  shake:              Micro.shake,

  // Page & panel transitions
  routeTransition:          Transitions.routeTransition,
  panelOpen:                Transitions.panelOpen,
  panelClose:               Transitions.panelClose,
  sidebarToggle:            Transitions.sidebarToggle,
  injectViewTransitionStyles: Transitions.injectViewTransitionStyles,
};

export default AnimationKit;
