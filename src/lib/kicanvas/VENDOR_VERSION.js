/**
 * Pinned KiCanvas vendor build info — update this whenever vendor/kicanvas.js
 * is replaced, and re-run the upgrade checklist below.
 *
 * UPGRADE CHECKLIST (run after replacing vendor/kicanvas.js):
 *   1. Confirm `kicanvas-embed` still exposes a `.viewer` getter.
 *   2. Confirm `viewer.camera` still exposes:
 *        - `.matrix`            (read-only transform snapshot)
 *        - `.world_to_screen(point)` / `.screen_to_world(point)`
 *        - `.zoom`, `.bbox`, `.viewport_size`
 *      → grep the new bundle for these symbol names; if any are gone/renamed,
 *        update KiCanvasAdapter._readCamera() accordingly.
 *   3. Confirm `kicanvas:load` event still fires on the embed element.
 *   4. Re-run the PCB Layout tab and verify LiveOverlay tracks pan/zoom 1:1.
 *      If it drifts or fails `isReady()`, the OpsOverlay (SVG minimap)
 *      fallback takes over automatically — verify that path too.
 *
 * KiCanvasAdapter.js reads ONLY public, documented-by-usage properties of the
 * upstream bundle — it does not monkeypatch or modify vendor/kicanvas.js in
 * any way. This file exists purely so upgrades have a checklist instead of a
 * diff to re-apply.
 */
export const KICANVAS_VENDOR_NOTE =
  'Bundled KiCanvas build — see UPGRADE CHECKLIST in this file before replacing.';
