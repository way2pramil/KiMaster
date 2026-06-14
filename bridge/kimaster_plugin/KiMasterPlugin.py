"""
KiMaster KiCad Action Plugin.

Subclasses pcbnew.ActionPlugin. When activated from KiCad's toolbar
or Tools -> External Plugins menu, starts the local WebSocket server
on ws://127.0.0.1:40001 and broadcasts live board events to KiMaster.

KiCad 9.0+ required (pcbnew.ActionPlugin API).

The class is built inside a factory function so that this file can be
imported from tests / standalone tools that don't have pcbnew installed.
"""

import logging
import os

_log = logging.getLogger("kimaster.plugin")

_PLUGIN_DIR   = os.path.dirname(os.path.abspath(__file__))
_ICON_PATH    = os.path.join(_PLUGIN_DIR, "resources", "icon.png")
_ICON_PATH_2X = os.path.join(_PLUGIN_DIR, "resources", "icon@2x.png")

# Cached class + instance refs (module-level to survive GC)
_PluginClass    = None
_plugin_instance = None


def create_and_register():
    """
    Build the ActionPlugin subclass (once), instantiate, and register
    with KiCad.  Safe to call multiple times — returns the same instance.

    Must be called from inside KiCad where ``import pcbnew`` succeeds.
    The ``__init__.py`` entry-point guards this with a try/except.

    The running server reference is stored on the ``pcbnew`` module so it
    survives ``importlib.reload()`` of *this* module.  Without this, each
    rescan/reinstall resets the module-level globals, leaves the old server
    bound to port 40001, and causes a new server to bind 40002 — resulting
    in two duplicate bridge instances.
    """
    global _PluginClass, _plugin_instance

    if _plugin_instance is not None:
        return _plugin_instance

    # ── Cross-reload server recovery ─────────────────────────────────────
    # After importlib.reload() the module globals are reset, so
    # _plugin_instance = None above.  But the OLD instance's WS server is
    # still running (holding its port).  We stash the server on the pcbnew
    # module (which persists across reloads) so we can recover it here.
    import pcbnew as _pb
    _ATTR  = "_kimaster_active_server"
    _orphan = getattr(_pb, _ATTR, None)

    import pcbnew

    if _PluginClass is None:

        class KiMasterActionPlugin(pcbnew.ActionPlugin):
            """Real ActionPlugin subclass — KiCad 9 / 10+ compatible."""

            # Per-instance runtime state
            _km_ws_server       = None
            _km_exporter        = None
            _km_watcher         = None   # SelectionWatcher
            _km_board_watcher   = None   # BoardChangeWatcher

            # ----------------------------------------------------------
            # ActionPlugin lifecycle
            # ----------------------------------------------------------

            def defaults(self):
                """Called by ActionPlugin.__init__ to set display metadata."""
                self.name        = "KiMaster Bridge"
                self.category    = "KiMaster"
                self.description = (
                    "Opens a local WebSocket server (port auto-discovered "
                    "40001–40010) for real-time board sync with KiMaster."
                )
                self.show_toolbar_button = True
                # Use KiMaster brand icon (24x24 PNG with transparent background).
                # KiCad uses icon_file_name for light theme, dark_icon_file_name
                # for dark theme.  We use the same icon for both since the
                # KiMaster logo works on either background.
                self.icon_file_name      = _ICON_PATH    if os.path.exists(_ICON_PATH)    else ""
                self.dark_icon_file_name = _ICON_PATH    if os.path.exists(_ICON_PATH)    else ""

            def Run(self):
                """Called when the user activates the plugin."""
                _run_plugin(self)

        _PluginClass = KiMasterActionPlugin

    _plugin_instance = _PluginClass()

    # ── Reattach orphaned server ──────────────────────────────────────────
    # If the module was reloaded (Rescan Plugins / reinstall), the previous
    # instance's server is still alive.  Reattach it to the new instance so
    # we don't create a second server on a different port.
    if _orphan is not None and _orphan.is_running():
        _plugin_instance._km_ws_server = _orphan
        _log.info(
            "KiMaster: reattached orphaned server on port %d after module reload",
            _orphan.port,
        )

    _plugin_instance.register()
    _log.info("KiMaster bridge plugin registered with KiCad")
    return _plugin_instance


# ── Helpers ─────────────────────────────────────────────────────────────────

def _notify(message, caption="KiMaster", is_error=False):
    """
    Show a user-visible notification inside KiCad.

    KiCad 9 exposed ``pcbnew.ShowInfoBarMsg()``; KiCad 10 removed it.
    We fall back to ``wx.MessageBox`` (always available inside KiCad)
    and log regardless.
    """
    if is_error:
        _log.error(message)
    else:
        _log.info(message)
    try:
        import pcbnew as _pb
        if hasattr(_pb, "ShowInfoBarMsg"):
            _pb.ShowInfoBarMsg(message)
            return
    except Exception:
        pass
    try:
        import wx
        style = (wx.OK | wx.ICON_ERROR) if is_error else (wx.OK | wx.ICON_INFORMATION)
        wx.MessageBox(message, caption, style)
    except Exception:
        pass  # Last resort — already logged above


def _ask_stop_or_refresh(port: int, client_count: int) -> str:
    """
    Show a wx dialog asking the user whether to Stop or Refresh the bridge.
    Returns "stop" or "refresh".  Falls back to "refresh" if wx is unavailable.
    """
    try:
        import wx
        client_info = (
            f"{client_count} client{'s' if client_count != 1 else ''} connected"
            if client_count > 0
            else "no clients connected"
        )
        dlg = wx.MessageDialog(
            None,
            f"KiMaster bridge is running on port {port} ({client_info}).\n\n"
            "• Stop  — closes the WebSocket server and frees the port.\n"
            "• Refresh — broadcast updated board state to connected clients.",
            "KiMaster Bridge",
            wx.YES_NO | wx.CANCEL | wx.ICON_QUESTION
            | wx.YES_DEFAULT,
        )
        dlg.SetYesNoLabels("Stop server", "Refresh board state")
        result = dlg.ShowModal()
        dlg.Destroy()
        if result == wx.ID_YES:
            return "stop"
        return "refresh"
    except Exception:
        # No wx / headless → default to refresh (safe)
        return "refresh"


def _stop_bridge(self):
    """
    Gracefully stop all bridge components: watchers, WS server, title bar.
    Clears the pcbnew-level registry so a fresh start works cleanly.
    """
    port = getattr(self._km_ws_server, "port", "?") if self._km_ws_server else "?"

    for watcher in (self._km_watcher, self._km_board_watcher):
        try:
            if watcher is not None:
                watcher.stop()
        except Exception as e:
            _log.debug("KiMaster: watcher stop error: %s", e)
    self._km_watcher       = None
    self._km_board_watcher = None

    if self._km_ws_server is not None:
        try:
            self._km_ws_server.stop()
        except Exception as e:
            _log.debug("KiMaster: server stop error: %s", e)
        self._km_ws_server = None

    # Clear pcbnew-level registry
    try:
        import pcbnew as _pb
        setattr(_pb, "_kimaster_active_server", None)
    except Exception:
        pass

    # Reset KiCad title bar
    try:
        import wx
        wx.CallAfter(_clear_kicad_title)
    except Exception:
        pass

    _log.info("KiMaster bridge stopped (was on port %s)", port)
    _notify(
        f"KiMaster bridge stopped.\n"
        f"Port {port} is now closed — no external access possible."
    )


def _clear_kicad_title():
    """Remove the KiMaster status suffix from the KiCad window title."""
    try:
        import wx
        for w in wx.GetTopLevelWindows():
            title = w.GetTitle()
            if " — KiMaster" in title:
                w.SetTitle(title[: title.index(" — KiMaster")])
            break
    except Exception:
        pass


# ── Run logic (kept outside the class to reduce nested indentation) ────────

def _run_plugin(self):
    """Core logic executed when the user clicks the toolbar button."""
    import pcbnew as _pb

    _ATTR = "_kimaster_active_server"

    # ── If already running: offer Stop / Refresh choice ─────────────────
    if self._km_ws_server is not None and self._km_ws_server.is_running():
        port    = self._km_ws_server.port
        clients = self._km_ws_server.client_count
        choice  = _ask_stop_or_refresh(port, clients)

        if choice == "stop":
            _stop_bridge(self)
            return
        else:
            # Refresh — broadcast fresh board state
            _log.info("KiMaster bridge refresh requested")
            self._km_ws_server.broadcast_board_state()
            _notify(
                f"KiMaster bridge is active on port {port}.\n"
                f"Board state refreshed ({clients} client(s) connected)."
            )
            return

    # Check for an orphaned server from a previous module load that somehow
    # wasn't caught at create_and_register time.
    _orphan = getattr(_pb, _ATTR, None)
    if _orphan is not None and _orphan is not self._km_ws_server and _orphan.is_running():
        _log.warning(
            "KiMaster: found orphaned server on port %d — stopping it before starting a new one",
            _orphan.port,
        )
        _orphan.stop()
        setattr(_pb, _ATTR, None)

    # Also stop our own stale server (died but not cleaned up)
    if self._km_ws_server is not None and not self._km_ws_server.is_running():
        self._km_ws_server.stop()
        self._km_ws_server = None

    try:
        from .BoardExporter import BoardExporter
        from .WsServer import KiMasterWsServer
        from .SelectionWatcher import SelectionWatcher
        from .BoardChangeWatcher import BoardChangeWatcher
    except ImportError as e:
        _log.error("KiMaster: import error: %s", e)
        _notify("KiMaster error: {}".format(e), is_error=True)
        return

    # Pre-check: websockets is required for the WS server
    try:
        import websockets  # noqa: F401
    except ImportError:
        import sys
        if sys.platform == "win32":
            hint = '  "C:\\Program Files\\KiCad\\10.0\\bin\\python.exe" -m pip install websockets'
        elif sys.platform == "darwin":
            hint = "  /Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3 -m pip install websockets"
        else:
            hint = "  python3 -m pip install websockets   (use KiCad's bundled Python if available)"
        _notify(
            "Missing dependency: websockets\n\n"
            "Install via KiCad's Python:\n" + hint,
            is_error=True,
        )
        return

    board = _pb.GetBoard()
    _log.info("KiMaster: GetBoard() returned %s", board)

    self._km_exporter = BoardExporter()
    self._km_exporter.attach_board(board)

    from .SchematicExporter import SchematicExporter
    sch_exporter = SchematicExporter()
    sch_exporter.attach_pcb_path(str(board.GetFileName()))

    self._km_ws_server = KiMasterWsServer(self._km_exporter, sch_exporter)
    self._km_ws_server.start()

    # Store in pcbnew module so it survives importlib.reload() of this module
    import pcbnew as _pb2
    setattr(_pb2, "_kimaster_active_server", self._km_ws_server)

    # Selection watcher — polls KiCad selection, broadcasts changes
    self._km_watcher = SelectionWatcher(self._km_ws_server, poll_ms=500)
    self._km_watcher.start()

    # Board change watcher — polls board fingerprint, broadcasts board_state on change
    self._km_board_watcher = BoardChangeWatcher(self._km_ws_server, poll_ms=1000)
    self._km_board_watcher.start()

    # Give the WS server references to watchers so it can adjust poll intervals
    self._km_ws_server.set_watchers(self._km_watcher, self._km_board_watcher)

    actual_port = self._km_ws_server.port
    _notify(
        f"KiMaster bridge started on ws://127.0.0.1:{actual_port} — "
        f"connect from the KiMaster app."
    )
    _log.info(
        f"KiMaster bridge plugin started on port {actual_port} "
        f"(selection poll=500ms, board poll=1000ms)"
    )
