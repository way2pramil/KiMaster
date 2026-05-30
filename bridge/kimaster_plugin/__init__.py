"""
KiMaster Bridge Plugin — KiCad 9.0+ ActionPlugin.

Installation directory:
  Windows:  %APPDATA%\\kicad\\10.0\\scripting\\plugins\\kimaster_plugin\\
  macOS:    ~/Library/Preferences/kicad/10.0/scripting/plugins/kimaster_plugin/
  Linux:    ~/.local/share/kicad/10.0/scripting/plugins/kimaster_plugin/

The KiMaster app auto-installs this plugin via cmd_install_bridge_plugin IPC.
"""

import logging

_log = logging.getLogger("kimaster")

# Only register when running inside KiCad (pcbnew available)
try:
    import pcbnew  # noqa: F401  (raises ImportError outside KiCad)
    from .KiMasterPlugin import create_and_register
    create_and_register()
except ImportError:
    pass  # Normal when imported outside KiCad — no pcbnew available
except Exception as e:
    _log.warning("KiMaster plugin registration error: %s", e)
