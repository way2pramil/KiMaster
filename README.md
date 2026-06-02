# KiMaster

> A powerful companion app for KiCad — live board inspection, component sourcing, DRC, export, and more. All in one native desktop app.

![Platform](https://img.shields.io/badge/platform-Windows-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![KiCad](https://img.shields.io/badge/KiCad-7%2B-orange)
![Tauri](https://img.shields.io/badge/built%20with-Tauri%202-purple)
![Status](https://img.shields.io/badge/status-early%20access-yellow)

---

## What is KiMaster?

If you use KiCad, you know the friction: switching between windows, manually copying component data, running DRC from the command line, exporting Gerbers one step at a time. **KiMaster sits alongside KiCad and removes all of that.**

It connects directly to KiCad via a lightweight Python plugin, giving you a live two-way bridge. From one window you can inspect your board, pull components from LCSC, run DRC, manage exports, and keep markdown notes — all without leaving your workflow.

---

## Features

### Live KiCad Bridge
Connect KiMaster to your open KiCad project via a local WebSocket bridge. Once connected, KiMaster has read/write access to your board — commands are locked to the active board path so you never accidentally touch the wrong project.

### Dashboard
Customisable widget dashboard with at-a-glance project info: board render preview, recent projects, file tree, netlist graph, quick notes, and keyboard shortcuts.

### Component Vault
Search LCSC/EasyEDA and pull parts directly into your KiCad library. KiMaster fetches the schematic symbol and footprint, runs a configurable post-processor, and saves everything to your vault — ready to place.

### Board Render
High-fidelity board preview inside KiMaster. Pan, zoom, and inspect without opening KiCad's PCB editor.

### DRC Panel
Run Design Rule Checks from KiMaster. Results are displayed in a clean table — click any violation to jump to it.

### Export Wizard
One-click Gerber, BOM, and assembly export. Configure profiles once and reuse them across projects.

### Net Inspector
Inspect nets by name. See connected pads, track lengths, and highlight nets in the board render.

### Netlist Graph
Interactive force-directed graph of your schematic's netlist — great for understanding complex designs.

### Revision Timeline
Git-powered revision history for your project directory. Browse commits, diffs, and file changes without leaving the app.

### Project Notes
Markdown notes scoped to each project. Auto-saved, always available.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | [Tauri 2](https://tauri.app) (Rust) |
| Frontend | Vanilla JS + Web Components (no framework) |
| Backend | Rust (async, Tokio) |
| KiCad bridge | Python plugin (KiCad scripting host) |
| Component data | LCSC / EasyEDA API |
| Local storage | SQLite (project recents, vault) |

---

## Requirements

- Windows 10/11 (macOS/Linux support planned)
- [KiCad 7 or newer](https://www.kicad.org/)
- [Node.js 18+](https://nodejs.org/) and [Rust toolchain](https://rustup.rs/) — for building from source

---

## Installation

### Option A — Build from source

```bash
# 1. Clone
git clone https://github.com/your-username/KiMaster.git
cd KiMaster

# 2. Install JS dependencies
npm install

# 3. Run in dev mode (Tauri + Vite hot-reload)
npm run dev:tauri

# 4. Or build a release .exe
npm run build:tauri
```

### Option B — Download a release

Pre-built installers will be available on the [Releases](../../releases) page once the first stable build ships.

---

## KiCad Plugin Setup

KiMaster communicates with KiCad through a Python plugin. After building or installing:

1. Copy the `bridge/kimaster_plugin/` folder into your KiCad scripting directory:
   - Windows: `%APPDATA%\kicad\8.0\scripting\plugins\`
2. In KiCad, open **Tools → Scripting Console** and run:
   ```python
   import kimaster_plugin; kimaster_plugin.start()
   ```
   Or add it to your KiCad startup script so it loads automatically.
3. Launch KiMaster and click **Connect** — the bridge handshake will complete automatically.

> The plugin listens on `localhost:40001` and only accepts connections from KiMaster. No data leaves your machine.

---

## Development

```bash
npm run dev          # Browser-only (mock IPC — no Tauri needed)
npm run dev:tauri    # Full app with Tauri
npm run check        # Rust check + Vite build check
npm run check:all    # fmt + clippy + full check
npm run rust:test    # Cargo tests
npm run build:tauri  # Production build
```

### Project layout

```
src/                 Vanilla JS frontend
  core/              State, IPC, routing, events
  components/ui/     Reusable Web Components (km-* prefix)
  components/features/ One folder per panel
  modules/           Domain logic (no DOM)

src-tauri/src/
  ipc/               Tauri command handlers (thin wrappers)
  modules/
    bridge/          WebSocket client ↔ Python plugin
    uce/             LCSC component fetcher & vault
    project/         KiCad project management + SQLite recents
    cli/             kicad-cli runner (DRC, export)
    git/             Revision history via git shell
    notes/           Per-project markdown notes

bridge/              Python plugin for KiCad
```

---

## Roadmap

- [ ] macOS and Linux support
- [ ] Installer / auto-updater
- [ ] Component vault sync across machines
- [ ] Schematic editor integration
- [ ] BOM diff between revisions
- [ ] Cloud backup for notes

---

## Contributing

Contributions are welcome. If you find a bug or have a feature idea, please open an issue first so we can discuss it before you put in the work.

For code changes:
1. Fork and create a feature branch
2. Follow the code style in [CLAUDE.md](CLAUDE.md)
3. Open a pull request with a clear description of what changed and why

---

## Support the Project

KiMaster is free and open source. If it saves you time on your next PCB project, consider supporting its development:

**GitHub Sponsors** — [sponsor this project](https://github.com/sponsors/your-username)

**Buy Me a Coffee** — [buymeacoffee.com/your-username](https://buymeacoffee.com/your-username)

Even a small contribution helps cover the time spent building and maintaining the tool. Thank you.

---

## License

[MIT](LICENSE) — free to use, modify, and distribute.

---

*Built by a hardware engineer who got tired of the KiCad workflow friction.*
