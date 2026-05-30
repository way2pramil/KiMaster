"""
BoardChangeWatcher — detects board modifications made in KiCad.

KiCad's Python API has no change-event callbacks, so we poll a
lightweight fingerprint of the board state and broadcast
``board_changed`` when the fingerprint differs.

Fingerprint strategy (fast — avoids full serialization):
  - footprint count
  - track count
  - zone count
  - board file modification timestamp (os.path.getmtime)
  - hash of footprint reference+position list (catches moves/adds/deletes)

The watcher runs in a daemon thread next to the SelectionWatcher.
"""

import hashlib
import logging
import os
import threading
import time
from typing import Optional

_log = logging.getLogger("kimaster.boardwatch")


class BoardChangeWatcher:
    """
    Polls a board fingerprint every ``poll_ms`` milliseconds.
    Broadcasts ``board_changed`` + fresh ``board_state`` when a change
    is detected.

    Args:
        ws_server:  KiMasterWsServer instance (has .broadcast_board_state())
        poll_ms:    Poll interval in milliseconds (default 1000 = 1s)
    """

    def __init__(self, ws_server, poll_ms: int = 1000):
        self._server   = ws_server
        self._poll_ms  = poll_ms
        self._thread: Optional[threading.Thread] = None
        self._running  = False
        self._last_fp  = ""  # last fingerprint

    # ── Lifecycle ──────────────────────────────────────────────────────────

    @property
    def poll_ms(self) -> int:
        return self._poll_ms

    @poll_ms.setter
    def poll_ms(self, value: int):
        self._poll_ms = max(200, min(value, 30000))  # clamp 200ms–30s

    def start(self):
        if self._running:
            return
        self._running = True
        # Take initial fingerprint so we don't fire on startup
        self._last_fp = self._fingerprint()
        self._thread = threading.Thread(
            target=self._poll_loop,
            daemon=True,
            name="KiMaster-BoardWatch",
        )
        self._thread.start()
        _log.info("BoardChangeWatcher started (poll_ms=%d)", self._poll_ms)

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=2)

    # ── Poll loop ─────────────────────────────────────────────────────────

    def _poll_loop(self):
        while self._running:
            try:
                fp = self._fingerprint()
                if fp and fp != self._last_fp:
                    self._last_fp = fp
                    _log.info("BoardChangeWatcher: change detected, broadcasting")
                    self._server.broadcast_board_state()
            except Exception as e:
                _log.debug("BoardChangeWatcher poll error: %s", e)

            time.sleep(self._poll_ms / 1000.0)

    # ── Fingerprint ───────────────────────────────────────────────────────

    @staticmethod
    def _fingerprint() -> str:
        """
        Build a lightweight hash of the board state.
        Fast enough to run every second without impacting KiCad.
        """
        try:
            import pcbnew
            board = pcbnew.GetBoard()
            if board is None:
                return ""

            h = hashlib.md5(usedforsecurity=False)

            # 1. File mtime (catches any save — including external tools)
            try:
                fname = str(board.GetFileName())
                if fname and os.path.isfile(fname):
                    h.update(str(os.path.getmtime(fname)).encode())
            except Exception:
                pass

            # 2. Counts
            try:
                fps = board.GetFootprints()
                h.update(f"fp={len(fps)}".encode())
            except Exception:
                fps = []

            try:
                tracks = board.GetTracks()
                h.update(f"tr={len(tracks)}".encode())
            except Exception:
                pass

            try:
                zones = list(board.Zones())
                h.update(f"zn={len(zones)}".encode())
            except Exception:
                pass

            # 3. Footprint ref+position hash (catches moves, adds, deletes)
            for fp in fps:
                try:
                    ref = str(fp.GetReference())
                    pos = fp.GetPosition()
                    rot = fp.GetOrientationDegrees() \
                        if hasattr(fp, "GetOrientationDegrees") \
                        else fp.GetOrientation() / 10.0
                    locked = fp.IsLocked()
                    h.update(f"{ref},{pos.x},{pos.y},{rot},{locked}".encode())
                except Exception:
                    pass

            return h.hexdigest()
        except Exception as e:
            _log.debug("_fingerprint error: %s", e)
            return ""
