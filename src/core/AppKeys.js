/**
 * AppKeys — single source of truth for ALL localStorage / storage key strings.
 *
 * Rules:
 *  - Never write a raw localStorage key string in feature code.
 *  - Import from here so key renames propagate automatically.
 *
 * @module AppKeys
 */

/** Active UI theme: 'dark' | 'light' */
export const THEME    = 'km-theme';

/** UI density: 'compact' | 'cozy' | 'comfortable' */
export const DENSITY  = 'km-density';

/** Serialised settings object (JSON) */
export const SETTINGS = 'km-settings';

/** Serialised export profiles array (JSON) */
export const EXPORT_PROFILES = 'km-export-profiles';

/** Dashboard widget layout (v3 shape — array of {id,w,h}; owned by LayoutStore) */
export const DASHBOARD_LAYOUT  = 'km-dash-layout-v3';

/** Dashboard widget ids that the user has hidden (array of strings) */
export const DASHBOARD_HIDDEN  = 'km-dash-hidden';
