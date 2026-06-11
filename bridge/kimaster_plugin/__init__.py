"""
KiMaster Bridge Plugin — KiCad 9.0+ ActionPlugin.

Installation directory:
  Windows:  %APPDATA%\\kicad\\10.0\\scripting\\plugins\\kimaster_plugin\\
  macOS:    ~/Library/Preferences/kicad/10.0/scripting/plugins/kimaster_plugin/
  Linux:    ~/.local/share/kicad/10.0/scripting/plugins/kimaster_plugin/

The KiMaster app auto-installs this plugin via cmd_install_bridge_plugin IPC.
"""

import logging
import os
import sys

_log = logging.getLogger("kimaster")

# ── Force fresh submodule imports on every (re)load ──────────────────────────
# KiCad's "Refresh Plugins" / a fresh "Reinstall plugin" re-executes this
# __init__, but `from .WsServer import ...` / `from .ops import ...` below
# resolve from `sys.modules` first — so once KiCad has loaded this package,
# overwriting the .py files on disk and refreshing has NO effect: the cached
# old submodule objects keep running. Evict every kimaster_plugin.* submodule
# (but not the package itself — needed for relative-import resolution) so the
# imports below always re-read from disk.
_PKG = __name__
for _mod_name in [m for m in sys.modules if m.startswith(_PKG + ".")]:
    del sys.modules[_mod_name]

# ── Debug log file ────────────────────────────────────────────────────────────
# KiCad's embedded interpreter has no visible stdout/stderr on Windows GUI
# builds, so `_log.debug`/`_log.info` calls throughout this package would
# otherwise vanish silently. Attach a DEBUG-level file handler here, on the
# shared "kimaster" logger — every submodule logger ("kimaster.ws",
# "kimaster.plugin", ...) propagates up to it. Guarded so KiCad's
# Tools -> Refresh Plugins (which re-imports this module) doesn't stack
# duplicate handlers.
_LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "kimaster_debug.log")
if not any(isinstance(h, logging.FileHandler) and h.baseFilename == _LOG_PATH
           for h in _log.handlers):
    try:
        _handler = logging.FileHandler(_LOG_PATH, mode="a", encoding="utf-8")
        _handler.setFormatter(logging.Formatter(
            "%(asctime)s %(levelname)-7s %(name)s: %(message)s"))
        _log.addHandler(_handler)
        _log.setLevel(logging.DEBUG)
        _log.info("KiMaster debug log attached at %s", _LOG_PATH)
    except OSError as e:
        _log.warning("KiMaster: could not open debug log file '%s': %s", _LOG_PATH, e)

# Only register when running inside KiCad (pcbnew available)
try:
    import pcbnew  # noqa: F401  (raises ImportError outside KiCad)
    from .KiMasterPlugin import create_and_register
    create_and_register()
except ImportError:
    pass  # Normal when imported outside KiCad — no pcbnew available
except Exception as e:
    _log.warning("KiMaster plugin registration error: %s", e)
