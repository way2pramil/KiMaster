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

_PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
_ICON_PATH  = os.path.join(_PLUGIN_DIR, "resources", "icon.png")

# Cached class + instance refs (module-level to survive GC)
_PluginClass    = None
_plugin_instance = None


def create_and_register():
    """
    Build the ActionPlugin subclass (once), instantiate, and register
    with KiCad.  Safe to call multiple times — returns the same instance.

    Must be called from inside KiCad where ``import pcbnew`` succeeds.
    The ``__init__.py`` entry-point guards this with a try/except.
    """
    global _PluginClass, _plugin_instance

    if _plugin_instance is not None:
        return _plugin_instance

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
                    "Opens a local WebSocket server (port 40001) for "
                    "real-time board sync with the KiMaster desktop app."
                )
                self.show_toolbar_button = True
                self.icon_file_name = (
                    _ICON_PATH if os.path.exists(_ICON_PATH) else ""
                )
                self.dark_icon_file_name = self.icon_file_name

            def Run(self):
                """Called when the user activates the plugin."""
                _run_plugin(self)

        _PluginClass = KiMasterActionPlugin

    # Normal instantiation path: __init__() -> defaults() -> self.name set
    _plugin_instance = _PluginClass()
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


# ── Run logic (kept outside the class to reduce nested indentation) ────────

def _run_plugin(self):
    """Core logic executed when the user clicks the toolbar button."""
    import pcbnew as _pb

    # If already running — notify the user and re-broadcast board state
    if self._km_ws_server is not None and self._km_ws_server.is_running():
        _log.info("KiMaster bridge already running — broadcasting board state")
        self._km_ws_server.broadcast_board_state()
        _notify(
            f"KiMaster bridge is already active on port {self._km_ws_server.port}.\n"
            "Board state refreshed."
        )
        return

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
        _notify(
            "Missing dependency: websockets\n\n"
            "Install via KiCad's Python:\n"
            '  "C:\\Program Files\\KiCad\\10.0\\bin\\python.exe" -m pip install websockets',
            is_error=True,
        )
        return

    board = _pb.GetBoard()
    _log.info("KiMaster: GetBoard() returned %s", board)

    self._km_exporter = BoardExporter()
    self._km_exporter.attach_board(board)

    self._km_ws_server = KiMasterWsServer(self._km_exporter)
    self._km_ws_server.start()

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
