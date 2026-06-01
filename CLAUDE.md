# KiMaster

KiCad companion app. Tauri 2 shell, Vite/vanilla-JS frontend, Rust backend, Python plugin in KiCad.

## Commands

```bash
npm run dev:tauri        # full app (Tauri + Vite hot-reload)
npm run dev              # browser-only (mock IPC)
npm run check            # rust check + vite build check
npm run check:all        # fmt + clippy + check
npm run rust:test        # cargo test
npm run build:tauri      # production .exe
npm run backup           # git commit + push + bundle to D:\Backups
```

## Architecture

```
src/                    Vanilla JS, no framework
  core/
    State.js            Proxy-based reactive store — single source of truth
    Ipc.js              Batched Tauri invoke (rAF queue); mock fallback for browser dev
    AppEvents.js        String constants for Tauri events (listen/emit)
    AppCommands.js      String constants for IPC command names
    Router.js           Hash-based SPA router
  components/
    ui/Km*              Reusable Web Components (prefix: Km)
    features/           One folder per panel/screen
  modules/              Domain logic (no DOM); consumes Ipc + State

src-tauri/src/
  main.rs               Tauri setup, plugin registration
  AppState.rs           KiMasterState(Mutex<KiMasterStateInner>) — all mutable Rust state
  AppConfig.rs          Compile-time constants (ports, paths)
  ipc/                  #[tauri::command] handlers — thin, delegate to modules
  modules/
    bridge/             WebSocket client ↔ Python plugin (WsClient.rs)
    uce/                LCSC/EasyEDA fetcher, KiCad sym/mod generator, vault
    project/            .kicad_pro open/close, SQLite recents, file watcher
    cli/                kicad-cli runner (DRC, ERC, export)
    git/                git log/diff via shell
    notes/              Markdown notes per project

bridge/kimaster_plugin/ Python plugin running inside KiCad's scripting host
                        Exposes WS server on :40001, executes board commands
```

## Boundaries

- **IPC only** — frontend never touches the filesystem; everything goes through `invoke()`.
- **Rust state is locked** — `KiMasterState(Mutex<…>)`; lock, read/write, drop immediately.
- **Bridge lock** — `locked_board_path` is set on WS connect. Every write command is rejected if board path doesn't match. Python plugin enforces the same check.
- **No framework** — `State.js` Proxy + Web Components. Do not introduce React/Vue/Svelte.
- **Mock parity** — every new `#[tauri::command]` needs a matching entry in `Ipc.js _mockInvoke`.

## Code style

**Rust**
- `PascalCase` files in `ipc/` and `modules/`. `snake_case` everywhere inside.
- Commands named `cmd_verb_noun` (e.g. `cmd_bridge_connect`).
- Return `Result<T, String>` from commands; use `anyhow` internally.
- Tracing: `tracing::info!` / `tracing::warn!` — not `println!`.

**JS**
- ES modules, no bundler abstractions. Import by relative path with `.js` extension.
- `PascalCase.js` for components and services. `camelCase` for variables.
- Web Components: class name = file name = element tag prefix `km-`.
- `store.key = value` to write state; `subscribe('key', fn)` to observe.
- `invoke('cmd_name', { args })` — always use constants from `AppCommands.js`.
- No comments explaining what code does. Only comment non-obvious WHY.

**Both**
- No dead fallbacks for impossible states.
- No `console.log` left in production paths — use `Logger.js` (JS) or `tracing` (Rust).
