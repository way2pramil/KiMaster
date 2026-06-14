"""
KiMaster WebSocket server — runs inside KiCad's Python environment.

Protocol (JSON messages):

  Client → Server:
    { "type": "hello",              "client": "kimaster", "version": "0.1.0" }
    { "type": "get_board_state" }
    { "type": "get_schematic_state" }
    { "type": "highlight_component","data": { "ref": "U1" } }
    { "type": "highlight_net",      "data": { "net": "GND" } }
    { "type": "clear_highlight" }
    { "type": "ping" }

  Board-ops (all require board_check in data for write path):
    { "type": "via_stitch",         "data": { net, via_size_mm, drill_mm, pitch_mm,
                                               layer_from, layer_to, zone_name, dry_run } }
    { "type": "apply_teardrops",    "data": { targets, size_ratio, curve_points, dry_run } }
    { "type": "remove_teardrops",   "data": { board_check } }
    { "type": "panelize_board",     "data": { cols, rows, gap_mm, rail_mm, dry_run, ... } }

  Server → Client:
    { "type": "hello_ack",         "version": "0.1.0", "board": "...", "kicad_version": "10.0.1",
                                   "client_count": int }
    { "type": "board_state",       "data": { ... }  }
    { "type": "schematic_state",   "data": { ... }  }
    { "type": "board_changed"                        }
    { "type": "selection_changed","data": { "refs": [...], "nets": [...] } }
    { "type": "pong"                               }
    { "type": "error",           "message": "..." }

Requirements:
  KiCad bundles websockets in its Python environment (KiCad 9+).
  Fallback: install manually:  pip install websockets
"""

import asyncio
import json
import logging
import os
import secrets
import threading
from typing import Optional, Set

from .ops import ViaStitch, Teardrops, Panelize

_log = logging.getLogger("kimaster.ws")

KIMASTER_HOST       = "127.0.0.1"
KIMASTER_PORT_START = 40001          # First port to try
KIMASTER_PORT_END   = 40010          # Last port to try (inclusive)
KIMASTER_VERSION    = "0.1.2"   # bumped: fix (thickness N locked) regex for KiCad 10
# Maximum number of simultaneous clients.  Set to 1 to allow only the
# KiMaster desktop app.  Rogue / unexpected connections are refused.
MAX_CLIENTS         = 1


class KiMasterWsServer:
    """Manages the asyncio WebSocket server in a dedicated background thread.

    Security model:
    - Binds to 127.0.0.1 ONLY — never accepts external network connections.
    - Allows at most MAX_CLIENTS=1 simultaneous connection.  Any extra
      connection attempt is immediately rejected with an error message and
      the socket is closed.  This prevents other local processes from
      silently snooping on PCB data.
    - Every write command is validated against the locked board path
      (board_check field) before execution.

    Port auto-discovery: tries KIMASTER_PORT_START → KIMASTER_PORT_END so
    multiple KiCad instances can each run their own bridge.
    """

    def __init__(self, board_exporter, sch_exporter=None):
        self._exporter     = board_exporter
        self._sch_exporter = sch_exporter
        self._clients: Set = set()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._selection_watcher = None
        self._board_watcher = None
        self._port: int = KIMASTER_PORT_START  # updated to actual bound port in _serve()

    @property
    def port(self) -> int:
        """The actual port this server is (or will be) listening on."""
        return self._port

    # ── Lifecycle ──────────────────────────────────────────────────────────

    @property
    def client_count(self) -> int:
        """Number of connected KiMaster clients."""
        return len(self._clients)

    def start(self):
        """Start the WS server in a background thread."""
        if self._running:
            return
        self._running = True
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(
            target=self._run_event_loop,
            daemon=True,
            name="KiMaster-WS",
        )
        self._thread.start()
        _log.info(f"KiMaster WS server starting (will auto-discover port {KIMASTER_PORT_START}–{KIMASTER_PORT_END})")

    def stop(self):
        """Gracefully stop the WS server.

        Broadcasts a ``server_stopping`` notice to all connected clients so
        the KiMaster app can update its UI immediately, then closes the
        event loop and waits for the background thread to exit.
        """
        if not self._running:
            return
        # Notify clients before pulling the plug
        self.broadcast({
            "type":    "server_stopping",
            "message": "KiMaster bridge server stopped by user in KiCad.",
        })
        self._running = False
        if self._loop and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(self._loop.stop)
        if self._thread:
            self._thread.join(timeout=3)
        self._clients.clear()
        _log.info("KiMaster WS server stopped on port %d", self._port)

    def is_running(self) -> bool:
        return self._running and (self._thread is not None) and self._thread.is_alive()

    def set_watchers(self, selection_watcher, board_watcher):
        """Store references to watchers so we can adjust their poll intervals."""
        self._selection_watcher = selection_watcher
        self._board_watcher = board_watcher

    # ── Broadcasting (thread-safe) ─────────────────────────────────────────

    def broadcast(self, msg: dict):
        """Send a message to all connected clients. Thread-safe."""
        if not self._loop or self._loop.is_closed() or not self._clients:
            return
        data = json.dumps(msg)
        asyncio.run_coroutine_threadsafe(self._broadcast_async(data), self._loop)

    def broadcast_board_state(self):
        """Serialize current board state and broadcast to all clients."""
        try:
            state = self._exporter.get_board_state()
            self.broadcast({"type": "board_state", "data": state})
        except Exception as e:
            _log.warning(f"KiMaster: board state broadcast failed: {e}")

    def notify_board_changed(self):
        """Call this from KiCad event handlers when the board changes."""
        self.broadcast({"type": "board_changed"})

    def notify_selection_changed(self, refs: list, nets: list):
        """Call this when KiCad selection changes."""
        self.broadcast({
            "type": "selection_changed",
            "data": {"refs": refs, "nets": nets},
        })

    # ── Internal ──────────────────────────────────────────────────────────

    def _run_event_loop(self):
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_until_complete(self._serve())
        except Exception as e:
            _log.error(f"KiMaster WS loop error: {e}")

    async def _serve(self):
        try:
            import websockets
        except ImportError:
            _log.error(
                "websockets package not found. "
                "Install via: pip install websockets   (in KiCad's Python env)"
            )
            return

        # Auto-discover first available port in the configured range.
        # Allows multiple KiCad instances to each run their own bridge.
        bound_port = None
        last_error = None
        for candidate in range(KIMASTER_PORT_START, KIMASTER_PORT_END + 1):
            try:
                server = await websockets.serve(
                    self._handler,
                    KIMASTER_HOST,
                    candidate,
                    ping_interval=20,
                    ping_timeout=10,
                )
                bound_port = candidate
                self._port = candidate
                _log.info(f"KiMaster WS server listening on ws://{KIMASTER_HOST}:{candidate}")
                break
            except OSError as e:
                _log.debug(f"Port {candidate} unavailable: {e}")
                last_error = e
                continue

        if bound_port is None:
            _log.error(
                f"KiMaster WS server could not bind to any port in range "
                f"{KIMASTER_PORT_START}–{KIMASTER_PORT_END}: {last_error}"
            )
            return

        async with server:
            await asyncio.Future()  # run until loop is stopped

    async def _broadcast_async(self, data: str):
        dead: Set = set()
        for ws in list(self._clients):
            try:
                await ws.send(data)
            except Exception:
                dead.add(ws)
        self._clients -= dead

    async def _handler(self, websocket):
        """Handle an incoming WebSocket connection.

        Handshake order (new):
        1. Check Origin header — reject browser-based cross-origin requests.
        2. Wait briefly for a ``hello`` message from the client.
        3a. If ``client == "kimaster-probe"``: respond with hello_ack + metadata,
            close immediately.  Probe connections are ALWAYS allowed regardless
            of the MAX_CLIENTS limit — they never receive board data, only
            enough metadata for the scan to identify the bridge.
        3b. If it is a real client:
            - If at capacity → send error, close.
            - Otherwise → accept, send board_state, enter message loop.

        Why read hello first?
        Previously the plugin sent board_state immediately on connect, then
        read messages.  This meant the single-client guard fired BEFORE we
        could distinguish a probe from a real client.  With MAX_CLIENTS=1, the
        scan probe was rejected while KiMaster was already connected, producing
        "0 instances found" even though the bridge was running.
        """
        # ── Origin check ─────────────────────────────────────────────────
        origin = getattr(websocket, "origin", None) or \
                 (websocket.request_headers.get("Origin", "") if hasattr(websocket, "request_headers") else "")
        if origin:
            from urllib.parse import urlparse
            parsed = urlparse(origin)
            host = parsed.hostname or ""
            if host not in ("", "localhost", "127.0.0.1", "tauri.localhost"):
                _log.warning("KiMaster: rejected WS from foreign origin: %s", origin)
                await websocket.close(4403, "Forbidden origin")
                return
        # ── Step 1: read first message (the hello) ────────────────────────
        first_msg: dict = {}
        try:
            raw_first = await asyncio.wait_for(websocket.recv(), timeout=0.8)
            first_msg = json.loads(raw_first)
        except (asyncio.TimeoutError, Exception):
            pass  # no hello within 0.8s — treat as real client with no hello

        msg_type   = first_msg.get("type", "")
        msg_client = first_msg.get("client", "")

        # ── Step 2a: probe path ───────────────────────────────────────────
        # Scan probes identify themselves with client="kimaster-probe".
        # They bypass the capacity check and receive only identification info
        # (no board data).  They close themselves after receiving hello_ack.
        if msg_type == "hello" and msg_client == "kimaster-probe":
            pcb_path  = str(self._exporter.get_board_name())
            try:
                import pcbnew as _pb_info
                kicad_ver = str(_pb_info.GetBuildVersion())
            except Exception:
                kicad_ver = "unknown"
            _log.debug("KiMaster: probe accepted on port %d", self._port)
            await websocket.send(json.dumps({
                "type":         "hello_ack",
                "version":      KIMASTER_VERSION,
                "pcb_path":     pcb_path,
                "kicad_version": kicad_ver,
                "client_count": len(self._clients),
            }))
            # Close cleanly — probe has what it needs
            return

        # ── Step 2b: real client path ─────────────────────────────────────
        if len(self._clients) >= MAX_CLIENTS:
            _log.warning(
                "KiMaster: rejected extra connection (already have %d/%d client(s)). "
                "Only the KiMaster desktop app may connect.",
                len(self._clients), MAX_CLIENTS,
            )
            await websocket.send(json.dumps({
                "type":    "error",
                "message": (
                    f"Bridge is busy: {len(self._clients)} client(s) connected. "
                    "Only the KiMaster desktop app is permitted."
                ),
            }))
            return

        self._clients.add(websocket)
        _log.info("KiMaster: client connected (%d/%d)", self.client_count, MAX_CLIENTS)
        self._update_kicad_status()

        try:
            # Respond to the hello we already read (if there was one)
            if msg_type == "hello":
                await self._on_hello(websocket, first_msg)

            # Send full board state
            try:
                state = self._exporter.get_board_state()
                await websocket.send(json.dumps({"type": "board_state", "data": state}))
                _log.info(
                    "KiMaster: sent initial board state (%d components, %d nets)",
                    len(state.get("components", [])),
                    len(state.get("nets", [])),
                )
            except Exception as e:
                _log.warning("KiMaster: initial board state send failed: %s", e)
                await websocket.send(json.dumps({
                    "type": "error", "message": f"Board state error: {e}",
                }))

            # Message loop
            async for raw in websocket:
                await self._handle_message(websocket, raw)

        except Exception as e:
            _log.debug("KiMaster WS handler: %s", e)
        finally:
            self._clients.discard(websocket)
            _log.info("KiMaster: client disconnected (%d remaining)", self.client_count)
            self._update_kicad_status()

    async def _handle_message(self, websocket, raw: str):
        """Dispatch an inbound message from a client."""
        try:
            msg = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            await websocket.send(json.dumps({
                "type": "error",
                "message": "Invalid JSON",
            }))
            return

        msg_type = msg.get("type", "")
        _log.debug(f"KiMaster ← {msg_type}")

        # ── Read-only / UI commands (no board_check required) ─────────────────
        if msg_type == "hello":
            await self._on_hello(websocket, msg)
        elif msg_type == "get_board_state":
            await self._on_get_board_state(websocket)
        elif msg_type == "highlight_component":
            self._on_highlight_component(msg.get("data", {}))
        elif msg_type == "highlight_net":
            self._on_highlight_net(msg.get("data", {}))
        elif msg_type == "clear_highlight":
            self._on_clear_highlight()
        elif msg_type == "get_stackup":
            data = self._on_get_stackup()
            await websocket.send(json.dumps({"type": "stackup_data", "data": data}))
        elif msg_type == "get_net_info":
            info = self._on_get_net_info(msg.get("data", {}))
            await websocket.send(json.dumps({"type": "net_info", "data": info}))
        elif msg_type == "get_schematic_state":
            await self._on_get_schematic_state(websocket)
        elif msg_type == "ping":
            await websocket.send(json.dumps({"type": "pong"}))
        elif msg_type == "get_poll_intervals":
            resp = self._on_get_poll_intervals()
            await websocket.send(json.dumps({"type": "poll_intervals", "data": resp}))
        elif msg_type == "set_poll_intervals":
            resp = self._on_set_poll_intervals(msg.get("data", {}))
            await websocket.send(json.dumps({"type": "poll_intervals", "data": resp}))

        # ── Write commands (all project-locked via _check_board) ──────────────
        # Every write command must carry board_check in its data payload.
        # _check_board() rejects the command if the path doesn't match the
        # currently open board — last line of defence against cross-project writes.
        elif msg_type in ("move_component", "rotate_component", "set_locked",
                          "set_dnp", "regenerate_zones", "purge_orphan_vias",
                          "via_stitch", "apply_teardrops", "remove_teardrops",
                          "panelize_board"):
            await self._dispatch_write(websocket, msg_type, msg.get("data", {}))

        else:
            _log.debug(f"KiMaster: unhandled message type '{msg_type}'")

    # ── Write command dispatcher ──────────────────────────────────────────────

    async def _dispatch_write(self, websocket, op: str, data: dict):
        """
        Central dispatch for all project-locked write commands.

        Runs _check_board() first; on failure sends an op_result error without
        touching the board.  On success calls the appropriate handler and sends
        the op_result reply.  Adding a new write command only requires one entry
        in the dispatch table below — no further branching in _handle_message.
        """
        _HANDLERS = {
            "move_component":    self._on_move_component,
            "rotate_component":  self._on_rotate_component,
            "set_locked":        self._on_set_locked,
            "set_dnp":           self._on_set_dnp,
            "regenerate_zones":  self._on_regenerate_zones,
            "purge_orphan_vias": self._on_purge_orphan_vias,
            # Board-ops (ops/ package)
            "via_stitch":        self._on_via_stitch,
            "apply_teardrops":   self._on_apply_teardrops,
            "remove_teardrops":  self._on_remove_teardrops,
            "panelize_board":    self._on_panelize_board,
        }

        _log.debug("KiMaster: dispatch_write op=%s board_check=%r", op, data.get("board_check"))

        guard = self._check_board(data)
        if guard:
            _log.debug("KiMaster: dispatch_write op=%s rejected by board guard: %s", op, guard.get("message"))
            resp = guard
        else:
            handler = _HANDLERS[op]
            resp = handler(data)

        _log.debug("KiMaster: dispatch_write op=%s → op_result success=%s message=%r",
                   op, resp.get("success"), resp.get("message"))
        await websocket.send(json.dumps({"type": "op_result", "op": op, **resp}))

    # ── Project lock guard ────────────────────────────────────────────────────

    def _check_board(self, data: dict) -> "dict | None":
        """
        Validate the optional ``board_check`` field in a write-command payload.

        KiMaster stamps every write command with the absolute PCB path it
        believes it is modifying.  If that path does not match the board that
        is currently open in this KiCad instance, the command is refused — this
        is the last line of defence against accidental cross-project writes.

        Returns ``None`` if the check passes (command should proceed).
        Returns an error-result dict if the check fails (command must be skipped).
        """
        board_check = data.get("board_check")
        if not board_check:
            return None  # no check requested → allow (backwards compat)

        current = str(self._exporter.get_board_name())
        # Normalise path separators for comparison
        def _norm(p): return p.replace("\\", "/").strip()

        if _norm(board_check) != _norm(current):
            msg = (
                f"Board mismatch — command targets '{board_check}' "
                f"but this KiCad has '{current}' open. "
                f"Command rejected to prevent accidental changes to the wrong project."
            )
            _log.warning("SAFETY REJECT: %s", msg)
            return {"success": False, "message": msg}

        return None  # check passed

    # ── KiCad status indicator ────────────────────────────────────────────

    def _update_kicad_status(self):
        """
        Update KiCad's status bar to show connected KiMaster client count.
        Uses wx.CallAfter to run on the main thread.
        """
        count = self.client_count
        try:
            import wx
            wx.CallAfter(self._set_kicad_title_suffix, count)
        except Exception:
            pass

    @staticmethod
    def _set_kicad_title_suffix(count: int):
        """Update the KiCad window title with KiMaster status (main thread)."""
        try:
            import wx
            frame = wx.GetTopLevelWindows()
            for w in frame:
                title = w.GetTitle()
                # Strip any existing KiMaster suffix
                if " — KiMaster" in title:
                    title = title[:title.index(" — KiMaster")]
                if count > 0:
                    w.SetTitle(f"{title} — KiMaster ({count} client{'s' if count != 1 else ''})")
                else:
                    w.SetTitle(title)
                break  # Only update the first top-level window (PCB editor)
        except Exception:
            pass

    # ── Message handlers ──────────────────────────────────────────────────

    async def _on_hello(self, websocket, msg: dict):
        try:
            import pcbnew
            kicad_ver = str(pcbnew.GetBuildVersion())
        except Exception:
            kicad_ver = "unknown"

        pcb_path = str(self._exporter.get_board_name())

        await websocket.send(json.dumps({
            "type":           "hello_ack",
            "version":        KIMASTER_VERSION,
            "kicad_version":  kicad_ver,
            "board":          pcb_path,   # kept for backwards-compat
            "pcb_path":       pcb_path,   # explicit full path for project auto-detect
            "client_count":   self.client_count,
            "poll_intervals": self._on_get_poll_intervals(),
        }))

    async def _on_get_board_state(self, websocket):
        """Handle explicit board-state request with full diagnostics."""
        try:
            state = self._exporter.get_board_state()
            diag  = state.pop("_diag", [])
            await websocket.send(json.dumps({
                "type": "board_state",
                "data": state,
            }))
            _log.info(
                "KiMaster: board state sent (%d components) diag=%s",
                len(state.get("components", [])),
                " | ".join(diag[:5]),
            )
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            _log.warning(f"KiMaster: get_board_state failed: {e}\n{tb}")
            await websocket.send(json.dumps({
                "type": "error",
                "message": f"Board state error: {e}",
            }))

    async def _on_get_schematic_state(self, websocket):
        """Parse the .kicad_sch file and send the result to this client."""
        if self._sch_exporter is None:
            await websocket.send(json.dumps({
                "type": "schematic_state",
                "data": {
                    "sch_path": None,
                    "symbols": [], "components": [], "net_labels": [],
                    "sheet_count": 0, "no_connect_count": 0,
                    "error": "SchematicExporter not attached — was the plugin activated on a saved board?",
                },
            }))
            return
        try:
            state = self._sch_exporter.get_schematic_state()
            await websocket.send(json.dumps({"type": "schematic_state", "data": state}))
            _log.info(
                "KiMaster: schematic state sent (%d components, %d labels, error=%s)",
                len(state.get("components", [])),
                len(state.get("net_labels", [])),
                state.get("error"),
            )
        except Exception as e:
            import traceback
            _log.warning("KiMaster: get_schematic_state failed: %s\n%s", e, traceback.format_exc())
            await websocket.send(json.dumps({
                "type": "error",
                "message": f"Schematic state error: {e}",
            }))

    def _on_highlight_component(self, data: dict):
        """Highlight a footprint by reference (thread-safe via asyncio)."""
        ref = data.get("ref", "")
        if not ref:
            return
        try:
            import pcbnew
            board = pcbnew.GetBoard()
            for fp in board.GetFootprints():
                if str(fp.GetReference()) == ref:
                    board.SetHighLight(True, fp.GetNetCode(), False)
                    pcbnew.Refresh()
                    return
        except Exception as e:
            _log.warning(f"KiMaster: highlight_component failed: {e}")

    def _on_highlight_net(self, data: dict):
        """Highlight a net by name."""
        net_name = data.get("net", "")
        if not net_name:
            return
        try:
            import pcbnew
            board = pcbnew.GetBoard()
            net = board.FindNet(net_name)
            if net:
                board.SetHighLight(True, net.GetNetCode(), False)
                pcbnew.Refresh()
        except Exception as e:
            _log.warning(f"KiMaster: highlight_net failed: {e}")

    def _on_get_stackup(self) -> dict:
        """
        Extract the live board stackup. Never calls GetStackupDescriptor() —
        that API is broken on KiCad 10 (returns SwigPyObject).

        Strategy pipeline (first success wins):
          1. File parse  — reads .kicad_pcb and parses (stackup …) S-expression.
          2. Synthesize  — builds a stackup from copper count + board thickness.
                           Source = 'synthesized'; UI shows a warning.

        Returns { board_name, layers, source, warning?, error? }
        """
        # ── Get board handle and file path ────────────────────────────────────
        try:
            import pcbnew
            board      = pcbnew.GetBoard()
            board_name = str(board.GetFileName())
        except Exception as e:
            return {"board_name": "", "layers": [], "source": "unavailable",
                    "error": f"pcbnew unavailable: {e}"}

        err1 = ""   # capture before Python deletes exception bindings
        err2 = ""

        # ── Strategy 1: parse the .kicad_pcb file directly ───────────────────
        try:
            layers = self._stackup_via_file(board_name)
            if layers:
                _log.info("KiMaster: stackup extracted from file (%d layers)", len(layers))
                return {"board_name": board_name, "layers": layers,
                        "source": "file_parse"}
        except Exception as e:
            err1 = str(e)
            _log.warning("KiMaster: stackup file parse failed: %s", e)

        # ── Strategy 2: synthesize from copper count + board thickness ────────
        try:
            layers = self._stackup_synthesize(pcbnew, board)
            if layers:
                cu = sum(1 for l in layers if l["layer_type"] == "copper")
                _log.info("KiMaster: synthesized %d-layer stackup (plugin v%s)",
                          cu, KIMASTER_VERSION)
                return {
                    "board_name": board_name,
                    "layers":     layers,
                    "source":     "synthesized",
                    "warning":    (
                        "No explicit stackup found in board file — "
                        "standard FR4 values assumed. "
                        "For accurate impedance calculations, define the stackup in "
                        "KiCad → File → Board Setup → Board Stackup."
                    ),
                }
        except Exception as e:
            err2 = str(e)
            _log.warning("KiMaster: stackup synthesize failed: %s", e)

        return {
            "board_name": board_name,
            "layers":     [],
            "source":     "unavailable",
            "error":      f"File parse: {err1 or 'no stackup section'}  |  Synthesize: {err2 or 'unknown'}",
        }

    # ── File-parse strategy ───────────────────────────────────────────────────

    def _stackup_via_file(self, board_path: str) -> list:
        """
        Parse the stackup block from a .kicad_pcb file.
        Tries keyword 'stackup' (KiCad 6–10) and 'board_stackup' (older formats).
        Works across all KiCad versions because the S-expression file format is stable.
        """
        import os

        if not board_path:
            raise ValueError("Empty board path")

        # Normalise path separators for Windows
        norm_path = board_path.replace("\\", "/")
        if not os.path.isfile(norm_path):
            # Also try with backslashes on Windows
            norm_path = board_path.replace("/", "\\")
            if not os.path.isfile(norm_path):
                raise FileNotFoundError(
                    f"Board file not found: {board_path!r} "
                    f"(also tried: {norm_path!r})"
                )

        with open(norm_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()

        # Try both known section keywords
        stackup_block = ""
        for keyword in ("stackup", "board_stackup"):
            stackup_block = self._extract_sexp_block(content, keyword)
            if stackup_block:
                _log.debug("KiMaster: found stackup block with keyword %r", keyword)
                break

        if not stackup_block:
            _log.debug("KiMaster: no stackup section in %r", board_path)
            return []

        return self._parse_layers_from_stackup_block(stackup_block)

    def _parse_layers_from_stackup_block(self, stackup_block: str) -> list:
        """Extract all (layer ...) entries from a stackup S-expression block."""
        layers = []
        pos    = 0
        while True:
            start = stackup_block.find("(layer ", pos)
            if start == -1:
                break
            block = self._extract_sexp_block(stackup_block[start:], "layer")
            if not block:
                pos = start + 6
                continue
            pos = start + len(block)
            try:
                layer = self._parse_stackup_layer_sexp(block)
                if layer:
                    layers.append(layer)
            except Exception as le:
                _log.debug("KiMaster: layer parse error: %s", le)
        return layers

    # ── Synthesize strategy ───────────────────────────────────────────────────

    def _stackup_synthesize(self, pcbnew, board) -> list:
        """
        Build a plausible stackup when the board has no explicit stackup section.
        Uses copper layer count + total board thickness from design settings.
        Assumes standard FR4 values (Dk 4.6, 1oz outer / 0.5oz inner).
        """
        ds             = board.GetDesignSettings()
        copper_count   = board.GetCopperLayerCount()
        total_mm       = round(pcbnew.ToMM(ds.GetBoardThickness()), 4)
        dielectric_count = copper_count - 1   # dielectric layers between copper

        # Copper thickness: 1oz outer, 0.5oz inner
        cu_outer_mm = 0.035
        cu_inner_mm = 0.0175
        total_copper = (
            2 * cu_outer_mm +
            max(0, copper_count - 2) * cu_inner_mm
        )
        mask_mm = 0.01
        total_mask = 2 * mask_mm

        # All remaining thickness goes to dielectrics split equally
        remaining = max(0.1, total_mm - total_copper - total_mask)
        diel_mm   = round(remaining / max(1, dielectric_count), 4)
        er        = 4.6

        layers = []
        layers.append(self._make_layer("silk", "F.Silkscreen", 0.01, "Ink",         0.0, 0.0))
        layers.append(self._make_layer("mask", "F.Mask",       mask_mm, "Solder Mask", 3.5, 0.0))

        # Enumerate KiCad copper layer names in order
        cu_names = self._get_copper_layer_names(board, copper_count)

        for i, cu_name in enumerate(cu_names):
            is_outer = (i == 0 or i == copper_count - 1)
            cu_t  = cu_outer_mm if is_outer else cu_inner_mm
            cu_oz = 1.0         if is_outer else 0.5
            layers.append(self._make_layer("copper", cu_name, cu_t, "Copper", 0.0, cu_oz))

            # Dielectric after each copper layer except the last
            if i < copper_count - 1:
                diel_name = f"Core" if copper_count == 2 else f"Dielectric {i + 1}"
                layers.append(self._make_layer("dielectric", diel_name, diel_mm, "FR4", er, 0.0))

        layers.append(self._make_layer("mask", "B.Mask",       mask_mm, "Solder Mask", 3.5, 0.0))
        layers.append(self._make_layer("silk", "B.Silkscreen", 0.01,    "Ink",         0.0, 0.0))
        return layers

    @staticmethod
    def _get_copper_layer_names(board, copper_count: int) -> list:
        """Return KiCad copper layer names in stackup order (F.Cu … B.Cu)."""
        try:
            import pcbnew as _pb
            names = []
            # Standard KiCad layer IDs: F.Cu=0, In1=1…In30=30, B.Cu=31
            layer_ids = [_pb.F_Cu] + list(range(1, copper_count - 1)) + [_pb.B_Cu]
            for lid in layer_ids:
                try:
                    names.append(str(board.GetLayerName(lid)))
                except Exception:
                    names.append(f"Layer{lid}")
            return names
        except Exception:
            # Fallback names
            if copper_count == 2:
                return ["F.Cu", "B.Cu"]
            inner = [f"In{i}.Cu" for i in range(1, copper_count - 1)]
            return ["F.Cu"] + inner + ["B.Cu"]

    @staticmethod
    def _extract_sexp_block(text: str, keyword: str) -> str:
        """
        Extract the first complete (keyword ...) S-expression block from text,
        correctly handling nested parentheses.
        """
        marker = f"({keyword}"
        start  = text.find(marker)
        if start == -1:
            # Also try with a leading space or newline
            for prefix in (" ", "\n", "\t"):
                idx = text.find(f"{prefix}({keyword}")
                if idx != -1:
                    start = idx + 1
                    break
        if start == -1:
            return ""

        depth = 0
        for i in range(start, len(text)):
            if text[i] == "(":
                depth += 1
            elif text[i] == ")":
                depth -= 1
                if depth == 0:
                    return text[start:i + 1]
        return ""

    @staticmethod
    def _parse_stackup_layer_sexp(block: str) -> dict:
        """
        Parse a single (layer "name" (type "...") (thickness N) ...) block.
        Returns a StackupLayer dict or None.
        """
        import re

        # Layer name — first quoted string after (layer
        name_m = re.search(r'\(layer\s+"([^"]+)"', block)
        name   = name_m.group(1) if name_m else ""

        def sexp_str(key):
            m = re.search(rf'\({key}\s+"([^"]+)"\)', block)
            return m.group(1) if m else ""

        def sexp_num(key):
            # KiCad 10 appends extra tokens after values, e.g. (thickness 0.1 locked)
            # so we match the number without requiring ) immediately after it.
            m = re.search(rf'\({key}\s+([\d.eE+\-]+)', block)
            return float(m.group(1)) if m else 0.0

        layer_type_raw = sexp_str("type").lower()
        thickness_mm   = round(sexp_num("thickness"), 6)
        material       = sexp_str("material")
        dk             = round(sexp_num("epsilon_r"), 4)

        # KiCad type strings → our layer_type constants
        if layer_type_raw == "copper":
            layer_type = "copper"
        elif layer_type_raw in ("core", "prepreg") or "dielectric" in layer_type_raw:
            layer_type = "dielectric"
        elif "mask" in layer_type_raw:
            layer_type = "mask"
        elif "silk" in layer_type_raw:
            layer_type = "silk"
        elif "paste" in layer_type_raw:
            layer_type = "paste"
        else:
            layer_type = "dielectric"

        # Skip layers with no thickness (pure logical layers like silkscreen w/ thickness=0)
        # but keep them — zero thickness is valid for non-physical layers
        copper_oz = round(thickness_mm / 0.035, 2) if layer_type == "copper" and thickness_mm > 0 else 0.0

        return {
            "layer_type":   layer_type,
            "name":         name or layer_type_raw or "Unknown",
            "thickness_mm": thickness_mm,
            "material":     material or ("FR4" if layer_type == "dielectric" else ""),
            "dk":           dk if dk > 0 else (4.6 if layer_type == "dielectric" else 0.0),
            "copper_oz":    copper_oz,
        }

    # ── Shared helpers ────────────────────────────────────────────────────────

    @staticmethod
    def _classify_layer_type(type_name: str) -> str:
        if "copper" in type_name:
            return "copper"
        if any(k in type_name for k in ("core", "prepreg", "dielectric")):
            return "dielectric"
        if "mask" in type_name:
            return "mask"
        if "silk" in type_name:
            return "silk"
        if "paste" in type_name:
            return "paste"
        return "dielectric"

    @staticmethod
    def _make_layer(layer_type, name, thickness_mm, material, dk, copper_oz) -> dict:
        return {
            "layer_type":   layer_type,
            "name":         name,
            "thickness_mm": thickness_mm,
            "material":     material or ("FR4" if layer_type == "dielectric" else ""),
            "dk":           dk if dk > 0 else (4.6 if layer_type == "dielectric" else 0.0),
            "copper_oz":    copper_oz,
        }

    def _on_get_net_info(self, data: dict) -> dict:
        """
        Compute analytics for a single net.
        Returns:
          { "net": str, "found": bool,
            "pad_count": int, "via_count": int, "track_count": int,
            "total_length_mm": float, "min_width_mm": float, "max_width_mm": float,
            "layers": [str], "connected_refs": [str], "error": str? }
        """
        net_name = data.get("net", "")
        if not net_name:
            return {"net": "", "found": False, "error": "Missing net name"}

        try:
            import pcbnew
            board   = pcbnew.GetBoard()
            net     = board.FindNet(net_name)
            if not net:
                return {"net": net_name, "found": False, "error": "Net not found"}

            net_code = net.GetNetCode()

            pad_count  = 0
            via_count  = 0
            track_count= 0
            total_len  = 0.0
            min_w      = float("inf")
            max_w      = 0.0
            layers     = set()
            refs       = set()

            for trk in board.GetTracks():
                if trk.GetNetCode() != net_code:
                    continue
                if trk.Type() == pcbnew.PCB_VIA_T:
                    via_count += 1
                else:
                    track_count += 1
                    try:
                        length_iu = trk.GetLength()
                        total_len += pcbnew.ToMM(length_iu)
                    except Exception:
                        pass
                    try:
                        width_mm = pcbnew.ToMM(trk.GetWidth())
                        if width_mm > 0:
                            min_w = min(min_w, width_mm)
                            max_w = max(max_w, width_mm)
                    except Exception:
                        pass
                    try:
                        layers.add(str(board.GetLayerName(trk.GetLayer())))
                    except Exception:
                        pass

            for fp in board.GetFootprints():
                fp_used = False
                for pad in fp.Pads():
                    if pad.GetNetCode() == net_code:
                        pad_count += 1
                        fp_used = True
                if fp_used:
                    refs.add(str(fp.GetReference()))

            if min_w == float("inf"):
                min_w = 0.0

            return {
                "net":            str(net_name),
                "found":          True,
                "pad_count":      pad_count,
                "via_count":      via_count,
                "track_count":    track_count,
                "total_length_mm": round(total_len, 4),
                "min_width_mm":   round(min_w, 4),
                "max_width_mm":   round(max_w, 4),
                "layers":         sorted(str(l) for l in layers),
                "connected_refs": sorted(str(r) for r in refs),
            }
        except Exception as e:
            _log.warning(f"KiMaster: get_net_info failed: {e}")
            return {"net": net_name, "found": False, "error": str(e)}

    def _on_clear_highlight(self):
        try:
            import pcbnew
            pcbnew.GetBoard().SetHighLight(False)
            pcbnew.Refresh()
        except Exception as e:
            _log.warning(f"KiMaster: clear_highlight failed: {e}")

    # ── Poll interval control ────────────────────────────────────────────────

    def _on_get_poll_intervals(self) -> dict:
        """Return current poll intervals for both watchers."""
        return {
            "selection_poll_ms": self._selection_watcher.poll_ms if self._selection_watcher else 500,
            "board_poll_ms":     self._board_watcher.poll_ms if self._board_watcher else 1000,
        }

    def _on_set_poll_intervals(self, data: dict) -> dict:
        """
        Adjust watcher poll intervals at runtime.
        Accepts: { "selection_poll_ms": int?, "board_poll_ms": int? }
        Values are clamped to safe ranges by each watcher's setter.
        """
        result = {}
        if "selection_poll_ms" in data and self._selection_watcher:
            self._selection_watcher.poll_ms = int(data["selection_poll_ms"])
            result["selection_poll_ms"] = self._selection_watcher.poll_ms
            _log.info("SelectionWatcher poll_ms set to %d", self._selection_watcher.poll_ms)

        if "board_poll_ms" in data and self._board_watcher:
            self._board_watcher.poll_ms = int(data["board_poll_ms"])
            result["board_poll_ms"] = self._board_watcher.poll_ms
            _log.info("BoardChangeWatcher poll_ms set to %d", self._board_watcher.poll_ms)

        # Return current state of both
        result.setdefault("selection_poll_ms",
                          self._selection_watcher.poll_ms if self._selection_watcher else 500)
        result.setdefault("board_poll_ms",
                          self._board_watcher.poll_ms if self._board_watcher else 1000)
        return result

    # ── Phase 5 write handlers ─────────────────────────────────────────────

    def _on_move_component(self, data: dict) -> dict:
        ref  = data.get("ref", "")
        x_mm = data.get("x_mm")
        y_mm = data.get("y_mm")
        if not ref or x_mm is None or y_mm is None:
            return {"success": False, "message": "Missing ref, x_mm, or y_mm"}
        try:
            import pcbnew
            board = pcbnew.GetBoard()
            fp = board.FindFootprintByReference(ref)
            if not fp:
                return {"success": False, "message": f"Footprint '{ref}' not found"}
            x_iu = pcbnew.FromMM(float(x_mm))
            y_iu = pcbnew.FromMM(float(y_mm))
            fp.SetPosition(pcbnew.VECTOR2I(x_iu, y_iu))
            board.Save(board.GetFileName())
            pcbnew.Refresh()
            self.notify_board_changed()
            return {"success": True, "message": f"Moved {ref} to ({x_mm}, {y_mm}) mm"}
        except Exception as e:
            _log.warning(f"KiMaster: move_component failed: {e}")
            return {"success": False, "message": str(e)}

    def _on_rotate_component(self, data: dict) -> dict:
        ref       = data.get("ref", "")
        angle_deg = data.get("angle_deg")
        if not ref or angle_deg is None:
            return {"success": False, "message": "Missing ref or angle_deg"}
        try:
            import pcbnew
            board = pcbnew.GetBoard()
            fp = board.FindFootprintByReference(ref)
            if not fp:
                return {"success": False, "message": f"Footprint '{ref}' not found"}
            fp.SetOrientation(pcbnew.EDA_ANGLE(float(angle_deg), pcbnew.DEGREES_T))
            board.Save(board.GetFileName())
            pcbnew.Refresh()
            self.notify_board_changed()
            return {"success": True, "message": f"Rotated {ref} to {angle_deg}deg"}
        except Exception as e:
            _log.warning(f"KiMaster: rotate_component failed: {e}")
            return {"success": False, "message": str(e)}

    def _on_set_locked(self, data: dict) -> dict:
        ref    = data.get("ref", "")
        locked = data.get("locked")
        if not ref or locked is None:
            return {"success": False, "message": "Missing ref or locked"}
        try:
            import pcbnew
            fp = pcbnew.GetBoard().FindFootprintByReference(ref)
            if not fp:
                return {"success": False, "message": f"Footprint '{ref}' not found"}
            fp.SetLocked(bool(locked))
            pcbnew.GetBoard().Save(pcbnew.GetBoard().GetFileName())
            pcbnew.Refresh()
            self.notify_board_changed()
            return {"success": True, "message": f"{ref} locked={locked}"}
        except Exception as e:
            _log.warning(f"KiMaster: set_locked failed: {e}")
            return {"success": False, "message": str(e)}

    def _on_set_dnp(self, data: dict) -> dict:
        ref = data.get("ref", "")
        dnp = data.get("dnp")
        if not ref or dnp is None:
            return {"success": False, "message": "Missing ref or dnp"}
        try:
            import pcbnew
            fp = pcbnew.GetBoard().FindFootprintByReference(ref)
            if not fp:
                return {"success": False, "message": f"Footprint '{ref}' not found"}
            fp.SetDNP(bool(dnp))
            pcbnew.GetBoard().Save(pcbnew.GetBoard().GetFileName())
            pcbnew.Refresh()
            self.notify_board_changed()
            return {"success": True, "message": f"{ref} dnp={dnp}"}
        except Exception as e:
            _log.warning(f"KiMaster: set_dnp failed: {e}")
            return {"success": False, "message": str(e)}

    # ── Phase 12 A8: regenerate copper zones ─────────────────────────────
    def _on_regenerate_zones(self, data: dict) -> dict:
        import time
        try:
            import pcbnew
            board = pcbnew.GetBoard()
        except Exception as e:
            return {"success": False, "message": f"pcbnew unavailable: {e}",
                    "zone_count": 0, "filled_count": 0, "elapsed_ms": 0}

        filter_layer = (data.get("filter_layer") or "").strip()
        filter_net   = (data.get("filter_net")   or "").strip()
        check_fill   = bool(data.get("check_fill", True))

        try:
            all_zones = list(board.Zones())
        except Exception as e:
            return {"success": False, "message": f"Zones() failed: {e}",
                    "zone_count": 0, "filled_count": 0, "elapsed_ms": 0}

        zone_count = len(all_zones)
        if zone_count == 0:
            return {"success": True, "message": "No zones on board",
                    "zone_count": 0, "filled_count": 0, "elapsed_ms": 0}

        targets = []
        for z in all_zones:
            if filter_layer:
                try:
                    layer_name = str(board.GetLayerName(z.GetLayer()))
                    if layer_name != filter_layer:
                        continue
                except Exception:
                    pass
            if filter_net:
                try:
                    net = z.GetNet()
                    if net is None or str(net.GetNetname()) != filter_net:
                        continue
                except Exception:
                    pass
            targets.append(z)

        if not targets:
            return {"success": True,
                    "message": f"No zones match filter (layer={filter_layer or '*'}, net={filter_net or '*'})",
                    "zone_count": zone_count, "filled_count": 0, "elapsed_ms": 0}

        t0 = time.perf_counter()
        try:
            filler = pcbnew.ZONE_FILLER(board)
            filler.Fill(targets, check_fill, False)
            board.Save(board.GetFileName())
            pcbnew.Refresh()
            self.notify_board_changed()
        except Exception as e:
            _log.warning(f"KiMaster: regenerate_zones failed: {e}")
            return {"success": False, "message": str(e),
                    "zone_count": zone_count, "filled_count": 0,
                    "elapsed_ms": int((time.perf_counter() - t0) * 1000)}

        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        return {
            "success": True,
            "message": f"Refilled {len(targets)} of {zone_count} zones",
            "zone_count":   zone_count,
            "filled_count": len(targets),
            "elapsed_ms":   elapsed_ms,
        }

    # ── Phase 12 A9 / QA5: prune orphan vias ─────────────────────────────
    def _on_purge_orphan_vias(self, data: dict) -> dict:
        import time
        try:
            import pcbnew
            board = pcbnew.GetBoard()
        except Exception as e:
            return {"success": False, "message": f"pcbnew unavailable: {e}",
                    "via_total": 0, "orphan_count": 0, "removed": 0,
                    "dry_run": True, "orphans": [], "elapsed_ms": 0}

        dry_run    = bool(data.get("dry_run", True))
        filter_net = (data.get("filter_net") or "").strip()

        t0 = time.perf_counter()

        try:
            all_tracks = list(board.GetTracks())
        except Exception as e:
            return {"success": False, "message": f"GetTracks() failed: {e}",
                    "via_total": 0, "orphan_count": 0, "removed": 0,
                    "dry_run": dry_run, "orphans": [], "elapsed_ms": 0}

        from collections import defaultdict
        track_endpoints = defaultdict(list)
        via_total = 0
        vias = []

        for item in all_tracks:
            try:
                if item.Type() == pcbnew.PCB_VIA_T:
                    via_total += 1
                    vias.append(item)
                else:
                    nc  = item.GetNetCode()
                    lay = item.GetLayer()
                    track_endpoints[(nc, lay)].append(item.GetStart())
                    track_endpoints[(nc, lay)].append(item.GetEnd())
            except Exception:
                continue

        pad_positions = defaultdict(list)
        try:
            for fp in board.GetFootprints():
                for pad in fp.Pads():
                    pad_positions[pad.GetNetCode()].append(
                        (pad.GetPosition(), pad.GetLayerSet())
                    )
        except Exception:
            pass

        def has_endpoint(net_code, layer, pos, tol_iu=2000):
            x, y = pos.x, pos.y
            for ep in track_endpoints.get((net_code, layer), []):
                if abs(ep.x - x) <= tol_iu and abs(ep.y - y) <= tol_iu:
                    return True
            return False

        def has_pad_at(net_code, pos):
            try:
                for fp in board.GetFootprints():
                    for pad in fp.Pads():
                        if pad.GetNetCode() != net_code:
                            continue
                        try:
                            if pad.HitTest(pos):
                                return True
                        except Exception:
                            pass
            except Exception:
                pass
            return False

        orphans = []
        orphan_objs = []
        for via in vias:
            try:
                nc = via.GetNetCode()
                if filter_net:
                    net_obj = via.GetNet()
                    if net_obj is None or str(net_obj.GetNetname()) != filter_net:
                        continue

                top_lay = via.TopLayer()
                bot_lay = via.BottomLayer()
                pos     = via.GetPosition()

                if has_endpoint(nc, top_lay, pos) or has_endpoint(nc, bot_lay, pos):
                    continue
                if has_pad_at(nc, pos):
                    continue

                try:
                    top_name = str(board.GetLayerName(top_lay))
                    bot_name = str(board.GetLayerName(bot_lay))
                except Exception:
                    top_name, bot_name = "?", "?"
                try:
                    net_name = str(via.GetNet().GetNetname()) if via.GetNet() else ""
                except Exception:
                    net_name = ""
                orphans.append({
                    "x_mm": pcbnew.ToMM(pos.x),
                    "y_mm": pcbnew.ToMM(pos.y),
                    "net":  net_name,
                    "top":  top_name,
                    "bot":  bot_name,
                })
                orphan_objs.append(via)
            except Exception as e:
                _log.debug(f"KiMaster: via check failed: {e}")

        removed = 0
        if not dry_run and orphan_objs:
            try:
                for via in orphan_objs:
                    board.Remove(via)
                    removed += 1
                board.Save(board.GetFileName())
                pcbnew.Refresh()
                self.notify_board_changed()
            except Exception as e:
                _log.warning(f"KiMaster: via removal failed: {e}")
                return {
                    "success": False, "message": f"Removal failed: {e}",
                    "via_total": via_total, "orphan_count": len(orphans),
                    "removed": removed, "dry_run": False, "orphans": orphans,
                    "elapsed_ms": int((time.perf_counter() - t0) * 1000),
                }

        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        if dry_run:
            msg = f"Found {len(orphans)} orphan via{'s' if len(orphans) != 1 else ''} (dry run)"
        else:
            msg = f"Removed {removed} of {len(orphans)} orphan via{'s' if len(orphans) != 1 else ''}"

        return {
            "success":      True,
            "message":      msg,
            "via_total":    via_total,
            "orphan_count": len(orphans),
            "removed":      removed,
            "dry_run":      dry_run,
            "orphans":      orphans[:200],
            "elapsed_ms":   elapsed_ms,
        }

    # ── Board-ops handlers (delegate to ops/ package) ─────────────────────

    def _on_via_stitch(self, data: dict) -> dict:
        _log.debug("KiMaster: via_stitch invoked, dry_run=%s net=%r",
                   data.get("dry_run"), data.get("net"))
        try:
            import pcbnew
            board = pcbnew.GetBoard()
        except Exception as e:
            _log.warning("KiMaster: via_stitch — pcbnew unavailable: %s", e)
            return {"success": False, "message": f"pcbnew unavailable: {e}",
                    "placed": 0, "skipped": 0, "preview": [], "elapsed_ms": 0}
        resp = ViaStitch(board, self.notify_board_changed).execute(data)
        _log.debug("KiMaster: via_stitch result success=%s placed=%s skipped=%s preview=%d",
                   resp.get("success"), resp.get("placed"), resp.get("skipped"),
                   len(resp.get("preview") or []))
        return resp

    def _on_apply_teardrops(self, data: dict) -> dict:
        try:
            import pcbnew
            board = pcbnew.GetBoard()
        except Exception as e:
            return {"success": False, "message": f"pcbnew unavailable: {e}",
                    "applied_count": 0, "removed_count": 0,
                    "kicad_api_used": "unavailable", "elapsed_ms": 0}
        return Teardrops(board, self.notify_board_changed).execute_apply(data)

    def _on_remove_teardrops(self, data: dict) -> dict:
        try:
            import pcbnew
            board = pcbnew.GetBoard()
        except Exception as e:
            return {"success": False, "message": f"pcbnew unavailable: {e}",
                    "applied_count": 0, "removed_count": 0,
                    "kicad_api_used": "unavailable", "elapsed_ms": 0}
        return Teardrops(board, self.notify_board_changed).execute_remove(data)

    def _on_panelize_board(self, data: dict) -> dict:
        try:
            import pcbnew
            board = pcbnew.GetBoard()
        except Exception as e:
            return {"success": False, "message": f"pcbnew unavailable: {e}",
                    "panel_width_mm": 0, "panel_height_mm": 0, "board_count": 0,
                    "output_path": "", "preview_outline": [], "elapsed_ms": 0}
        return Panelize(board, self.notify_board_changed).execute(data)
