/**
 * UI component barrel — imports and registers all Custom Elements.
 * Import this file once in main.js; all km-* elements then work globally.
 */

export { KmButton }       from './KmButton/KmButton.js';
export { KmCard }         from './KmCard/KmCard.js';
export { KmBadge }        from './KmBadge/KmBadge.js';
export { KmNotification } from './KmNotification/KmNotification.js';
export { KmTooltip }      from './KmTooltip/KmTooltip.js';
export { KmIcon }         from './KmIcon/KmIcon.js';
export { KmSidebar }      from './KmSidebar/KmSidebar.js';
export { KmDialog }       from './KmDialog/KmDialog.js';
export { KmGhostLayer }      from './KmGhostLayer/KmGhostLayer.js';
export { KmCommandPalette }  from './KmCommandPalette/KmCommandPalette.js';
export { KmShortcutSheet }   from './KmShortcutSheet/KmShortcutSheet.js';

// Feature components (imported here so they register on first ui/index.js import)
export { KmNotesEditor }     from '../features/NotesEditor/NotesEditor.js';
export { KmComponentVault }  from '../features/ComponentVault/ComponentVault.js';
export { KmBoardRender }     from '../features/BoardRender/BoardRender.js';
export { KmNetInspector }    from '../features/NetInspector/NetInspector.js';
