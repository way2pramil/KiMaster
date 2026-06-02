# KiMaster — Advanced KiCad Companion App

<p align="center">
  <img src="src-tauri/icons/KiMaster.svg" alt="KiMaster" width="160"/>
</p>

<p align="center">
  <strong>Version 0.1.0</strong> — Everything you need alongside KiCad, in one native desktop app.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License"/></a>
  <img src="https://img.shields.io/badge/KiCad-7%2B-orange.svg" alt="KiCad 7+"/>
  <img src="https://img.shields.io/badge/platform-Windows-blue.svg" alt="Windows"/>
  <img src="https://img.shields.io/badge/status-early%20access-yellow.svg" alt="Early Access"/>
  <a href="https://github.com/sponsors/way2pramil"><img src="https://img.shields.io/badge/Sponsor-💝-ff69b4.svg" alt="Sponsor"/></a>
</p>

---

## The Problem We Solve

Every KiCad user knows the friction.

*"Let me run DRC real quick"* — open terminal, remember the flags, parse the output manually.  
*"I need that LCSC component"* — browser tab, copy symbol name, download footprint, manually add to library.  
*"What did the last export include?"* — re-check every layer checkbox from memory.

Your workflow keeps getting interrupted. You're a hardware engineer — you should be designing, not fighting your tools.

**KiMaster sits alongside KiCad and removes all of that.**

---

## Demo

<!-- Add a short screen recording or GIF here. Example:
[![KiMaster Demo](https://img.youtube.com/vi/YOUR_VIDEO_ID/maxresdefault.jpg)](https://www.youtube.com/watch?v=YOUR_VIDEO_ID)
-->

> Video demo coming soon.

---

## ✨ Features

### Live KiCad Bridge
KiMaster connects directly to your open KiCad session through a local WebSocket plugin. Once linked, every feature in KiMaster has live access to your board — locked to the active project so commands never touch the wrong file.

### Dashboard
A customisable home screen showing everything at a glance: board render preview, recent projects, file tree, netlist graph, quick notes, and shortcuts. Rearrange widgets to fit your workflow.

### Component Vault
Search LCSC, preview the symbol and footprint, and pull parts directly into your KiCad library — without leaving KiMaster. Components are saved to your personal vault and searchable instantly on every future project.

### Board Render
High-fidelity PCB preview inside KiMaster. Pan, zoom, and inspect layers without opening the full editor.

### DRC Panel
Run Design Rule Checks from KiMaster. Results appear in a clean table — click any violation to jump straight to it.

### Export Wizard
Configure Gerber, BOM, and assembly export profiles once. Run them in one click every time after that.

### Net Inspector
Look up any net by name. See connected pads, track lengths, and highlight nets on the board render.

### Netlist Graph
Interactive force-directed graph of your schematic's netlist. Useful for understanding densely connected designs before you start routing.

### Revision Timeline
Git-powered project history built into the app. Browse commits, read diffs, and understand what changed between sessions.

### Project Notes
Markdown notes tied to each project. Open automatically when you load a project, save automatically as you type.

---

## 🚀 Quick Start

### Installation

Pre-built installers will be on the [Releases](../../releases) page once the first stable build ships.

### KiCad Plugin Setup

1. Copy the `bridge/kimaster_plugin/` folder to your KiCad scripting plugins directory:
   - **Windows:** `%APPDATA%\kicad\8.0\scripting\plugins\`
2. In KiCad, open **Tools → Scripting Console** and run:
   ```python
   import kimaster_plugin; kimaster_plugin.start()
   ```
3. Open KiMaster and click **Connect** — the handshake completes in under a second.

> The plugin listens on `localhost:40001` only. No data leaves your machine.

---

## 📋 Requirements

- Windows 10 or 11
- [KiCad 7 or newer](https://www.kicad.org/)

---

## 📖 The Story Behind KiMaster

I've been doing PCB work for years. Every project follows the same pattern: great ideas at the start, then a slow grind through tooling friction that has nothing to do with the actual design.

The component sourcing alone used to cost me an hour per project. Open LCSC in a browser, find the part, download the symbol, download the footprint, figure out which library folder to put it in, add it to KiCad. For every part. On every board.

Then there's the export ritual. Same checkboxes every time. Same chance of forgetting one layer. Same hunt for the right kicad-cli flags.

I built KiMaster because I was tired of the ritual. It started as a side tool just for my own projects — something that remembered my export configs, kept my component library organised, and let me run DRC without opening a terminal. Over time it grew into something I thought other engineers might actually want.

The goal hasn't changed: **remove friction, not features.** KiMaster doesn't try to replace KiCad. It makes everything around KiCad faster and less error-prone. Local-first, no cloud, no accounts — just a tool that stays out of your way until you need it.

*Built by a hardware engineer who got tired of the same manual steps on every project.*

---

## 🗺️ Roadmap

- [ ] Mouser and DigiKey integration for Component Vault.
- [ ] Auto-updater
- [ ] PCB layout manipulation.
- [ ] Schematic editor integration when IPC for schematic is ready (expected in KiCad 11), we can control and manipulate schematics.
- [ ] BOM diff between revisions
- [ ] Real-time calculation for impedance, stackup, and track width.
- [ ] Via Stitching 



---

## 🤝 Contributing

Found a bug or have a feature idea? Open an issue first so we can discuss it before you put in the work.

1. Fork the repo and create a feature branch
2. Open a pull request with a clear description of what changed and why

---

## 💝 Support This Project

KiMaster is free and open source. It has been built over many months of evenings and weekends, tested on real hardware projects, and shaped by the genuine frustrations of using KiCad day to day.

If it makes your workflow better, consider supporting its development — every contribution helps keep the project alive and actively maintained.

<p align="center">
  <a href="https://github.com/sponsors/way2pramil">
    <img src="https://img.shields.io/badge/Sponsor_on_GitHub-💝-ff69b4.svg?style=for-the-badge" alt="Sponsor on GitHub"/>
  </a>
  &nbsp;&nbsp;
  <a href="https://buymeacoffee.com/pramil">
    <img src="https://img.shields.io/badge/Buy_Me_A_Coffee-☕-FFDD00.svg?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me A Coffee"/>
  </a>
</p>

---

## 📄 License

**Apache License 2.0** — free for personal and commercial use.

`SPDX-License-Identifier: Apache-2.0`

---

<p align="center">
  <sub>Built for hardware engineers who are done fighting their tools</sub>
</p>
