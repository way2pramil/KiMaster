import { Application, Container } from 'pixi.js';
import { Viewport }         from 'pixi-viewport';
import { EDARenderer }      from '../render/EDARenderer.js';
import { SpatialLayer }     from '../selection/SpatialLayer.js';
import { SelectionManager } from '../selection/SelectionManager.js';
import { MarqueeOverlay }   from '../selection/MarqueeOverlay.js';
import { ControlPoints }    from '../selection/ControlPoints.js';
import { HoverOverlay }     from '../selection/HoverOverlay.js';
import { Grid }             from './Grid.js';
import { ViewportHelper }   from './Viewport.js';
import { UndoManager }      from './UndoManager.js';
import { SelectTool }       from '../tools/SelectTool.js';
import { MarqueeTool }      from '../tools/MarqueeTool.js';
import { PanTool }          from '../tools/PanTool.js';
import { installFont }            from '../render/TextRenderer.js';
import { applyTessellationFix }   from '../render/TessellationFix.js';
import { store, subscribe } from '../../../core/State.js';

const _instances = new Map();

export class CanvasCore {
  #type;

  #app        = null;
  #vp         = null;
  #scene      = null;
  #renderer   = null;
  #spatial    = null;
  #selection  = null;
  #marquee    = null;
  #grid       = null;
  #vpHelper   = null;
  #controlPoints = null;
  #hover      = null;
  #undo       = null;
  #activeTool = null;
  #container  = null;
  #ro         = null;
  #initPromise = null;
  #initError   = null;
  #unsubs     = [];

  constructor(type) {
    this.#type = type;
  }

  static get(type) {
    if (!_instances.has(type)) _instances.set(type, new CanvasCore(type));
    return _instances.get(type);
  }

  async mount(container) {
    if (!this.#initPromise) this.#initPromise = this._init(container);

    try {
      await this.#initPromise;
    } catch (err) {
      this.#initError = err;
      this.#initPromise = null;
      this._showErrorFallback(container, err);
      throw err;
    }

    if (this.#container !== container) {
      container.appendChild(this.#app.canvas);
      this.#container = container;
      this._resize();
      this.#ro?.disconnect();
      this.#ro = new ResizeObserver(() => this._resize());
      this.#ro.observe(container);
    }

    this.resume();
    this._bindKeyboard();
    return this;
  }

  unmount() {
    this.suspend();
    this._unbindKeyboard();
    this.#app?.canvas?.remove();
    this.#ro?.disconnect();
    this.#container = null;
  }

  async reload(container) {
    this.unmount();
    this.#initPromise = null;
    this.#initError   = null;
    return this.mount(container ?? this.#container);
  }

  resume()  { this.#app?.ticker?.start(); }
  suspend() { this.#app?.ticker?.stop();  }

  get isErrored() { return this.#initError !== null; }
  get lastError() { return this.#initError; }

  load(elements) {
    if (this.#initError) return;
    if (!Array.isArray(elements)) {
      console.warn('[CanvasCore] load() called with non-array:', typeof elements);
      return;
    }
    const valid = elements.filter(el => el && typeof el.id === 'string' && typeof el.x === 'number');
    if (valid.length !== elements.length) {
      console.warn(`[CanvasCore] filtered ${elements.length - valid.length} invalid elements`);
    }
    store.canvasElements = valid;
    this.#renderer?.load(valid);
    this.#spatial?.load(valid);
    this.#undo?.clear();
    this.#selection?.clear();
    this.#controlPoints?.hide();
    if (valid.length) this.#vpHelper?.fitElements(valid);
  }

  setTool(id) {
    const tools = { select: SelectTool, marquee: MarqueeTool, pan: PanTool };
    const Cls   = tools[id];
    if (!Cls) return;
    this.#activeTool?.onDeactivate();
    const ctx = this._makeCtx();
    this.#activeTool = new Cls(ctx);
    this.#activeTool.onActivate();
  }

  get renderer()     { return this.#renderer; }
  get spatial()      { return this.#spatial;  }
  get selection()    { return this.#selection; }
  get viewport()     { return this.#vp; }
  get vpHelper()     { return this.#vpHelper; }
  get grid()         { return this.#grid; }
  get controlPoints() { return this.#controlPoints; }
  get hover()        { return this.#hover; }
  get undo()         { return this.#undo; }

  async _init(container) {
    const app = new Application();
    await app.init({
      background:   0x0f0f0f,
      width:        container.clientWidth  || 800,
      height:       container.clientHeight || 600,
      preference:   'webgl',
      antialias:    true,
      autoDensity:  true,
      resolution:   Math.min(window.devicePixelRatio || 1, 2),
    });
    app.canvas.style.display = 'block';
    app.canvas.style.width   = '100%';
    app.canvas.style.height  = '100%';
    container.appendChild(app.canvas);
    this.#container = container;

    const vp = new Viewport({
      screenWidth:  container.clientWidth,
      screenHeight: container.clientHeight,
      events:       app.renderer.events,
    });
    vp.drag({ mouseButtons: 'middle' })
      .wheel({ wheelZoom: true, percent: 0.08, smooth: 3 })
      .pinch()
      .clampZoom({ minScale: 0.02, maxScale: 5000 });
    app.stage.addChild(vp);

    const scene = new Container();
    scene.sortableChildren = true;
    vp.addChild(scene);

    installFont();
    applyTessellationFix();

    this.#app          = app;
    this.#vp           = vp;
    this.#scene        = scene;
    this.#vpHelper     = new ViewportHelper(vp);
    this.#renderer     = new EDARenderer(scene, store.canvasVisibleLayers);
    this.#spatial      = new SpatialLayer(scene);
    this.#selection    = new SelectionManager(this.#spatial);
    this.#marquee      = new MarqueeOverlay(scene);
    this.#controlPoints = new ControlPoints(scene);
    this.#hover        = new HoverOverlay(scene);
    this.#grid         = new Grid(scene, vp);
    this.#undo         = new UndoManager();

    vp.on('zoomed', () => {
      this.#renderer.onZoomChange(vp.scaled);
      this.#spatial.cullToViewport(this.#vpHelper.worldBounds);
      this._refreshControlPoints();
    });
    vp.on('moved', () => {
      this.#spatial.cullToViewport(this.#vpHelper.worldBounds);
    });

    this.#unsubs.push(
      subscribe('canvasVisibleLayers', (layers) => this.#renderer.setVisibleLayers(layers)),
    );
    this.#unsubs.push(
      subscribe('canvasSelectedIds', (ids) => {
        this.#renderer?.syncSelection(ids);
        this._refreshControlPoints();
      }),
    );

    this.setTool('select');

    vp.on('pointerdown', (e) => this._dispatch('pointerdown', e));
    vp.on('pointermove', (e) => this._dispatch('pointermove', e));
    vp.on('pointerup',   (e) => this._dispatch('pointerup',   e));

    app.canvas.addEventListener('pointerleave', (e) => {
      this.#activeTool?.onPointerLeave(e);
    });

    app.canvas.addEventListener('dblclick', (e) => {
      const rect = app.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const world = vp.toWorld(sx, sy);
      const scale = vp.scaled;
      const newScale = scale * 2;
      vp.animate({ position: world, scale: newScale, time: 200 });
    });

    this._onKeyDown = this._handleKeyDown.bind(this);
  }

  _dispatch(type, e) {
    if (!this.#activeTool) return;
    const target = e.target?.label ? e.target : null;
    const ev = { global: e.global, data: e.originalEvent ?? e.nativeEvent ?? e, target };
    switch (type) {
      case 'pointerdown': this.#activeTool.onPointerDown(ev); break;
      case 'pointermove': this.#activeTool.onPointerMove(ev); break;
      case 'pointerup':   this.#activeTool.onPointerUp(ev);   break;
    }
  }

  _handleKeyDown(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
      return;
    }
    if (e.key === 'Home') {
      const els = store.canvasElements;
      if (els?.length) this.#vpHelper.fitElements(els);
    }
    if (e.key === '1' && !e.ctrlKey && !e.metaKey) {
      this.#vpHelper.resetZoom();
    }
    if (e.code === 'Space' && !e.repeat) {
      this.setTool('pan');
    }
    this.#activeTool?.onKeyDown(e);
  }

  _bindKeyboard() {
    this._onKeyUp = (e) => {
      if (e.code === 'Space') this.setTool('select');
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  _unbindKeyboard() {
    if (this._onKeyDown) { window.removeEventListener('keydown', this._onKeyDown); }
    if (this._onKeyUp)   { window.removeEventListener('keyup', this._onKeyUp); this._onKeyUp = null; }
  }

  _resize() {
    if (!this.#container || !this.#app) return;
    const w = this.#container.clientWidth;
    const h = this.#container.clientHeight;
    if (w < 1 || h < 1) return;
    this.#app.renderer.resize(w, h);
    this.#vp.resize(w, h);
  }

  _refreshControlPoints() {
    if (!this.#controlPoints) return;
    const ids = store.canvasSelectedIds;
    if (ids.size === 0) {
      this.#controlPoints.hide();
      return;
    }
    const scale = this.#vp.scaled;
    if (ids.size === 1) {
      const id  = ids.values().next().value;
      const rec = this.#spatial?.get(id);
      if (rec) { this.#controlPoints.showForElement(rec.element, scale); return; }
    }
    const bounds = this.#spatial?.selectionBounds(ids);
    if (bounds) this.#controlPoints.showBBoxForMulti(bounds, scale);
    else this.#controlPoints.hide();
  }

  _showErrorFallback(container, err) {
    const msg = document.createElement('div');
    msg.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:#ff6b6b;font-family:system-ui;flex-direction:column;gap:8px;';
    msg.innerHTML = `
      <div style="font-size:14px;font-weight:600;">Canvas failed to initialize</div>
      <div style="font-size:12px;opacity:0.7;">${err.message || 'Unknown error'}</div>
      <button style="margin-top:8px;padding:6px 16px;border:1px solid #555;border-radius:4px;background:#222;color:#ccc;cursor:pointer;font-size:12px;">Retry</button>
    `;
    msg.querySelector('button').onclick = () => {
      msg.remove();
      this.reload(container).catch(() => {});
    };
    container.appendChild(msg);
  }

  _makeCtx() {
    return {
      viewport:     this.#vp,
      vpHelper:     this.#vpHelper,
      spatial:      this.#spatial,
      selection:    this.#selection,
      marquee:      this.#marquee,
      renderer:     this.#renderer,
      controlPoints: this.#controlPoints,
      hover:         this.#hover,
      grid:         this.#grid,
      undo:         this.#undo,
    };
  }
}
