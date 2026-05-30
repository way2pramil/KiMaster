"""
BoardExporter — serializes KiCad PCB board state to JSON-safe dicts.

Thread safety: pcbnew SWIG objects are protected by the Python GIL.
We always re-fetch via ``pcbnew.GetBoard()`` and serialize with full
error reporting so problems surface in the KiMaster UI.

IMPORTANT — KiCad 10 wxString:
  Many pcbnew getters return ``wxString`` instead of ``str``.
  ``json.dumps()`` cannot serialize ``wxString``.  Every string value
  pulled from pcbnew MUST be wrapped with ``str()`` before inclusion
  in the result dict.

Coordinate system: KiCad internal units (IU) → mm: 1 IU = 1 nm.
"""

import logging
import traceback
from typing import Any, Dict, List, Optional

_log = logging.getLogger("kimaster.exporter")

# IU → mm conversion factor (KiCad 9/10: 1 IU = 1 nm)
IU_PER_MM = 1_000_000


def _s(val) -> str:
    """Force any pcbnew wxString / SWIG proxy to a plain Python str."""
    if val is None:
        return ""
    return str(val)


class BoardExporter:
    """Serializes board state from the live pcbnew.GetBoard() instance."""

    def __init__(self):
        self._board = None

    def attach_board(self, board):
        """Attach a pcbnew.BOARD instance."""
        self._board = board

    # ── Public API ────────────────────────────────────────────────────────

    def get_board_name(self) -> str:
        board = self._resolve_board()
        if not board:
            return "unknown"
        try:
            return _s(board.GetFileName()) or "unnamed"
        except Exception:
            return "unknown"

    def get_board_state(self) -> Dict[str, Any]:
        """
        Full board snapshot.

        Always tries ``pcbnew.GetBoard()`` first for a live reference.
        Returns a dict with a ``_diag`` key containing debug info so
        problems are visible in the KiMaster UI.
        """
        board = self._resolve_board()
        diag = []

        if not board:
            diag.append("pcbnew.GetBoard() returned None — no board loaded?")
            result = self._empty_state()
            result["_diag"] = diag
            return result

        diag.append("board=OK")
        try:
            fname = _s(board.GetFileName())
            diag.append(f"file={fname}")
        except Exception as e:
            diag.append(f"GetFileName error: {e}")

        components = self._get_components(board, diag)
        nets       = self._get_nets(board, diag)
        layers     = self._get_copper_layers(board, diag)

        result = {
            "board_name":         self.get_board_name(),
            "components":         components,
            "nets":               nets,
            "layers":             layers,
            "all_layers":         self._get_all_enabled_layers(board),
            "board_size":         self._get_board_size(board),
            "copper_layer_count": self._get_copper_layer_count(board),
            "design_rules":       self._get_design_rules_summary(board),
            "_diag":              diag,
        }

        _log.info(
            "BoardExporter: %d components, %d nets, %d layers | %s",
            len(components), len(nets), len(layers),
            " | ".join(diag[:3]),
        )
        return result

    # ── Board resolution ──────────────────────────────────────────────────

    def _resolve_board(self):
        """Re-fetch the live board. Returns BOARD or None."""
        try:
            import pcbnew
            board = pcbnew.GetBoard()
            if board is not None:
                self._board = board
            else:
                _log.debug("BoardExporter: pcbnew.GetBoard() returned None")
        except Exception as e:
            _log.warning("BoardExporter: pcbnew.GetBoard() error: %s", e)
        return self._board

    # ── Components ────────────────────────────────────────────────────────

    def _get_components(self, board, diag: list) -> List[Dict]:
        components = []
        try:
            footprints = board.GetFootprints()
            diag.append(f"footprints={len(footprints)}")
        except Exception as e:
            diag.append(f"GetFootprints error: {e}")
            _log.warning("BoardExporter: GetFootprints failed: %s", e)
            return components

        for fp in footprints:
            try:
                pos = fp.GetPosition()
                orient_deg = fp.GetOrientationDegrees() \
                    if hasattr(fp, "GetOrientationDegrees") \
                    else fp.GetOrientation() / 10.0

                # Custom fields
                fields: Dict[str, str] = {}
                try:
                    for field in fp.GetFields():
                        fields[_s(field.GetName())] = _s(field.GetText())
                except Exception:
                    pass

                components.append({
                    "ref":       _s(fp.GetReference()),
                    "value":     _s(fp.GetValue()),
                    "footprint": _s(fp.GetFPIDAsString()),
                    "position":  {
                        "x": round(pos.x / IU_PER_MM, 4),
                        "y": round(pos.y / IU_PER_MM, 4),
                    },
                    "rotation":  round(orient_deg, 2),
                    "on_back":   bool(fp.IsFlipped()),
                    "locked":    bool(fp.IsLocked()),
                    "dnp":       bool(fp.GetDNP()) if hasattr(fp, "GetDNP") else False,
                    "fields":    fields,
                })
            except Exception as e:
                _log.debug("BoardExporter: skip footprint: %s", e)
        return components

    # ── Nets ──────────────────────────────────────────────────────────────

    def _get_nets(self, board, diag: list) -> List[Dict]:
        nets = []
        try:
            net_info = board.GetNetInfo()
            net_map  = net_info.NetsByName()
            count    = 0
            for name in net_map:
                sname = _s(name)
                if sname == "":
                    continue
                net = net_map[name]
                nets.append({
                    "name":    sname,
                    "netcode": int(net.GetNetCode()),
                })
                count += 1
            diag.append(f"nets={count}")
        except Exception as e:
            diag.append(f"GetNetInfo error: {e}")
            _log.warning("BoardExporter: GetNetInfo failed: %s\n%s", e, traceback.format_exc())
        return nets

    # ── Layers ────────────────────────────────────────────────────────────

    def _get_copper_layers(self, board, diag: list) -> List[str]:
        layers = []
        try:
            for layer_id in range(0, 32):
                if board.IsLayerEnabled(layer_id):
                    layers.append(_s(board.GetLayerName(layer_id)))
            diag.append(f"copper_layers={len(layers)}")
        except Exception as e:
            diag.append(f"layers error: {e}")
            _log.debug("BoardExporter: copper layers error: %s", e)
        return layers

    def _get_all_enabled_layers(self, board) -> List[Dict]:
        layers = []
        try:
            import pcbnew
            enabled = board.GetEnabledLayers()
            for layer_id in range(pcbnew.PCB_LAYER_ID_COUNT):
                try:
                    if enabled.Contains(layer_id):
                        layers.append({
                            "id":     int(layer_id),
                            "name":   _s(board.GetLayerName(layer_id)),
                            "copper": bool(pcbnew.IsCopperLayer(layer_id)),
                        })
                except Exception:
                    pass
        except Exception as e:
            _log.debug("BoardExporter: all layers error: %s", e)
        return layers

    def _get_copper_layer_count(self, board) -> int:
        try:
            return int(board.GetCopperLayerCount())
        except Exception:
            return 0

    # ── Board size ────────────────────────────────────────────────────────

    def _get_board_size(self, board) -> Optional[Dict]:
        try:
            bbox = board.GetBoardEdgesBoundingBox()
            return {
                "width_mm":  round(bbox.GetWidth()  / IU_PER_MM, 3),
                "height_mm": round(bbox.GetHeight() / IU_PER_MM, 3),
                "x_mm":      round(bbox.GetX()      / IU_PER_MM, 3),
                "y_mm":      round(bbox.GetY()      / IU_PER_MM, 3),
            }
        except Exception as e:
            _log.debug("BoardExporter: board size error: %s", e)
            return None

    # ── Design rules ──────────────────────────────────────────────────────

    def _get_design_rules_summary(self, board) -> Dict:
        try:
            ds = board.GetDesignSettings()
            return {
                "min_clearance_mm":   round(ds.m_MinClearance   / IU_PER_MM, 4),
                "min_track_width_mm": round(ds.m_TrackMinWidth  / IU_PER_MM, 4),
                "min_via_drill_mm":   round(ds.m_MinThroughDrill / IU_PER_MM, 4),
            }
        except Exception as e:
            _log.debug("BoardExporter: design rules error: %s", e)
            return {}

    @staticmethod
    def _empty_state() -> Dict[str, Any]:
        return {
            "board_name": "",
            "components": [],
            "nets": [],
            "layers": [],
            "board_size": None,
            "copper_layer_count": 0,
        }
