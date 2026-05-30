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

/** Serialised settings object (JSON) */
export const SETTINGS = 'km-settings';
