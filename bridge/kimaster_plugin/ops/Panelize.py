"""
Panelize — duplicate the board into an N×M panel with rails, mouse bites,
and optional V-score lines.

Pure pcbnew implementation — zero external dependencies (no KiKit, no Shapely).
Techniques drawn from:
  - SparkFun KiCad Panelizer (MIT)  github.com/sparkfun/SparkFun_KiCad_Panelizer
  - KiKit (MIT)                     github.com/yaqwsx/KiKit

Key differences from SparkFun's approach:
  - Nets are renamed per board copy (P1_, P2_, …) so DRC passes on the panel.
  - Mouse bites: NPTH drill holes on Edge.Cuts gap line.
  - Rails: PCB_SHAPE lines forming a closed rectangle on Edge.Cuts.
  - V-score lines: PCB_SHAPE on User.Comments, extending ±2 mm beyond panel.
  - Source board is loaded fresh from disk — live board is never mutated.
  - Output always written to a separate *_panel.kicad_pcb file.

Protocol
--------
Request (type: "panelize_board"):
  {
    "cols":                   int,    # columns (1–10)
    "rows":                   int,    # rows (1–10)
    "gap_mm":                 float,  # gap between board copies (0 = touching)
    "rail_mm":                float,  # edge rail width on all four sides (0 = no rails)
    "mouse_bites":            bool,   # add NPTH mouse-bite holes in the gap
    "mouse_bite_dia_mm":      float,  # hole diameter (default 0.5)
    "mouse_bite_spacing_mm":  float,  # hole centre-to-centre spacing (default 0.8)
    "v_score":                bool,   # draw V-score lines on User.Comments
    "output_path":            str | null,   # null → <board_dir>/<name>_panel.kicad_pcb
    "dry_run":                bool
  }

Response (type: "op_result", op: "panelize_board"):
  {
    "success":          bool,
    "message":          str,
    "panel_width_mm":   float,
    "panel_height_mm":  float,
    "board_count":      int,
    "output_path":      str,
    "preview_outline":  [{x_mm, y_mm}, ...],   # panel corner polygon
    "elapsed_ms":       int
  }
"""

import logging
import math
import os
import time

_log = logging.getLogger("kimaster.ops.panelize")

# KiCad 9/10: 1 IU = 1 nm
_MM = 1_000_000   # nm per mm


class Panelize:
    """Panel builder. Constructed once per WS message dispatch."""

    def __init__(self, board, notify_fn):
        self._board  = board    # live pcbnew.BOARD (used for filename only)
        self._notify = notify_fn

    # ── Public entry point ────────────────────────────────────────────────────

    def execute(self, data: dict) -> dict:
        t0 = time.perf_counter()
        try:
            return self._run(data, t0)
        except Exception as e:
            _log.exception("Panelize.execute failed")
            return self._err(str(e), t0)

    # ── Main logic ────────────────────────────────────────────────────────────

    def _run(self, data: dict, t0: float) -> dict:
        import pcbnew

        cols     = max(1, int(data.get("cols") or 2))
        rows     = max(1, int(data.get("rows") or 2))
        gap_mm   = max(0.0, float(data.get("gap_mm")  or 2.0))
        rail_mm  = max(0.0, float(data.get("rail_mm") or 0.0))
        mouse_bites         = bool(data.get("mouse_bites", True))
        bite_dia_mm         = max(0.1, float(data.get("mouse_bite_dia_mm")     or 0.5))
        bite_spacing_mm     = max(0.3, float(data.get("mouse_bite_spacing_mm") or 0.8))
        v_score             = bool(data.get("v_score", False))
        output_path         = (data.get("output_path") or "").strip() or None
        dry_run             = bool(data.get("dry_run", True))

        # Clamp
        cols = min(cols, 10)
        rows = min(rows, 10)

        source_file = str(self._board.GetFileName())
        if not source_file or not os.path.isfile(source_file):
            return self._err(
                "Board must be saved to disk before panelizing. "
                "Please save in KiCad first.", t0
            )

        # Resolve output path
        if output_path is None:
            base, _ = os.path.splitext(source_file)
            output_path = base + "_panel.kicad_pcb"

        # Load a clean copy of the source board for reading dimensions
        try:
            src = pcbnew.LoadBoard(source_file)
        except Exception as e:
            return self._err(f"Cannot load board from disk: {e}", t0)

        # Board dimensions from Edge.Cuts bounding box
        bbox     = src.GetBoardEdgesBoundingBox()
        board_w  = bbox.GetWidth()    # IU
        board_h  = bbox.GetHeight()   # IU
        origin_x = bbox.GetX()        # top-left of board in IU
        origin_y = bbox.GetY()

        if board_w <= 0 or board_h <= 0:
            return self._err("Board has no Edge.Cuts outline — cannot panelize.", t0)

        gap_iu   = int(gap_mm  * _MM)
        rail_iu  = int(rail_mm * _MM)

        # Panel total size
        panel_w = cols * board_w + max(0, cols - 1) * gap_iu + 2 * rail_iu
        panel_h = rows * board_h + max(0, rows - 1) * gap_iu + 2 * rail_iu

        panel_w_mm = round(panel_w / _MM, 3)
        panel_h_mm = round(panel_h / _MM, 3)

        # Panel corner polygon for preview (4 corners)
        preview_outline = [
            {"x_mm": 0.0,         "y_mm": 0.0},
            {"x_mm": panel_w_mm,  "y_mm": 0.0},
            {"x_mm": panel_w_mm,  "y_mm": panel_h_mm},
            {"x_mm": 0.0,         "y_mm": panel_h_mm},
        ]

        if dry_run:
            return {
                "success":         True,
                "message":         (
                    f"Preview: {cols}×{rows} panel  "
                    f"{panel_w_mm:.1f} × {panel_h_mm:.1f} mm  "
                    f"({cols * rows} boards)"
                ),
                "panel_width_mm":  panel_w_mm,
                "panel_height_mm": panel_h_mm,
                "board_count":     cols * rows,
                "output_path":     output_path,
                "preview_outline": preview_outline,
                "elapsed_ms":      self._ms(t0),
            }

        # ── Build panel ───────────────────────────────────────────────────────
        try:
            panel = self._build_panel(
                pcbnew, src, source_file,
                cols, rows,
                board_w, board_h, origin_x, origin_y,
                gap_iu, rail_iu,
                mouse_bites, bite_dia_mm, bite_spacing_mm,
                v_score, output_path,
            )
        except Exception as e:
            _log.exception("Panel build failed")
            return self._err(f"Panel build failed: {e}", t0)

        return {
            "success":         True,
            "message":         (
                f"Panel saved: {cols}×{rows}  "
                f"{panel_w_mm:.1f} × {panel_h_mm:.1f} mm → "
                f"{os.path.basename(output_path)}  "
                f"(zones unfilled — press Ctrl+B in KiCad to refill)"
            ),
            "panel_width_mm":  panel_w_mm,
            "panel_height_mm": panel_h_mm,
            "board_count":     cols * rows,
            "output_path":     output_path,
            "preview_outline": preview_outline,
            "elapsed_ms":      self._ms(t0),
        }

    # ── Panel construction ────────────────────────────────────────────────────

    def _build_panel(self, pcbnew, src, source_file,
                     cols, rows, board_w, board_h, origin_x, origin_y,
                     gap_iu, rail_iu,
                     mouse_bites, bite_dia_mm, bite_spacing_mm,
                     v_score, output_path):
        """
        Build the full panel board and save it.

        Strategy:
          1. Load fresh copy from disk as the base panel board.
          2. For each additional grid position, Duplicate() every item and Move() it.
          3. Rename nets per copy so DRC passes (P1_, P2_, …).
          4. Add rails (Edge.Cuts lines).
          5. Add mouse-bite NPTH holes or V-score lines.
          6. Save to output_path.
        """
        # Work on a fresh board loaded from file (don't mutate live board)
        panel = pcbnew.LoadBoard(source_file)

        # Board bounding box in the loaded panel
        bbox    = panel.GetBoardEdgesBoundingBox()
        bx      = bbox.GetX()
        by      = bbox.GetY()

        # Pre-collect all source items BEFORE adding copies (avoid iterating
        # while modifying the collections)
        src_tracks    = list(panel.GetTracks())
        src_fps       = list(panel.GetFootprints())
        src_zones     = [panel.GetArea(i) for i in range(panel.GetAreaCount())]
        src_drawings  = list(panel.GetDrawings())

        # Snapshot all existing nets from the source board
        src_netmap = {}   # net_code → net_name (str)
        for net_code, net_info in panel.GetNetInfo().NetsByNetcode().items():
            src_netmap[int(net_code)] = str(net_info.GetNetname())

        copy_idx = 1  # 0 = original; copies start at 1

        for row in range(rows):
            for col in range(cols):
                if row == 0 and col == 0:
                    continue  # original board already at (0,0)

                dx = col * (board_w + gap_iu)
                dy = row * (board_h + gap_iu)
                offset = pcbnew.VECTOR2I(dx, dy)

                # Build net rename map for this copy
                net_rename = self._ensure_renamed_nets(
                    panel, pcbnew, src_netmap, copy_idx
                )
                copy_idx += 1

                # Tracks + vias
                for src in src_tracks:
                    item = src.Duplicate()
                    item.Move(offset)
                    self._renet(item, net_rename, panel)
                    panel.Add(item)

                # Footprints
                for src in src_fps:
                    item = pcbnew.FOOTPRINT(src)
                    item.Move(offset)
                    # Rename reference: R1 → P2-R1
                    try:
                        ref = str(item.GetReference())
                        item.SetReference(f"P{copy_idx}-{ref}")
                    except Exception:
                        pass
                    # Renet pads
                    for pad in item.Pads():
                        self._renet(pad, net_rename, panel)
                    panel.Add(item)

                # Zones
                for src in src_zones:
                    item = src.Duplicate()
                    item.Move(offset)
                    self._renet(item, net_rename, panel)
                    panel.Add(item)

                # Drawings (Edge.Cuts outline + silkscreen text/graphics)
                for src in src_drawings:
                    item = src.Duplicate()
                    item.Move(offset)
                    panel.Add(item)

        # ── Rails ─────────────────────────────────────────────────────────────
        if rail_iu > 0:
            self._add_rails(panel, pcbnew,
                            bx, by, board_w, board_h,
                            cols, rows, gap_iu, rail_iu)

        # ── Mouse bites ────────────────────────────────────────────────────────
        if mouse_bites and gap_iu > 0:
            self._add_mouse_bites(panel, pcbnew,
                                  bx, by, board_w, board_h,
                                  cols, rows, gap_iu,
                                  bite_dia_mm, bite_spacing_mm)

        # ── V-score lines ──────────────────────────────────────────────────────
        if v_score:
            self._add_vscores(panel, pcbnew,
                              bx, by, board_w, board_h,
                              cols, rows, gap_iu, rail_iu)

        # ── Save (zones intentionally left unfilled) ──────────────────────────
        # ZONE_FILLER.Fill() spawns its own worker threads and can block for a
        # very long time (or hang outright) when invoked from the WS server's
        # background thread rather than KiCad's main GUI thread — there is no
        # way to bound or cancel it from here. Saving unfilled is fast, safe,
        # and matches KiKit/SparkFun panelizer behaviour: the user refills with
        # Ctrl+B (Fill All Zones) after opening the panel in KiCad.
        panel.Save(output_path)
        _log.info("Panelize: saved %d×%d panel → %s", cols, rows, output_path)
        return panel

    # ── Net renaming ──────────────────────────────────────────────────────────

    @staticmethod
    def _ensure_renamed_nets(panel, pcbnew, src_netmap, copy_idx):
        """
        For copy number `copy_idx`, create renamed nets in the panel board
        and return a dict: original_net_code → new NETINFO_ITEM.
        Pattern: P{copy_idx}_{orig_name}
        """
        net_rename = {}
        net_info   = panel.GetNetInfo()
        for orig_code, orig_name in src_netmap.items():
            if orig_code <= 0 or not orig_name:
                continue
            new_name = f"P{copy_idx}_{orig_name}"
            existing = panel.FindNet(new_name)
            if existing:
                net_rename[orig_code] = existing
            else:
                new_net = pcbnew.NETINFO_ITEM(panel, new_name)
                panel.Add(new_net)
                net_rename[orig_code] = panel.FindNet(new_name) or new_net
        return net_rename

    @staticmethod
    def _renet(item, net_rename, panel):
        """Assign renamed net to an item if it has a net."""
        try:
            orig_code = item.GetNetCode()
            if orig_code in net_rename:
                item.SetNet(net_rename[orig_code])
        except (AttributeError, Exception):
            pass

    # ── Rails ─────────────────────────────────────────────────────────────────

    @staticmethod
    def _add_rails(panel, pcbnew, bx, by, board_w, board_h,
                   cols, rows, gap_iu, rail_iu):
        """
        Add a closed rectangular outline on Edge.Cuts around the entire panel.
        The original board outline(s) plus this outer frame define the panel shape.
        Rails are `rail_iu` wide on all four sides.
        """
        edge_layer = panel.GetLayerID("Edge.Cuts")

        # Total array dimensions
        arr_w = cols * board_w + max(0, cols - 1) * gap_iu
        arr_h = rows * board_h + max(0, rows - 1) * gap_iu

        # Rail outer rectangle
        x0 = bx - rail_iu
        y0 = by - rail_iu
        x1 = bx + arr_w + rail_iu
        y1 = by + arr_h + rail_iu

        lines = [
            (x0, y0, x1, y0),  # top
            (x1, y0, x1, y1),  # right
            (x1, y1, x0, y1),  # bottom
            (x0, y1, x0, y0),  # left
        ]
        for (sx, sy, ex, ey) in lines:
            seg = pcbnew.PCB_SHAPE(panel)
            seg.SetShape(pcbnew.SHAPE_T_SEGMENT)
            seg.SetStart(pcbnew.VECTOR2I(int(sx), int(sy)))
            seg.SetEnd(pcbnew.VECTOR2I(int(ex), int(ey)))
            seg.SetLayer(edge_layer)
            seg.SetWidth(int(0.05 * _MM))
            panel.Add(seg)

        _log.info("Panelize: added %d rail segments", len(lines))

    # ── Mouse bites ───────────────────────────────────────────────────────────

    @staticmethod
    def _add_mouse_bites(panel, pcbnew, bx, by, board_w, board_h,
                          cols, rows, gap_iu,
                          bite_dia_mm, bite_spacing_mm):
        """
        Place NPTH drill holes along the centre-lines of every gap between boards.
        Vertical gaps  → holes spaced across board height.
        Horizontal gaps → holes spaced across board width.
        """
        bite_dia_iu     = int(bite_dia_mm     * _MM)
        bite_spacing_iu = int(bite_spacing_mm * _MM)
        gap_centre_iu   = gap_iu // 2

        holes_added = 0

        # Vertical cuts (between columns): run top→bottom across board height
        for col in range(cols - 1):
            cx = bx + (col + 1) * board_w + col * gap_iu + gap_centre_iu
            n  = max(1, int(board_h / bite_spacing_iu))
            for i in range(n + 1):
                cy = by + int(i * board_h / n)
                h  = _make_npth(panel, pcbnew, cx, cy, bite_dia_iu)
                panel.Add(h)
                holes_added += 1

        # Horizontal cuts (between rows): run left→right across board width
        for row in range(rows - 1):
            cy = by + (row + 1) * board_h + row * gap_iu + gap_centre_iu
            n  = max(1, int(board_w / bite_spacing_iu))
            for i in range(n + 1):
                cx = bx + int(i * board_w / n)
                h  = _make_npth(panel, pcbnew, cx, cy, bite_dia_iu)
                panel.Add(h)
                holes_added += 1

        _log.info("Panelize: added %d mouse-bite holes", holes_added)

    # ── V-score lines ─────────────────────────────────────────────────────────

    @staticmethod
    def _add_vscores(panel, pcbnew, bx, by, board_w, board_h,
                     cols, rows, gap_iu, rail_iu):
        """
        Draw V-score lines on User.Comments at each gap centre.
        Lines extend 2 mm beyond the panel outline in each direction.
        """
        try:
            vscore_layer = panel.GetLayerID("User.Comments")
        except Exception:
            vscore_layer = pcbnew.Cmts_User

        extend_iu = int(2 * _MM)   # extend 2 mm past panel edge

        arr_w = cols * board_w + max(0, cols - 1) * gap_iu
        arr_h = rows * board_h + max(0, rows - 1) * gap_iu

        top_iu    = by - rail_iu - extend_iu
        bottom_iu = by + arr_h + rail_iu + extend_iu
        left_iu   = bx - rail_iu - extend_iu
        right_iu  = bx + arr_w + rail_iu + extend_iu

        line_w = int(0.1 * _MM)
        lines_added = 0

        # Vertical V-score lines between columns
        for col in range(cols - 1):
            cx = bx + (col + 1) * board_w + col * gap_iu + gap_iu // 2
            seg = pcbnew.PCB_SHAPE(panel)
            seg.SetShape(pcbnew.SHAPE_T_SEGMENT)
            seg.SetStart(pcbnew.VECTOR2I(int(cx), int(top_iu)))
            seg.SetEnd(pcbnew.VECTOR2I(int(cx), int(bottom_iu)))
            seg.SetLayer(vscore_layer)
            seg.SetWidth(line_w)
            panel.Add(seg)
            lines_added += 1

        # Horizontal V-score lines between rows
        for row in range(rows - 1):
            cy = by + (row + 1) * board_h + row * gap_iu + gap_iu // 2
            seg = pcbnew.PCB_SHAPE(panel)
            seg.SetShape(pcbnew.SHAPE_T_SEGMENT)
            seg.SetStart(pcbnew.VECTOR2I(int(left_iu), int(cy)))
            seg.SetEnd(pcbnew.VECTOR2I(int(right_iu), int(cy)))
            seg.SetLayer(vscore_layer)
            seg.SetWidth(line_w)
            panel.Add(seg)
            lines_added += 1

        _log.info("Panelize: added %d V-score lines", lines_added)

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _ms(t0: float) -> int:
        return int((time.perf_counter() - t0) * 1000)

    @staticmethod
    def _err(msg: str, t0: float) -> dict:
        _log.warning("Panelize error: %s", msg)
        return {
            "success":         False,
            "message":         msg,
            "panel_width_mm":  0.0,
            "panel_height_mm": 0.0,
            "board_count":     0,
            "output_path":     "",
            "preview_outline": [],
            "elapsed_ms":      0,
        }


# ── Module-level helpers ──────────────────────────────────────────────────────

def _make_npth(panel, pcbnew, cx, cy, dia_iu):
    """Create a non-plated through-hole footprint (mouse bite)."""
    fp = pcbnew.FOOTPRINT(panel)
    fp.SetPosition(pcbnew.VECTOR2I(int(cx), int(cy)))

    pad = pcbnew.PAD(fp)
    pad.SetShape(pcbnew.PAD_SHAPE_CIRCLE)
    pad.SetAttribute(pcbnew.PAD_ATTRIB_NPTH)
    pad.SetDrillSize(pcbnew.VECTOR2I(dia_iu, dia_iu))
    pad.SetSize(pcbnew.VECTOR2I(dia_iu, dia_iu))
    pad.SetPosition(pcbnew.VECTOR2I(int(cx), int(cy)))

    try:
        pad.SetLayerSet(pcbnew.LSET.AllCuMask())
    except Exception:
        pass

    fp.Add(pad)
    return fp
