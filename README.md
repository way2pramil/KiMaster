# KiMaster

> A companion app for KiCad that takes the friction out of hardware design — live board inspection, component sourcing, DRC, exports, notes, and revision history. All in one window.

![Platform](https://img.shields.io/badge/platform-Windows-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![KiCad](https://img.shields.io/badge/KiCad-7%2B-orange)
![Status](https://img.shields.io/badge/status-early%20access-yellow)

---

## Why KiMaster?

Every KiCad project involves the same invisible tax: hunting for component datasheets, manually writing BOM entries, switching windows a dozen times to run DRC, and stitching together Gerber exports from memory. That friction adds up — and it doesn't have to exist.

KiMaster connects directly to your running KiCad session and builds a proper workspace around it. It doesn't replace KiCad. It makes everything around KiCad faster, cleaner, and less error-prone.

---

## Features

### Live KiCad Bridge
KiMaster connects to KiCad through a local plugin. Once linked, the app has live access to your board — board path is locked at connect time, so commands never touch the wrong project.

### Dashboard
A customisable home screen with everything you need at a glance: board render preview, recent projects, file tree, netlist graph, quick notes, and keyboard shortcuts. Rearrange widgets to fit the way you work.

### Component Vault
Search LCSC for parts, preview the symbol and footprint, and pull them directly into your KiCad library — all without leaving KiMaster. Components are stored in your personal vault and are always a search away.

### Board Render
See a high-fidelity render of your PCB right inside KiMaster. Pan, zoom, and inspect layers without opening the full PCB editor.

### DRC Panel
Run Design Rule Checks from KiMaster and read the results in a clean, scannable table. Click any violation to jump to it.

### Export Wizard
Configure Gerber, BOM, and assembly export profiles once. Run them in one click from then on — no more remembering which layers to tick.

### Net Inspector
Look up any net by name. See connected pads and track lengths, and highlight nets directly on the board render.

### Netlist Graph
An interactive force-directed graph of your schematic's netlist. Useful for understanding densely connected designs before routing.

### Revision Timeline
Git-powered project history built into the app. Browse commits, read diffs, and understand what changed between sessions — without opening a terminal.

### Project Notes
Markdown notes attached to each project. They open automatically when you load a project and save automatically as you type.

---

## Requirements

- Windows 10 or 11
- [KiCad 7 or newer](https://www.kicad.org/)

---

## Installation

Pre-built installers will be on the [Releases](../../releases) page once the first stable build ships.

To build from source, see [Building from source](#building-from-source) below.

---

## KiCad Plugin Setup

KiMaster talks to KiCad through a small plugin that runs inside KiCad's scripting host.

1. Copy the `bridge/kimaster_plugin/` folder into your KiCad scripting plugins directory:
   - Windows: `%APPDATA%\kicad\8.0\scripting\plugins\`
2. In KiCad, open **Tools → Scripting Console** and run:
   ```python
   import kimaster_plugin; kimaster_plugin.start()
   ```
   Add this to your KiCad startup script to have it load automatically every time.
3. Open KiMaster and click **Connect** — the handshake completes in under a second.

> The plugin listens on `localhost:40001` only. No data leaves your machine.

---

## Building from source

```bash
# Clone the repo
git clone https://github.com/way2pramil/KiMaster.git
cd KiMaster

# Install dependencies
npm install

# Run in development mode
npm run dev:tauri

# Build a release installer
npm run build:tauri
```

You will need [Node.js 18+](https://nodejs.org/) and the [Rust toolchain](https://rustup.rs/) installed.

---

## Roadmap

- [ ] macOS and Linux support
- [ ] Auto-updater
- [ ] Component vault sync across machines
- [ ] Schematic editor integration
- [ ] BOM diff between revisions
- [ ] Cloud backup for project notes

---

## Contributing

Found a bug? Have a feature idea? Open an issue and let's talk about it before you write any code — that way the work won't go to waste.

For changes:
1. Fork the repo and create a feature branch
2. Open a pull request with a clear description of what changed and why

---

## Support the Project

KiMaster is free and open source. It has been built over many months of late nights and weekends, tested on real hardware projects, and shaped by the frustrations of actually using KiCad day to day.

If it makes your workflow better, consider buying me a coffee — it genuinely helps keep the project alive.

**GitHub Sponsors** — [github.com/sponsors/way2pramil](https://github.com/sponsors/way2pramil)

**Buy Me a Coffee** — [buymeacoffee.com/way2pramil](https://buymeacoffee.com/way2pramil)

Every contribution, no matter how small, is appreciated. Thank you.

---

## License

[MIT](LICENSE) — free to use, modify, and distribute.
