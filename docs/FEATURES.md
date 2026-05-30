# KiMaster — Feature Tracker (Single Source of Truth)

> All planned and completed features are listed here.
> No feature exists in the codebase unless it appears here first.
> Status: ✅ Done | 🚧 In Progress | ⬜ Planned | ❌ Blocked
>
> **Last updated:** 2026-05-28 (after Phase 12 QA5 Orphan Via Prune)
>
> **Design principles:** Local-first. No cloud. No accounts. Works offline forever.
> Features are powered by three layers:
> - **CLI layer** — `kicad-cli` headless subprocess (no KiCad GUI needed)
> - **IPC layer** — KiCad 9/10 native Protocol Buffers IPC API via `kicad-python` package ⬜ PENDING migration
> - **Bridge layer** — Python WebSocket bridge plugin querying running KiCad GUI (current transitional approach)
> - **Pure Rust/JS** — File parsing, analysis, UI, CRDT, SQLite (no KiCad dependency)
>
> **⚠️ KiCad 9.0 Technical Pivot (2026):**
> Traditional SWIG/pcbnew Python bindings are deprecated in KiCad 9.0+.
> The bridge layer must use KiCad's native IPC API (Protocol Buffers over Unix Domain Sockets on Linux/macOS, Named Pipes on Windows).
> The `kicad-python` package provides official bindings.
> **Current status:** WS bridge (Phase 3) is working. IPC migration is Phase 10.
>
> **UI Architecture (Skeuomorphic Minimalism / Linear-Style):**
> - OLED black (`#000000`) for sidebars and frames
> - Tiered grays `#0A0A0A → #161616` for workspace surfaces
> - Cobalt Blue `#2563EB` for primary actions; Safety Cyan `#06B6D4` for live telemetry; Trace Green `#10B981` for PCB elements
> - 1px edge-lit borders `rgba(255,255,255,0.07)` + inner bezel sheen `inset 0 1px 0 0 rgba(255,255,255,0.04)`
> - Geist / Inter Variable fonts — NO uppercase decorative headings
> - `font-variant-numeric: tabular-nums` on ALL numeric/metric data
> - Bento grid architecture: `gap: 12px`, `border-radius: 6px`
> - Compression interactions: `transform: scale(0.98)`, `cubic-bezier(0.2, 0.8, 0.2, 1) 120ms`
> - **Zero inline styles** — all visual properties in `--km-*` tokens

---

## Phase 1 — Foundation ✅ COMPLETE

| Feature | Status | Notes |
|---------|--------|-------|
| Tauri 2 + Vite + Vanilla JS scaffold | ✅ | `package.json`, `vite.config.js`, `tauri.conf.json` |
| 100x canonical folder structure | ✅ | Core/Modules/Extensions/IPC separation |
| CSS token architecture (single root) | ✅ | `src/design/tokens.css` — one accent = full repaint |
| Light/dark theme support | ✅ | `[data-theme]` attribute, tokens.css overrides |
| CSS reset + typography system | ✅ | `reset.css`, `typography.css` |
| Motion One animation library | ✅ | `src/design/animations/` — Micro, Transitions, AnimationKit |
| 10 UI Web Components | ✅ | KmButton, KmCard, KmBadge, KmNotification, KmTooltip, KmIcon, KmSidebar, **KmDialog**, **KmGhostLayer**, **KmCommandPalette** |
| Proxy-based reactive state store | ✅ | `src/core/State.js` |
| Batched Tauri IPC layer | ✅ | `src/core/Ipc.js` — rAF queue |
| Centralized constants (Rule 2) | ✅ | `AppCommands.js`, `AppEvents.js`, `AppKeys.js` |
| Centralized Logger (Rule 3) | ✅ | `src/core/Logger.js` — no silent catches anywhere |
| SPA Router with View Transitions | ✅ | `src/core/Router.js` |
| App bootstrap + layout shell | ✅ | `src/main.js`, `index.html` |
| Rust backend skeleton | ✅ | AppConfig, AppState, module stubs, 40+ IPC commands |
| Python bridge plugin scaffold | ✅ | KiMasterPlugin, WsServer, BoardExporter, ProbeKiCadApi |

---

## Phase 2 — KiCad CLI Integration ✅ COMPLETE

| Feature | Status | Notes |
|---------|--------|-------|
| Cross-platform kicad-cli discovery | ✅ | `CliRunner.rs` — state → env → filesystem discovery |
| DRC runner + JSON parser | ✅ | `DrcParser.rs` + `CliRunner::run_drc()` |
| ERC runner + JSON parser | ✅ | `ErcParser.rs` + `CliRunner::run_erc()` |
| Gerber export command | ✅ | layers, X2, precision, netlist, drill origin |
| Drill export command | ✅ | Excellon/Gerber, PTH/NPTH split, map files |
| Position file export | ✅ | CSV/ASCII/Gerber, front/back/both, DNP exclude |
| SVG / PDF / BOM / Schematic exports | ✅ | 8 export types total with typed option structs |
| One-click fab pack | ✅ | `cmd_export_fab_pack` — timestamped dir, gerbers+drill+(BOM+pos for assembly) |
| `DrcPanel` feature component | ✅ | DRC/ERC/Mfg tabs, severity filters, violation list, manufacturing readiness |
| `ExportWizard` feature component | ✅ | 8 export cards + "One-click Fab Pack" button |
| Auto-DRC on save | ✅ | File watcher → 1s debounce → DRC → sidebar badge + toast |
| Mock IPC for browser dev | ✅ | All 40+ commands have mock responses |

---

## Phase 3 — Python Bridge (Live KiCad Sync) ✅ COMPLETE

| Feature | Status | Notes |
|---------|--------|-------|
| KiMaster ActionPlugin — proper pcbnew subclass | ✅ | Dynamic subclass, toolbar button, metadata |
| WebSocket server in Python (KiCad env) | ✅ | `WsServer.py` — asyncio, background thread, ping/pong |
| Full read protocol | ✅ | hello/hello_ack, get_board_state, highlight_component/net, clear_highlight |
| **Write protocol (Phase 5)** | ✅ | move_component, rotate_component, set_locked, set_dnp |
| Board state serializer | ✅ | Components, nets, layers, board size, design rules |
| SelectionWatcher | ✅ | `SelectionWatcher.py` — polls IsSelected(), broadcasts selection_changed |
| Rust tokio-tungstenite WS client | ✅ | `modules/bridge/WsClient.rs` — async, reconnect, Tauri event emit |
| 15 bridge IPC commands | ✅ | connect, disconnect, highlight, move, rotate, lock, dnp, install, etc. |
| Auto-install plugin to KiCad | ✅ | `cmd_install_bridge_plugin` |
| Frontend BridgeClient.js | ✅ | Typed wrappers for all bridge commands + AppCommands constants |
| Live stats + board design rules | ✅ | Bridge panel: 4 stat tiles + board stats strip |
| pcbnew API probe script | ✅ | `ProbeKiCadApi.py` — anti-hallucination before API calls |

---

## Phase 4 — Project Storage & File Watching ✅ COMPLETE

| Feature | Status | Notes |
|---------|--------|-------|
| .kimaster project directory provisioning | ✅ | Created alongside `.kicad_pro` on first open |
| SQLite schema v1 (recent projects) | ✅ | `ProjectStore.rs`, `PRAGMA user_version` migration |
| File watcher for .kicad_* changes | ✅ | `FileWatcher.rs` — `notify` crate, fires on write-close |
| Project open/close IPC commands | ✅ | 5 commands: open, close, get_state, get_recent, pick_and_open |
| Native OS file picker | ✅ | `rfd` crate, `cmd_pick_and_open_project` |
| Dashboard project-aware modes | ✅ | "No project" CTA vs. project bento with file chips |
| `ProjectService.js` Tauri event listeners | ✅ | PROJECT_OPENED/CLOSED/FILE_CHANGED events |
| Project settings persistence | 🚧 | localStorage for now; SQLite migration pending |
| Recent projects UI panel | ⬜ | SQLite stores them; browser panel not yet built |

---

## Phase 4B — KiCad IPC API Migration ⬜ PENDING (Phase 10)

> Migrate bridge from WebSocket+pcbnew to official Protocol Buffers IPC API.
> **Blocked by:** kicad-python package integration complexity + proto file acquisition.

| Feature | Status | Notes |
|---------|--------|-------|
| `kicad-python` package integration | ⬜ | Official PB bindings via Unix socket / named pipe |
| Rust Protobuf client | ⬜ | Replace tokio-tungstenite WS with IPC socket client |
| Live cross-probe via IPC | ⬜ | KiMaster selection → KiCad highlight without file locks |
| IPC-based board state streaming | ⬜ | Event-driven via KiCad IPC events (no polling) |
| Fallback compatibility layer | ⬜ | Graceful degradation to WS bridge for KiCad 8.x |

---

## Phase 5 — Ghost Layer & Component Operations ✅ COMPLETE

| Feature | Status | Notes |
|---------|--------|-------|
| `KmGhostLayer` SVG canvas | ✅ | Board outline + component dots, fit-to-bounds, click-to-select |
| Ghost preview overlay | ✅ | Dashed pulsing circle at proposed position |
| Multi-select bounding box | ✅ | Dashed bbox + "N selected" label around selection group |
| `KmDialog` modal component | ✅ | Focus trap, Escape, backdrop dismiss, body+footer slots |
| Human-in-the-loop protocol | ✅ | Every board write requires KmDialog confirmation |
| Move footprint (single) | ✅ | Position dialog → ghost preview → confirm → apply |
| Rotate footprint (single) | ✅ | Angle input → confirm → apply |
| Lock / unlock (single + batch) | ✅ | KmDialog confirm, batch via ComponentBrowser |
| DNP set/clear (single + batch) | ✅ | KmDialog confirm with danger button for set |
| `ComponentBrowser` feature | ✅ | Search, filter, sort, action buttons, multi-select |
| Multi-select batch operations | ✅ | Checkbox col, shift+click, Ctrl+A, floating batch bar |
| Undo/redo (journal.db) | ⬜ | CRDT operation log not yet implemented |
| CRDT in-memory engine | ⬜ | yrs not yet integrated |

---

## Phase 6 — Command Palette & Board Analysis ✅ COMPLETE

| Feature | Status | Notes |
|---------|--------|-------|
| `KmCommandPalette` (Ctrl+K) | ✅ | Fuzzy search: routes + contextual actions + live components |
| Net Browser tab | ✅ | In ComponentBrowser — lists, searches, highlights nets |
| Board stats strip | ✅ | Bridge panel: dimensions + design rules (tabular-nums) |
| Board DRC badge on nav item | ✅ | `KmSidebar.setBadge('drc', n)` — live error count |
| Board statistics dashboard | 🚧 | F3 partial: 4 stat tiles + stats strip; full inspector pending |
| Net inspector (trace lengths, via counts) | ✅ | Full F1 inspector — see Phase 13 |

---

## Phase 7 — Git Revision Timeline ✅ COMPLETE

| Feature | Status | Notes |
|---------|--------|-------|
| Git availability detection | ✅ | `which::which("git")` + repo detection |
| Commit history for KiCad files | ✅ | `git log -- *.kicad_pcb/sch/pro`, filtered |
| `RevisionTimeline` component | ✅ | Split layout: commit list + DRC diff panel |
| DRC diff between commits | ✅ | `tokio::join!` — runs DRC on both; +new / -fixed / unchanged chips |
| File extraction at commit | ✅ | `git show hash:file` → NamedTempFile |
| Visual PCB diff (component positions) | ⬜ | Compare component positions between revisions |
| Net change highlighting per revision | ⬜ | Color-code deleted/added/renamed nets |

---

## Phase 8 — Manufacturing Readiness & Auto-Validation ✅ COMPLETE

| Feature | Status | Notes |
|---------|--------|-------|
| Auto-DRC on PCB save | ✅ | 1s debounce, delta toast (+N new / -N fixed) |
| Manufacturing Readiness tab | ✅ | DrcPanel Mfg tab: 4 fab presets, SVG score ring, check list |
| Fab rules registry | ✅ | `FabRules.js` — JLCPCB 2L/4L, OSHPark, PCBWay; `evaluatePreset()` |
| One-click fabrication pack | ✅ | `cmd_export_fab_pack` — timestamped dir, all required files |
| Sidebar DRC badge | ✅ | Live error count, removes at 0, caps at 99+ |
| Continuous lint panel | ⬜ | Floating violations badge — visual non-intrusive panel |
| Manufacturing risk detection | ⬜ | Acute angles, creepage violations, diff pair skew |
| ODB++ export | ⬜ | Via KiCad output jobsets (KiCad 9+) |

---

## Phase 9 — Alignment Tools & Architecture Hardening ✅ COMPLETE

| Feature | Status | Notes |
|---------|--------|-------|
| `AlignService.js` pure JS math | ✅ | alignL/R/Top/Bottom, centreH/V, distributeH/V, snapToGrid, boundingBox |
| Align dialog (3×3 grid) | ✅ | KmDialog with 9 alignment options including Snap 0.5mm |
| Distribute evenly H/V | ✅ | AlignService + batch confirm |
| Snap to grid | ✅ | Configurable grid size, 0.5mm default |
| Architecture hardening | ✅ | All Rule 2/3 violations fixed: `RUN_ERC` constant, inline style → CSS class |

---

## Phase 9B — Native Component Extraction & Unified Library Engine ✅ COMPLETE

> Bypasses Python performance constraints by building a native Rust compiler for multi-source library assets.
> Pulls from LCSC, EasyEDA, SnapEDA, and SamacSys API payloads.
> Refines, reformats, and sanitizes symbols/footprints locally before injecting them into KiCad
> via the project-local `.kimaster/library/` shared directory.

**Architecture**: zero Python — all parsing, generation, and S-expression emission happens in pure Rust.
HTTP fetch uses `reqwest`. Pipeline: `EasyEDA JSON → EdaParser → SanitizerRules → KiSym/KiModGenerator → LibraryVault`.

| Feature | Status | Notes |
|---------|--------|-------|
| Native EasyEDA/LCSC Parser (`EdaParser.rs`) | ✅ | Tilde-delimited symbol + footprint parser, coord conversion px→mm |
| Native `.kicad_sym` / `.kicad_mod` Generator | ✅ | `KiSymGenerator.rs` + `KiModGenerator.rs` — v20231120 S-expression text |
| Consolidated KiMaster Shared Vault | ✅ | `LibraryVault.rs` — `.kimaster/library/KiMaster.kicad_sym` + `KiMaster.pretty/` + `vault.db` SQLite index |
| Upstream Asset Fetcher Queue (`LcscClient.rs`) | ✅ | reqwest 0.12 async client, JLCPCB search + EasyEDA component fetch |
| Bulk Component Downloader Matrix | ✅ | ComponentVault "Bulk Import" tab: paste LCSC IDs → queue-add with progress bar |
| "Brand Sanitizer" Rule Engine | ✅ | `SanitizerRules.rs` — S1-S3 symbol rules + F1-F5 footprint rules (auto-courtyard, line-width normalisation, font clamping) |
| SnapEDA & SamacSys Multi-Bridge Client | ⬜ | Stub interface in place — extend `LcscClient` with new endpoints |
| Human-In-The-Loop Asset Inspector | 🚧 | `cmd_uce_preview_component` returns pin/pad counts — full ghost-layer preview pending |
| Sidebar nav + `/vault` route | ✅ | KmIcon `vault`, KmSidebar nav item, command palette entry |

## Phase 10 — Engineering Notes (KiNotes-style) ✅ COMPLETE

> Pure JS editor stored in `.kimaster/` — no bridge dependency for writing.
> Smart-links to components/nets require bridge for cross-probe.

| Feature | Status | Notes |
|---------|--------|-------|
| E1 Rich text notes editor | ✅ | Markdown textarea + rendered preview toggle, `notes.md` |
| E2 Smart-link designators | ✅ | `[R1]`, `[C5]` → highlight chip → `BRIDGE_HIGHLIGHT_COMPONENT` |
| E3 Smart-link nets | ✅ | `{GND}`, `{VCC}` → net chip → `BRIDGE_HIGHLIGHT_NET` |
| E5 Auto-save with crash recovery | ✅ | 800 ms debounce, save-dot indicator, `NotesService.scheduleAutoSave` |
| E6 Metadata insertion | ✅ | "⊕ metadata" toolbar button — board size, design rules, comp count, DRC errors |
| E7 Task/todo list | ✅ | Second tab in editor, `tasks.json`, add/toggle/delete, done counter |
| E10 PDF export of notes | ⬜ | Print-ready documentation (future) |

---

## Phase 11 — Visualization & Rendering 🚧 IN PROGRESS

| Feature | Status | Notes |
|---------|--------|-------|
| D1 3D static render | ✅ | `kicad-cli pcb render` — `BoardRender` component with single-view + 6-up parallel grid |
| D3 SVG layer export | ⬜ | CLI — already have export infrastructure, need layer selector UI |
| D5 Pinout diagram generator | ⬜ | CLI + Pure — annotated 2D docs with pin callouts |
| D6 Board-to-PDF with layer sets | ⬜ | Configurable PDF: layers, colours, paper size |
| D7 Visual PCB diff | ⬜ | Side-by-side render of two revisions |
| D8 Interactive board viewer | ⬜ | In-app 2D PCB canvas — parse KiCad file → SVG with zoom/pan |

---

## Phase 12 — Advanced Board Operations 🚧 IN PROGRESS

| Feature | Status | Notes |
|---------|--------|-------|
| A4 Rename nets | ⬜ | Regex find/replace across schematic + PCB |
| A5 Swap differential pairs | ⬜ | Swap P/N to fix routing |
| A6 Replace footprints | ⬜ | Swap 0402→0603 across board |
| A8 Regenerate copper zones | ✅ | `pcbnew.ZONE_FILLER` via bridge — KmDialog with layer/net filters + verify-fill option. Result returned via `bridge:op_result` → toast with zone count + elapsed ms. |
| A9 Cleanup board | 🚧 | **Orphan via prune ✅** (QA5) — dry-run first, review dialog with positions, danger-confirm destructive purge. Dangling traces + short tracks still pending. |
| A10 Flip components | ⬜ | Front↔back copper layer |
| A11 Set component properties | ⬜ | Batch edit value, reference, custom fields |
| B1-B3 Manufacturing variants | ⬜ | Variant matrix: DNP per variant, variant BOM/pos |
| B4-B6 Panelization prep | ⬜ | Grid layout, tab/V-cut, fiducials |
| G1 Teardrops generator | ⬜ | Add teardrops to trace-pad/via junctions |
| G2 Via stitching / fencing | ⬜ | GND plane stitching, EMI shielding along edges |

---

## Phase 13 — Analysis & Inspection 🚧 IN PROGRESS

| Feature | Status | Notes |
|---------|--------|-------|
| F1 Net inspector | ✅ | `KmNetInspector` — pad/via/track counts, total trace length (mm + in), min/max width, layer chips, connected-component chips with click-to-highlight. Lives in `/components` route net mode. |
| F2 Differential pair validator | ⬜ | Length matching, spacing, impedance check |
| F5 Layer utilization heatmap | ⬜ | Copper density per layer as color overlay |
| F6 DRC error navigator | ⬜ | Click violation → zoom to position on GhostLayer canvas |
| G4 Impedance calculator | ⬜ | Microstrip/stripline/coplanar from stackup data |
| G9 Track width calculator | ⬜ | IPC-2221 current/temp rise/copper weight → min width |

---

## Phase 14 — CRDT & Undo/Redo ⬜ PLANNED

| Feature | Status | Notes |
|---------|--------|-------|
| CRDT in-memory engine | ⬜ | `yrs` document + `.kimaster/journal.db` delta log |
| Undo/redo operation log | ⬜ | journal.db → one-click resync on crash/desync |
| KiCad IPC API migration | ⬜ | Replace WS bridge with kicad-python Protocol Buffers |
| Design variant management | ⬜ | KiCad variant framework + KiMaster variant matrix |

---

---

# Feature Map vs. Priority Matrix

## Tier 1 — High Impact, Dependencies Ready (build next)

| Feature | Phase | Why first |
|---------|-------|-----------|
| ~~E1-E5 Engineering notes editor~~ | ~~10~~ | ✅ Complete |
| ~~D1 3D static render~~ | ~~11~~ | ✅ Complete |
| D3 SVG layer export | 11 | CLI-only, existing infra, engineers use daily |
| ~~F1 Net inspector~~ | ~~13~~ | ✅ Complete |
| ~~A8 Regenerate copper zones~~ | ~~12~~ | ✅ Complete |
| B1-B3 Manufacturing variants | 12 | DNP management already works, needs variant matrix UI |

## Tier 2 — After KiCad IPC Migration

| Feature | Phase | Why second |
|---------|-------|------------|
| A6 Replace footprints | 12 | Needs IPC for reliable library access |
| E2-E3 Smart-links | 10 | Killer feature, needs bridge cross-probe |
| G1-G2 Teardrops + via stitching | 12 | Most requested, needs stable pcbnew write API |
| F2 Diff pair validator | 13 | Signal integrity, needs IPC for trace measurement |

## Tier 3 — Build When Core Is Solid

| Feature | Phase | Why later |
|---------|-------|-----------|
| B4-B6 Panelization | 12 | Complex geometry |
| D7-D8 Visual diff + board viewer | 11 | PCB file parsing complexity |
| G4 Impedance calculator | 13 | Pure math, independent module |
| Phase 14 CRDT | 14 | Architectural complexity |

---

## Architecture Decisions Log

| Decision | Rationale |
|----------|-----------|
| Vanilla JS Web Components (no framework) | Zero build overhead, native browser APIs, long-term stability |
| CSS custom properties for theming | Single token change repaints entire app, zero JS required |
| Proxy-based state (no lib) | ~50 lines vs 50kB framework, perfect for Tauri IPC pattern |
| Batched IPC (rAF queue) | Prevents IPC congestion when multiple modules update simultaneously |
| yrs (CRDT) for live sync | Conflict-free, no file locks, mergeable concurrent edits — PENDING |
| rusqlite bundled | No system SQLite dep, deterministic version, works offline |
| Python WebSocket bridge | Maximum KiCad internal access via pcbnew scripting API (transitional) |
| kicad-cli for headless ops | Official supported interface, stable, cross-platform |
| .kimaster/ project-local dir | Git-ignorable project data, no central DB, no cloud dependency |
| Anti-hallucination probe scripts | Never commit structural pcbnew code until API is confirmed via probe |
| Ghost Layer preview-before-apply | Human-in-the-loop for all destructive board modifications |
| AlignService.js pure JS math | Rule 1 — zero dependencies, fully testable, reusable |
| Centralized AppCommands/AppEvents/AppKeys | Rule 2 — no raw strings in feature files |
| Logger.js for all errors | Rule 3 — no silent catches, full transparency |
| Features from KiRender/KiNotes | Proven concepts from published KiCad plugins, known to be useful |
| Locally-first always | No features that require internet, cloud accounts, or external APIs |
| Native Rust S-Expression Compiler | Prevents multi-second Python startup delays when parsing sprawling component structures, delivering sub-millisecond footprint synthesis directly in Rust. |
| Intercepted Shared Library Vault | Enforces design layout uniformity (text heights, silkscreen clearances, courtyard margins) across all downloaded vendors before files are visible to KiCad. |
| Bulk LCSC/EasyEDA Ingestion | Enables complete schematic BOM extraction and instant footprint assembly creation in a single, parallelized task sequence. |
