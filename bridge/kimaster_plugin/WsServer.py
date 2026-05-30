"""
KiMaster WebSocket server — runs inside KiCad's Python environment.

Protocol (JSON messages):

  Client → Server:
    { "type": "hello",              "client": "kimaster", "version": "0.1.0" }
    { "type": "get_board_state" }
    { "type": "highlight_component","data": { "ref": "U1" } }
    { "type": "highlight_net",      "data": { "net": "GND" } }
    { "type": "clear_highlight" }
    { "type": "ping" }

  Server → Client:
    { "type": "hello_ack",       "version": "0.1.0", "board": "...", "kicad_version": "10.0.1",
                                 "client_count": int }
    { "type": "board_state",     "data": { ... }  }
    { "type": "board_changed"                      }
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
import threading
from typing import Optional, Set

_log = logging.getLogger("kimaster.ws")

KIMASTER_HOST    = "127.0.0.1"
KIMASTER_PORT    = 40001
KIMASTER_VERSION = "0.1.0"


class KiMasterWsServer:
    """Manages the asyncio WebSocket server in a dedicated background thread."""

    def __init__(self, board_exporter):
        self._exporter = board_exporter
        self._clients: Set = set()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._selection_watcher = None
        self._board_watcher = None

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
        _log.info(f"KiMaster WS server starting on ws://{KIMASTER_HOST}:{KIMASTER_PORT}")

    def stop(self):
        """Stop the WS server and background thread."""
        self._running = False
        if self._loop and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(self._loop.stop)
        if self._thread:
            self._thread.join(timeout=3)
        _log.info("KiMaster WS server stopped")

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

        try:
            async with websockets.serve(
                self._handler,
                KIMASTER_HOST,
                KIMASTER_PORT,
                ping_interval=20,
                ping_timeout=10,
            ):
                _log.info(f"KiMaster WS server listening on {KIMASTER_HOST}:{KIMASTER_PORT}")
                await asyncio.Future()  # run until loop is stopped
        except OSError as e:
            _log.error(
                f"KiMaster WS server failed to bind to port {KIMASTER_PORT}: {e}\n"
                "Is another KiMaster bridge already running?"
            )

    async def _broadcast_async(self, data: str):
        dead: Set = set()
        for ws in list(self._clients):
            try:
                await ws.send(data)
            except Exception:
                dead.add(ws)
        self._clients -= dead

    async def _handler(self, websocket):
        """Handle a single connected client."""
        self._clients.add(websocket)
        _log.info(f"KiMaster: client connected ({self.client_count} total)")

        # Notify KiCad about client count change
        self._update_kicad_status()

        try:
            # Send full board state immediately on connect
            try:
                state = self._exporter.get_board_state()
                await websocket.send(json.dumps({"type": "board_state", "data": state}))
                _log.info(
                    "KiMaster: sent initial board state (%d components, %d nets)",
                    len(state.get("components", [])),
                    len(state.get("nets", [])),
                )
            except Exception as e:
                _log.warning(f"KiMaster: initial board state send failed: {e}")
                import traceback
                _log.warning(traceback.format_exc())
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": f"Board state error: {e}",
                }))

            # Message loop
            async for raw in websocket:
                await self._handle_message(websocket, raw)
        except Exception as e:
            _log.debug(f"KiMaster WS handler: {e}")
        finally:
            self._clients.discard(websocket)
            _log.info(f"KiMaster: client disconnected ({self.client_count} remaining)")
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

        if msg_type == "hello":
            await self._on_hello(websocket, msg)
        elif msg_type == "get_board_state":
            await self._on_get_board_state(websocket)
        elif msg_type == "highlight_component":
            self._on_highlight_component(msg.get("data", {}))
        elif msg_type == "highlight_net":
            self._on_highlight_net(msg.get("data", {}))
        elif msg_type == "get_net_info":
            info = self._on_get_net_info(msg.get("data", {}))
            await websocket.send(json.dumps({"type": "net_info", "data": info}))
        elif msg_type == "regenerate_zones":
            resp = self._on_regenerate_zones(msg.get("data", {}))
            await websocket.send(json.dumps({"type": "op_result", "op": "regenerate_zones", **resp}))
        elif msg_type == "purge_orphan_vias":
            resp = self._on_purge_orphan_vias(msg.get("data", {}))
            await websocket.send(json.dumps({"type": "op_result", "op": "purge_orphan_vias", **resp}))
        elif msg_type == "clear_highlight":
            self._on_clear_highlight()
        elif msg_type == "ping":
            await websocket.send(json.dumps({"type": "pong"}))
        elif msg_type == "set_poll_intervals":
            resp = self._on_set_poll_intervals(msg.get("data", {}))
            await websocket.send(json.dumps({"type": "poll_intervals", "data": resp}))
        elif msg_type == "get_poll_intervals":
            resp = self._on_get_poll_intervals()
            await websocket.send(json.dumps({"type": "poll_intervals", "data": resp}))
        # ── Phase 5 write commands (all require human-in-the-loop approval on JS side) ──
        elif msg_type == "move_component":
            resp = self._on_move_component(msg.get("data", {}))
            await websocket.send(json.dumps({"type": "op_result", "op": "move_component", **resp}))
        elif msg_type == "rotate_component":
            resp = self._on_rotate_component(msg.get("data", {}))
            await websocket.send(json.dumps({"type": "op_result", "op": "rotate_component", **resp}))
        elif msg_type == "set_locked":
            resp = self._on_set_locked(msg.get("data", {}))
            await websocket.send(json.dumps({"type": "op_result", "op": "set_locked", **resp}))
        elif msg_type == "set_dnp":
            resp = self._on_set_dnp(msg.get("data", {}))
            await websocket.send(json.dumps({"type": "op_result", "op": "set_dnp", **resp}))
        else:
            _log.debug(f"KiMaster: unhandled message type '{msg_type}'")

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

        await websocket.send(json.dumps({
            "type":          "hello_ack",
            "version":       KIMASTER_VERSION,
            "kicad_version": kicad_ver,
            "board":         str(self._exporter.get_board_name()),
            "client_count":  self.client_count,
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
