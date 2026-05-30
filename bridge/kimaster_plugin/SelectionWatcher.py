"""
SelectionWatcher — polls KiCad's current selection and broadcasts changes.

KiCad's Python scripting environment doesn't expose direct selection change
callbacks, so we poll on an interval and broadcast when state changes.

The watcher runs in a background thread (daemon) and is safe to start/stop.
"""

import logging
import threading
import time
from typing import List, Optional, Set

_log = logging.getLogger("kimaster.selection")


class SelectionWatcher:
    """
    Polls KiCad selection every `poll_ms` milliseconds.
    Broadcasts 'selection_changed' via `ws_server` when the selection changes.
    """

    def __init__(self, ws_server, poll_ms: int = 500):
        self._server  = ws_server
        self._poll_ms = poll_ms
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._last_refs: Set[str] = set()
        self._last_nets: Set[str] = set()

    @property
    def poll_ms(self) -> int:
        return self._poll_ms

    @poll_ms.setter
    def poll_ms(self, value: int):
        self._poll_ms = max(100, min(value, 10000))  # clamp 100ms–10s

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(
            target=self._poll_loop,
            daemon=True,
            name="KiMaster-SelectionWatcher",
        )
        self._thread.start()
        _log.debug("SelectionWatcher started")

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=2)

    # ── Polling loop ──────────────────────────────────────────────────────

    def _poll_loop(self):
        while self._running:
            try:
                refs, nets = self._get_current_selection()
                ref_set = set(refs)
                net_set = set(nets)

                if ref_set != self._last_refs or net_set != self._last_nets:
                    self._last_refs = ref_set
                    self._last_nets = net_set
                    self._server.notify_selection_changed(refs, nets)
                    _log.debug(f"SelectionWatcher: changed refs={refs} nets={nets}")
            except Exception as e:
                _log.debug(f"SelectionWatcher: poll error: {e}")

            time.sleep(self._poll_ms / 1000.0)

    # ── KiCad API ─────────────────────────────────────────────────────────

    @staticmethod
    def _get_current_selection() -> tuple:
        """
        Return (refs, nets) for currently selected board items.
        Uses pcbnew.GetCurrentSelection() (KiCad 9+).
        """
        refs: List[str] = []
        nets: List[str] = []

        try:
            import pcbnew
            board = pcbnew.GetBoard()

            # KiCad 9+ API: board.GetCurrentSelection() is not public.
            # Use the approach: iterate all footprints and check IsSelected().
            for fp in board.GetFootprints():
                try:
                    if fp.IsSelected():
                        refs.append(str(fp.GetReference()))
                except Exception:
                    pass

            # Collect nets from selected pads
            for fp in board.GetFootprints():
                if not fp.IsSelected():
                    continue
                try:
                    for pad in fp.Pads():
                        net = str(pad.GetNetname())
                        if net and net not in nets:
                            nets.append(net)
                except Exception:
                    pass

        except Exception as e:
            _log.debug(f"_get_current_selection error: {e}")

        return refs, nets
