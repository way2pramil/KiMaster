"""
Teardrops — apply or remove teardrops on pads and vias.

KiCad teardrop history
----------------------
KiCad 7–10 GUI — "Edit > Teardrops" tools generate teardrops via an internal
TEARDROP_MANAGER C++ class that lives in the GUI tool layer, not pcbnew core.
It (and TEARDROP_PARAMETERS) is **not exposed to the Python scripting API** —
confirmed absent from KiCad 10.0.1's pcbnew SWIG bindings. Only per-item
property accessors exist (BOARD_CONNECTED_ITEM.SetTeardropsEnabled / Get/Set
TeardropBestLengthRatio / etc.) plus BOARD_DESIGN_SETTINGS.m_TeardropParamsList
— but nothing that actually *builds* the teardrop shapes from Python.

Strategy pipeline (first that works wins):
  1. TEARDROP_MANAGER + TEARDROP_PARAMETERS  — kept as a forward-compat probe
     in case a future KiCad release exposes it; always absent today.
  2. Unsupported — return a descriptive error pointing at the GUI action.

Dry-run behaviour:
  dry_run=True  → count eligible items, return preview_count; no board write.
  dry_run=False → apply via TEARDROP_MANAGER; save; refresh.

Protocol
--------
Request (type: "apply_teardrops"):
  {
    "targets":           str,    # "all" | "pads" | "vias" | "tracks"
    "size_ratio":        float,  # teardrop width ratio (0.1–1.0, default 0.5)
    "length_ratio":      float,  # teardrop length ratio (0.1–2.0, default 1.0)
    "curve_points":      int,    # curve smoothness 2–10 (default 5)
    "prefer_zone_fills": bool,   # true = use zone fill as reference (default true)
    "max_len_mm":        float,  # max teardrop length in mm (default 1.0, 0 = unlimited)
    "max_width_mm":      float,  # max teardrop width in mm (default 2.0, 0 = unlimited)
    "dry_run":           bool
  }

Request (type: "remove_teardrops"):
  { "board_check": str }

Response (type: "op_result"):
  {
    "success":         bool,
    "message":         str,
    "applied_count":   int,
    "removed_count":   int,
    "preview_count":   int,   # eligible items on dry_run
    "kicad_api_used":  str,
    "kicad_version":   str,
    "elapsed_ms":      int
  }
"""

import logging
import time

_log = logging.getLogger("kimaster.ops.teardrops")


class Teardrops:
    """Teardrop applicator/remover. Constructed once per WS message dispatch."""

    def __init__(self, board, notify_fn):
        self._board  = board
        self._notify = notify_fn

    # ── Public entry points ───────────────────────────────────────────────────

    def execute_apply(self, data: dict) -> dict:
        t0 = time.perf_counter()
        try:
            return self._apply(data, t0)
        except Exception as e:
            _log.exception("Teardrops.execute_apply failed")
            return self._err(str(e), t0)

    def execute_remove(self, data: dict) -> dict:
        t0 = time.perf_counter()
        try:
            return self._remove(data, t0)
        except Exception as e:
            _log.exception("Teardrops.execute_remove failed")
            return self._err(str(e), t0)

    # ── Apply ─────────────────────────────────────────────────────────────────

    def _apply(self, data: dict, t0: float) -> dict:
        import pcbnew

        targets      = (data.get("targets")  or "all").strip().lower()
        size_ratio   = float(data.get("size_ratio")   or 0.5)
        length_ratio = float(data.get("length_ratio") or 1.0)
        curve_points = int(data.get("curve_points")   or 5)
        max_len_mm   = float(data.get("max_len_mm")   or 1.0)
        max_width_mm = float(data.get("max_width_mm") or 2.0)
        dry_run      = bool(data.get("dry_run", True))

        # Clamp to safe ranges
        size_ratio   = max(0.1, min(1.0, size_ratio))
        length_ratio = max(0.1, min(2.0, length_ratio))
        curve_points = max(2,   min(10,  curve_points))

        board      = self._board
        kicad_ver  = self._kicad_version(pcbnew)

        if dry_run:
            count = self._count_eligible(board, pcbnew, targets)
            return {
                "success":        True,
                "message":        f"Preview: {count} item{'s' if count != 1 else ''} eligible for teardrops",
                "applied_count":  0,
                "removed_count":  0,
                "preview_count":  count,
                "kicad_api_used": "preview",
                "kicad_version":  kicad_ver,
                "elapsed_ms":     self._ms(t0),
            }

        # ── Strategy 1: TEARDROP_MANAGER (KiCad 7+) ──────────────────────────
        result = self._apply_via_manager(
            pcbnew, board, targets,
            size_ratio, length_ratio, curve_points,
            max_len_mm, max_width_mm, t0, kicad_ver,
        )
        if result is not None:
            return result

        # ── No supported strategy found ───────────────────────────────────────
        return {
            "success":        False,
            "message":        (
                f"KiCad {kicad_ver} does not expose teardrop generation to the "
                "scripting API (TEARDROP_MANAGER is GUI-only, not in pcbnew). "
                "Use Edit > Teardrops > Add Teardrops in the KiCad PCB editor instead."
            ),
            "applied_count":  0,
            "removed_count":  0,
            "preview_count":  0,
            "kicad_api_used": "unsupported",
            "kicad_version":  kicad_ver,
            "elapsed_ms":     self._ms(t0),
        }

    def _apply_via_manager(self, pcbnew, board, targets,
                           size_ratio, length_ratio, curve_points,
                           max_len_mm, max_width_mm, t0, kicad_ver):
        """
        Try TEARDROP_MANAGER path. Returns result dict on success, None if
        the API is absent (caller should try the next strategy).
        """
        if not hasattr(pcbnew, "TEARDROP_MANAGER"):
            _log.debug("Teardrops: TEARDROP_MANAGER not found in pcbnew")
            return None

        try:
            tm = pcbnew.TEARDROP_MANAGER(board)
        except Exception as e:
            _log.warning("Teardrops: TEARDROP_MANAGER() failed: %s", e)
            return None

        # Build TEARDROP_PARAMETERS if the class exists
        td_params = self._build_params(
            pcbnew, size_ratio, length_ratio, curve_points,
            max_len_mm, max_width_mm,
        )

        # Apply — different KiCad versions have different signatures
        applied_count  = 0
        api_label      = "TEARDROP_MANAGER"

        # Remove existing teardrops first to avoid duplicates
        removed_count = self._safe_remove_all(tm, pcbnew)

        # Scope filter
        scope = self._scope_filter(pcbnew, targets)

        try:
            if td_params is not None:
                # KiCad 7/8/9/10: AddTeardrops(params [, scope])
                applied_count = self._call_add_teardrops(tm, td_params, scope)
            else:
                # Fallback: AddTeardrops with no params (uses board defaults)
                applied_count = self._call_add_teardrops(tm, None, scope)

            applied_count = int(applied_count or 0)
            api_label     = "TEARDROP_MANAGER+TEARDROP_PARAMETERS" if td_params else "TEARDROP_MANAGER"

        except Exception as e:
            _log.warning("Teardrops: AddTeardrops failed: %s", e)
            return {
                "success":        False,
                "message":        f"AddTeardrops failed: {e}",
                "applied_count":  0,
                "removed_count":  removed_count,
                "preview_count":  0,
                "kicad_api_used": api_label,
                "kicad_version":  kicad_ver,
                "elapsed_ms":     self._ms(t0),
            }

        try:
            board.Save(board.GetFileName())
            pcbnew.Refresh()
            self._notify()
        except Exception as e:
            _log.warning("Teardrops: save/refresh failed: %s", e)

        return {
            "success":        True,
            "message":        f"Applied {applied_count} teardrop{'s' if applied_count != 1 else ''} ({removed_count} old removed)",
            "applied_count":  applied_count,
            "removed_count":  removed_count,
            "preview_count":  0,
            "kicad_api_used": api_label,
            "kicad_version":  kicad_ver,
            "elapsed_ms":     self._ms(t0),
        }

    # ── Remove ────────────────────────────────────────────────────────────────

    def _remove(self, data: dict, t0: float) -> dict:
        import pcbnew
        board     = self._board
        kicad_ver = self._kicad_version(pcbnew)

        if not hasattr(pcbnew, "TEARDROP_MANAGER"):
            return {
                "success":        False,
                "message":        (
                    f"KiCad {kicad_ver} does not expose teardrop removal to the "
                    "scripting API. Use Edit > Teardrops > Remove Teardrops in "
                    "the KiCad PCB editor instead."
                ),
                "applied_count":  0,
                "removed_count":  0,
                "preview_count":  0,
                "kicad_api_used": "unsupported",
                "kicad_version":  kicad_ver,
                "elapsed_ms":     self._ms(t0),
            }

        try:
            tm = pcbnew.TEARDROP_MANAGER(board)
            removed = self._safe_remove_all(tm, pcbnew)
            board.Save(board.GetFileName())
            pcbnew.Refresh()
            self._notify()
            return {
                "success":        True,
                "message":        f"Removed {removed} teardrop{'s' if removed != 1 else ''}",
                "applied_count":  0,
                "removed_count":  removed,
                "preview_count":  0,
                "kicad_api_used": "TEARDROP_MANAGER",
                "kicad_version":  kicad_ver,
                "elapsed_ms":     self._ms(t0),
            }
        except Exception as e:
            _log.warning("Teardrops.remove failed: %s", e)
            return self._err(str(e), t0, kicad_ver)

    # ── TEARDROP_PARAMETERS builder ───────────────────────────────────────────

    @staticmethod
    def _build_params(pcbnew, size_ratio, length_ratio, curve_points,
                      max_len_mm, max_width_mm):
        """
        Build and populate a TEARDROP_PARAMETERS object.
        Field names differ slightly between KiCad versions — try both known
        naming conventions and fall back gracefully if the class is absent.
        """
        if not hasattr(pcbnew, "TEARDROP_PARAMETERS"):
            _log.debug("Teardrops: TEARDROP_PARAMETERS class not found")
            return None
        try:
            p = pcbnew.TEARDROP_PARAMETERS()
        except Exception as e:
            _log.warning("Teardrops: TEARDROP_PARAMETERS() failed: %s", e)
            return None

        # Field name variants across KiCad versions
        _setattr_try(p, ("m_WidthtoSizeFilterRatio", "m_WidthRatio"),   float(size_ratio))
        _setattr_try(p, ("m_LengthRatio",            "m_BestLengthRatio"), float(length_ratio))
        _setattr_try(p, ("m_CurveSegCount",           "m_nCurvePoints"), int(curve_points))

        if max_len_mm > 0:
            _setattr_try(p, ("m_TdMaxLen",  "m_MaxLen"),   pcbnew.FromMM(max_len_mm))
        if max_width_mm > 0:
            _setattr_try(p, ("m_TdMaxWidth","m_MaxWidth"), pcbnew.FromMM(max_width_mm))

        return p

    # ── AddTeardrops call variants ────────────────────────────────────────────

    @staticmethod
    def _call_add_teardrops(tm, params, scope):
        """
        Try AddTeardrops with various signatures across KiCad versions.
        Returns the count of applied teardrops (int or 0 if unknowable).
        """
        # KiCad 7: AddTeardrops(TEARDROP_PARAMETERS*, bool check, BOARD_ITEM* scope)
        # KiCad 8/9: AddTeardrops(params)
        # KiCad 10: may return count as int or None
        fns = []

        if params is not None and scope is not None:
            fns.append(lambda: tm.AddTeardrops(params, scope))
        if params is not None:
            fns.append(lambda: tm.AddTeardrops(params))
        if scope is not None:
            fns.append(lambda: tm.AddTeardrops(scope))
        fns.append(lambda: tm.AddTeardrops())

        last_err = None
        for fn in fns:
            try:
                result = fn()
                count  = int(result) if result is not None and isinstance(result, int) else 0
                return count
            except TypeError:
                continue
            except Exception as e:
                last_err = e
                continue

        if last_err:
            raise last_err
        return 0

    # ── Remove helper ─────────────────────────────────────────────────────────

    @staticmethod
    def _safe_remove_all(tm, pcbnew) -> int:
        """Try RemoveTeardrops; return count or 0."""
        for fn in [
            lambda: tm.RemoveTeardrops(),
            lambda: tm.RemoveTeardrops(None),
        ]:
            try:
                result = fn()
                return int(result) if isinstance(result, int) else 0
            except (TypeError, AttributeError):
                continue
            except Exception as e:
                _log.debug("Teardrops: RemoveTeardrops attempt failed: %s", e)
        return 0

    # ── Scope filter ──────────────────────────────────────────────────────────

    @staticmethod
    def _scope_filter(pcbnew, targets: str):
        """
        Return a scope constant or None.
        KiCad exposes TD_TYPE_* or TEARDROP_TYPE_* constants in some versions.
        We return None (= all) when the constant is absent — caller falls back.
        """
        if targets == "all":
            return None

        candidates = {
            "pads":   ["TD_TYPE_PADVIA", "TEARDROP_TYPE_PADVIA",  "TD_PADS"],
            "vias":   ["TD_TYPE_PADVIA", "TEARDROP_TYPE_PADVIA",  "TD_VIAS"],
            "tracks": ["TD_TYPE_TRACK",  "TEARDROP_TYPE_TRACK",   "TD_TRACKS"],
        }
        for attr in candidates.get(targets, []):
            if hasattr(pcbnew, attr):
                return getattr(pcbnew, attr)
        return None  # unsupported scope → apply to all

    # ── Dry-run eligible item counter ─────────────────────────────────────────

    @staticmethod
    def _count_eligible(board, pcbnew, targets: str) -> int:
        """
        Count items that would receive teardrops.
        Eligible pad  = has at least one track connecting to it on any copper layer.
        Eligible via  = has at least one track on its top or bottom layer.
        """
        count   = 0
        include_pads  = targets in ("all", "pads")
        include_vias  = targets in ("all", "vias")
        include_tracks = targets in ("all", "tracks")

        try:
            all_tracks = list(board.GetTracks())
            via_type   = pcbnew.PCB_VIA_T

            # Build set of net+layer endpoints for track-to-item proximity checks
            endpoints = set()
            for trk in all_tracks:
                if trk.Type() == via_type:
                    continue
                nc = trk.GetNetCode()
                ly = trk.GetLayer()
                s, e = trk.GetStart(), trk.GetEnd()
                endpoints.add((nc, ly, s.x, s.y))
                endpoints.add((nc, ly, e.x, e.y))

            TOL = 10_000  # 0.01 mm in IU

            def _has_track(nc, ly, pos):
                return any(
                    n == nc and l == ly
                    and abs(x - pos.x) <= TOL and abs(y - pos.y) <= TOL
                    for (n, l, x, y) in endpoints
                )

            if include_pads or include_vias:
                for trk in all_tracks:
                    if trk.Type() != via_type:
                        continue
                    if not include_vias:
                        continue
                    try:
                        nc  = trk.GetNetCode()
                        top = trk.TopLayer()
                        bot = trk.BottomLayer()
                        pos = trk.GetPosition()
                        if _has_track(nc, top, pos) or _has_track(nc, bot, pos):
                            count += 1
                    except Exception:
                        pass

            if include_pads:
                for fp in board.GetFootprints():
                    for pad in fp.Pads():
                        try:
                            nc  = pad.GetNetCode()
                            if nc <= 0:
                                continue
                            pos = pad.GetPosition()
                            ly  = pad.GetLayer()
                            if _has_track(nc, ly, pos):
                                count += 1
                        except Exception:
                            pass

            if include_tracks:
                # T-junction count: track endpoints that sit on another track's midpoint
                # Simplified: count as 0 for now — complex to compute correctly
                pass

        except Exception as e:
            _log.warning("Teardrops: eligible count failed: %s", e)
            return 0

        return count

    # ── Shared helpers ────────────────────────────────────────────────────────

    @staticmethod
    def _kicad_version(pcbnew) -> str:
        try:
            return str(pcbnew.GetBuildVersion())
        except Exception:
            return "unknown"

    @staticmethod
    def _ms(t0: float) -> int:
        return int((time.perf_counter() - t0) * 1000)

    @staticmethod
    def _err(msg: str, t0: float, kicad_ver: str = "unknown") -> dict:
        _log.warning("Teardrops error: %s", msg)
        return {
            "success":        False,
            "message":        msg,
            "applied_count":  0,
            "removed_count":  0,
            "preview_count":  0,
            "kicad_api_used": "error",
            "kicad_version":  kicad_ver,
            "elapsed_ms":     0,
        }


# ── Module-level helper ───────────────────────────────────────────────────────

def _setattr_try(obj, names, value):
    """Try setting `value` on `obj` using the first matching attribute name."""
    for name in names:
        if hasattr(obj, name):
            try:
                setattr(obj, name, value)
                return True
            except Exception:
                continue
    return False
