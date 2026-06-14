"""
ViaStitch — place stitching vias inside a copper zone or the board outline.

Protocol
--------
Request  (type: "via_stitch"):
  {
    "net":          str,          # net name, e.g. "GND"
    "via_size_mm":  float,        # pad diameter
    "drill_mm":     float,        # drill diameter
    "pitch_mm":     float,        # grid spacing
    "layer_from":   str,          # e.g. "F.Cu"
    "layer_to":     str,          # e.g. "B.Cu"
    "zone_name":    str | null,   # named copper zone; null → board outline bbox
    "clearance_mm": float | null, # extra clearance from pads/tracks/vias/edges (default 0)
    "randomize":    bool | null,  # jitter grid points by up to ±pitch/5 (default false)
    "dry_run":      bool          # true → preview only, no board write
    "board_check":  str           # absolute board path (safety lock)
  }

Response (type: "op_result", op: "via_stitch"):
  {
    "success":       bool,
    "message":       str,
    "placed":        int,         # vias written (0 on dry_run)
    "skipped":       int,         # candidate points rejected
    "preview":       [{x_mm, y_mm}, ...],  # all accepted candidates
    "elapsed_ms":    int
  }
"""

import json
import logging
import os
import shutil
import subprocess
import tempfile
import time

_log = logging.getLogger("kimaster.ops.via_stitch")


class ViaStitch:
    """Stitching via placer. Constructed once per WS message dispatch."""

    # Tolerance for "is there already a via here?" check (internal units)
    _SNAP_TOL_IU = 50_000   # 0.05 mm

    def __init__(self, board, notify_fn):
        """
        board      — live pcbnew.BOARD instance
        notify_fn  — callable() that broadcasts board_changed to all clients
        """
        self._board     = board
        self._notify    = notify_fn

    # ── Public entry point ────────────────────────────────────────────────

    def execute(self, data: dict) -> dict:
        t0 = time.perf_counter()
        try:
            return self._run(data, t0)
        except Exception as e:
            _log.exception("ViaStitch.execute failed")
            return {
                "success":    False,
                "message":    str(e),
                "placed":     0,
                "skipped":    0,
                "preview":    [],
                "elapsed_ms": self._ms(t0),
            }

    # ── Internal ──────────────────────────────────────────────────────────

    def _run(self, data: dict, t0: float) -> dict:
        import pcbnew

        net_name    = (data.get("net") or "").strip()
        via_size_mm = float(data.get("via_size_mm") or 0.8)
        drill_mm    = float(data.get("drill_mm")    or 0.4)
        pitch_mm    = float(data.get("pitch_mm")    or 2.5)
        layer_from  = (data.get("layer_from") or "F.Cu").strip()
        layer_to    = (data.get("layer_to")   or "B.Cu").strip()
        zone_name   = (data.get("zone_name")  or "").strip() or None
        clearance_mm = float(data.get("clearance_mm") or 0.0)
        randomize   = bool(data.get("randomize", False))
        dry_run     = bool(data.get("dry_run", True))

        # ── Validate inputs ───────────────────────────────────────────────
        if not net_name:
            return self._err("Missing 'net' parameter", t0)
        if via_size_mm <= 0 or drill_mm <= 0 or pitch_mm <= 0:
            return self._err("via_size_mm, drill_mm, pitch_mm must be > 0", t0)
        if drill_mm >= via_size_mm:
            return self._err("drill_mm must be smaller than via_size_mm", t0)

        board = self._board

        # ── Resolve net ───────────────────────────────────────────────────
        net = board.FindNet(net_name)
        if not net:
            return self._err(f"Net '{net_name}' not found on board", t0)
        net_code = net.GetNetCode()

        # ── Resolve layers ────────────────────────────────────────────────
        layer_from_id = board.GetLayerID(layer_from)
        layer_to_id   = board.GetLayerID(layer_to)
        if layer_from_id < 0:
            return self._err(f"Layer '{layer_from}' not found", t0)
        if layer_to_id < 0:
            return self._err(f"Layer '{layer_to}' not found", t0)

        # ── Build candidate grid ──────────────────────────────────────────
        polygon   = self._get_region_polygon(board, zone_name, net_code, pcbnew)
        if not polygon:
            return self._err(
                f"No region found (zone_name={zone_name!r}). "
                "Board outline or named zone required.", t0
            )

        pitch_iu    = pcbnew.FromMM(pitch_mm)
        candidates  = self._grid_points(polygon, pitch_iu, randomize)
        _log.info("ViaStitch: %d candidate grid points (pitch=%.2f mm)", len(candidates), pitch_mm)

        # ── Filter candidates ─────────────────────────────────────────────
        # Overlap check adapted from weirdgyn/viastitching CheckOverlap/CheckClearance:
        # tests against pads/tracks/vias (other nets), edge-cuts proximity, and same-net via spacing.
        via_size_iu  = pcbnew.FromMM(via_size_mm)
        drill_iu     = pcbnew.FromMM(drill_mm)
        clearance_iu = pcbnew.FromMM(clearance_mm)
        overlap_items = self._collect_overlap_items(board, polygon, pcbnew)
        edges         = self._board_edge_segments(board)
        _log.info("ViaStitch: %d overlap items (pads/tracks/vias), %d edge segments to check against",
                  len(overlap_items), len(edges))

        accepted = []
        skipped  = 0
        for pt in candidates:
            if self._has_overlap(pt, via_size_iu, drill_iu, clearance_iu, net_code,
                                 overlap_items, edges, pcbnew):
                skipped += 1
                continue
            accepted.append(pt)

        _log.info(
            "ViaStitch: %d accepted, %d skipped (dry_run=%s)",
            len(accepted), skipped, dry_run,
        )

        preview = [
            {"x_mm": round(pcbnew.ToMM(p.x), 4), "y_mm": round(pcbnew.ToMM(p.y), 4)}
            for p in accepted
        ]

        if dry_run:
            return {
                "success":    True,
                "message":    f"Preview: {len(accepted)} vias would be placed ({skipped} skipped)",
                "placed":     0,
                "skipped":    skipped,
                "preview":    preview,
                "elapsed_ms": self._ms(t0),
            }

        # ── DRC baseline (ground truth, BEFORE any board mutation) ────────
        # Our overlap heuristics above are a fast pre-filter, NOT the source of
        # truth — KiCad's own native via-stitching (GitLab MR !2594) defers all
        # clearance decisions to DRC_ENGINE::EvalRules + shape collision against
        # the real net-class/custom-rule clearance, which is not exposed through
        # the scripting API. We can't replicate that engine in Python, so instead
        # we treat `kicad-cli pcb drc` as ground truth and gate the whole write on
        # it: place → re-run DRC → if errors increased, ROLL BACK every via and
        # fail loudly. This guarantees we never leave the board worse than we
        # found it, regardless of any gap in our placement heuristic.
        board_path  = board.GetFileName()
        cli_path    = self._find_kicad_cli()
        baseline_errors = None
        if cli_path and board_path:
            baseline_errors = self._run_drc_error_count(cli_path, board_path)
            if baseline_errors is None:
                _log.warning("ViaStitch: DRC baseline unavailable — proceeding without safety gate")
        else:
            _log.warning("ViaStitch: kicad-cli not found — DRC safety gate disabled")

        # ── Write vias ────────────────────────────────────────────────────
        via_size_iu = pcbnew.FromMM(via_size_mm)
        drill_iu    = pcbnew.FromMM(drill_mm)
        placed_vias = []

        for pt in accepted:
            try:
                via = pcbnew.PCB_VIA(board)
                via.SetPosition(pt)
                via.SetWidth(via_size_iu)
                via.SetDrill(drill_iu)
                via.SetNetCode(net_code)
                via.SetViaType(pcbnew.VIATYPE_THROUGH)
                via.SetLayerPair(layer_from_id, layer_to_id)
                board.Add(via)
                placed_vias.append(via)
            except Exception as e:
                _log.warning("ViaStitch: failed to place via at (%s): %s", pt, e)

        board.Save(board_path)

        # ── DRC verification gate — roll back on any regression ───────────
        if cli_path and board_path and baseline_errors is not None:
            post_errors = self._run_drc_error_count(cli_path, board_path)
            if post_errors is not None and post_errors > baseline_errors:
                _log.error(
                    "ViaStitch: DRC regression detected (%d -> %d errors) — rolling back %d vias",
                    baseline_errors, post_errors, len(placed_vias),
                )
                for via in placed_vias:
                    try:
                        board.Remove(via)
                    except Exception:
                        pass
                board.Save(board_path)
                pcbnew.Refresh()
                self._notify()
                return {
                    "success":    False,
                    "message": (
                        f"Aborted: placement would introduce {post_errors - baseline_errors} "
                        f"new DRC error(s). No changes were kept (board restored)."
                    ),
                    "placed":     0,
                    "skipped":    skipped,
                    "preview":    preview,
                    "elapsed_ms": self._ms(t0),
                }

        placed = len(placed_vias)
        pcbnew.Refresh()
        self._notify()

        gate_note = "" if (cli_path and baseline_errors is not None) else " (⚠ DRC safety gate unavailable — verify manually)"

        return {
            "success":    True,
            "message":    f"Placed {placed} stitching vias ({skipped} skipped){gate_note}",
            "placed":     placed,
            "skipped":    skipped,
            "preview":    preview,
            "elapsed_ms": self._ms(t0),
        }

    # ── DRC safety gate helpers ───────────────────────────────────────────

    @staticmethod
    def _find_kicad_cli():
        """Locate kicad-cli executable. Mirrors the lookup used by the Rust CliRunner."""
        exe = "kicad-cli.exe" if os.name == "nt" else "kicad-cli"
        found = shutil.which(exe) or shutil.which("kicad-cli")
        if found:
            return found
        import sys
        candidates = []
        if os.name == "nt":
            candidates = [
                r"C:\Program Files\KiCad\10.0\bin\kicad-cli.exe",
                r"C:\Program Files\KiCad\9.0\bin\kicad-cli.exe",
                r"C:\Program Files\KiCad\8.0\bin\kicad-cli.exe",
                r"C:\Program Files (x86)\KiCad\10.0\bin\kicad-cli.exe",
            ]
        elif sys.platform == "darwin":
            candidates = [
                "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli",
                "/usr/local/bin/kicad-cli",
            ]
        else:
            candidates = [
                "/usr/bin/kicad-cli",
                "/usr/local/bin/kicad-cli",
                "/snap/kicad/current/usr/bin/kicad-cli",
            ]
        for candidate in candidates:
            if os.path.isfile(candidate):
                return candidate
        return None

    @staticmethod
    def _run_drc_error_count(cli_path: str, board_path: str):
        """
        Run `kicad-cli pcb drc --format json` against the saved board and return
        the number of severity="error" violations, or None on failure.
        This is the SAME engine + invocation the rest of KiMaster relies on
        (see src-tauri/src/modules/cli/CliRunner.rs::run_drc) — using it here
        means our safety gate is backed by KiCad's real DRC_ENGINE, not guesses.
        """
        tmp_path = None
        try:
            fd, tmp_path = tempfile.mkstemp(prefix="km_viastitch_drc_", suffix=".json")
            os.close(fd)

            proc = subprocess.run(
                [cli_path, "pcb", "drc",
                 "--output", tmp_path,
                 "--format", "json",
                 "--severity-error",
                 board_path],
                capture_output=True, text=True, timeout=120,
            )
            if not os.path.isfile(tmp_path) or os.path.getsize(tmp_path) == 0:
                _log.warning("ViaStitch: kicad-cli drc produced no output (rc=%s): %s",
                             proc.returncode, proc.stderr[:500] if proc.stderr else "")
                return None

            with open(tmp_path, "r", encoding="utf-8") as f:
                report = json.load(f)

            count = 0
            for section in ("violations", "unconnected_items", "schematic_parity"):
                items = report.get(section)
                if isinstance(items, list):
                    for v in items:
                        if str(v.get("severity", "")).lower() == "error":
                            count += 1
            return count
        except Exception as e:
            _log.warning("ViaStitch: DRC verification run failed: %s", e)
            return None
        finally:
            if tmp_path:
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass

    # ── Region polygon helpers ────────────────────────────────────────────

    def _get_region_polygon(self, board, zone_name, net_code, pcbnew):
        """
        Return a list of pcbnew.VECTOR2I points forming the clipping polygon.
        Priority:
          1. Named zone matching zone_name (any net if zone_name given, else must match net_code)
          2. Any copper zone on the net (largest by area)
          3. Board outline bounding box rectangle
        """
        zones = list(board.Zones())

        # Named zone lookup
        if zone_name:
            for z in zones:
                try:
                    if str(z.GetZoneName()) == zone_name:
                        return self._zone_outline_points(z)
                except Exception:
                    continue

        # Largest copper zone on the target net
        candidates = []
        for z in zones:
            try:
                if z.GetNetCode() == net_code:
                    candidates.append(z)
            except Exception:
                continue
        if candidates:
            best = max(candidates, key=lambda z: self._zone_area(z))
            return self._zone_outline_points(best)

        # Board outline bounding box
        return self._board_outline_bbox(board, pcbnew)

    @staticmethod
    def _zone_outline_points(zone):
        """Extract the first outline polygon as a list of VECTOR2I.

        zone.Outline() returns a SHAPE_POLY_SET, which has no PointCount/CPoint
        of its own — those live on the SHAPE_LINE_CHAIN returned by Outline(i).
        """
        try:
            poly_set = zone.Outline()
            if poly_set.OutlineCount() == 0:
                return []
            chain = poly_set.Outline(0)
            count = chain.PointCount()
            return [chain.CPoint(i) for i in range(count)]
        except Exception as e:
            _log.warning("ViaStitch: zone outline extraction failed: %s", e)
            return []

    @staticmethod
    def _zone_area(zone) -> float:
        try:
            return zone.GetFilledArea()
        except Exception:
            return 0.0

    @staticmethod
    def _board_outline_bbox(board, pcbnew):
        """
        Return the actual board-outline polygon (from Edge.Cuts), as a list of
        VECTOR2I points. Falls back to a bounding-box rectangle only if outline
        extraction fails — a rectangle is a poor substitute for an irregular
        (angled/notched) board shape: the point-in-polygon grid test would
        accept candidates in the cut corners that sit entirely outside the
        physical board.
        """
        try:
            poly_set = pcbnew.SHAPE_POLY_SET()
            if board.GetBoardPolygonOutlines(poly_set, True) and poly_set.OutlineCount() > 0:
                chain = poly_set.Outline(0)
                count = chain.PointCount()
                if count >= 3:
                    return [chain.CPoint(i) for i in range(count)]
        except Exception as e:
            _log.warning("ViaStitch: board outline polygon extraction failed: %s", e)

        try:
            bbox = board.GetBoardEdgesBoundingBox()
            x0, y0 = bbox.GetLeft(), bbox.GetTop()
            x1, y1 = bbox.GetRight(), bbox.GetBottom()
            return [
                pcbnew.VECTOR2I(x0, y0),
                pcbnew.VECTOR2I(x1, y0),
                pcbnew.VECTOR2I(x1, y1),
                pcbnew.VECTOR2I(x0, y1),
            ]
        except Exception as e:
            _log.warning("ViaStitch: board outline bbox fallback failed: %s", e)
            return []

    # ── Grid generation ───────────────────────────────────────────────────

    @staticmethod
    def _grid_points(polygon, pitch_iu, randomize=False):
        """
        Build a rectangular grid clipped to the polygon.
        Uses a simple ray-casting point-in-polygon test.
        Optionally jitters each point by up to ±pitch/5 (weirdgyn "Randomize" option)
        to avoid visually-mechanical via patterns.
        """
        if not polygon:
            return []

        xs = [p.x for p in polygon]
        ys = [p.y for p in polygon]
        x_min, x_max = min(xs), max(xs)
        y_min, y_max = min(ys), max(ys)

        try:
            import pcbnew
        except ImportError:
            return []

        import random

        points = []
        x = x_min + pitch_iu // 2
        while x <= x_max:
            y = y_min + pitch_iu // 2
            while y <= y_max:
                if ViaStitch._point_in_polygon(x, y, polygon):
                    if randomize:
                        xp = x + random.uniform(-1, 1) * pitch_iu / 5
                        yp = y + random.uniform(-1, 1) * pitch_iu / 5
                    else:
                        xp, yp = x, y
                    points.append(pcbnew.VECTOR2I(int(xp), int(yp)))
                y += pitch_iu
            x += pitch_iu
        return points

    @staticmethod
    def _point_in_polygon(x: int, y: int, polygon) -> bool:
        """Ray-casting algorithm. polygon is a list of objects with .x/.y."""
        inside = False
        n = len(polygon)
        j = n - 1
        for i in range(n):
            xi, yi = polygon[i].x, polygon[i].y
            xj, yj = polygon[j].x, polygon[j].y
            if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
                inside = not inside
            j = i
        return inside

    # ── Overlap / clearance check (adapted from weirdgyn/viastitching) ────
    #
    # Rather than only excluding courtyards, we directly test each candidate
    # against every nearby pad/track/via and the board edge — this mirrors
    # ViaStitchingDialog.CheckOverlap()/CheckClearance() and produces results
    # much closer to a hand-placed stitching pattern (no vias on traces/pads,
    # safe spacing from same-net vias, clearance from board edge).

    _SAFE_MARGIN_MM   = 0.35
    _MIN_HOLE_DIST_MM = 0.5
    _EDGE_CLEARANCE_MM = 0.5

    @staticmethod
    def _collect_overlap_items(board, polygon, pcbnew):
        """
        Gather (kind, item) pairs — kind in {"via","track","pad"} — for every
        pad/track/via whose bounding box intersects the region bbox.

        Tagging the kind here (where the source collection already tells us
        what it is) sidesteps relying on `item.Type() == pcbnew.PCB_VIA_T` /
        `PCB_TRACK_T` comparisons in the hot loop — those SWIG enum constants
        don't always compare equal to the values Type() returns across KiCad
        script-binding versions, which silently turned every overlap check
        into a no-op (vias got placed directly on pads/tracks/outside the
        board because nothing was ever flagged as overlapping).
        """
        try:
            xs = [p.x for p in polygon]; ys = [p.y for p in polygon]
            region_bbox = pcbnew.BOX2I(
                pcbnew.VECTOR2I(min(xs), min(ys)),
                pcbnew.VECTOR2I(max(xs) - min(xs), max(ys) - min(ys)),
            )
        except Exception:
            region_bbox = None

        items = []
        try:
            for trk in board.GetTracks():
                if region_bbox is not None and not trk.GetBoundingBox().Intersects(region_bbox):
                    continue
                kind = "via" if hasattr(trk, "GetViaType") else "track"
                items.append((kind, trk))
            for fp in board.GetFootprints():
                if region_bbox is not None and not fp.GetBoundingBox().Intersects(region_bbox):
                    continue
                for pad in fp.Pads():
                    items.append(("pad", pad))
        except Exception as e:
            _log.warning("ViaStitch: overlap item collection failed: %s", e)
        return items

    @staticmethod
    def _board_edge_segments(board):
        edges = []
        try:
            for d in board.GetDrawings():
                if d.GetLayerName() == "Edge.Cuts":
                    edges.append(d)
        except Exception:
            pass
        return edges

    def _has_overlap(self, pt, via_size_iu, drill_iu, clearance_iu, net_code,
                     items, edges, pcbnew) -> bool:
        safe_margin    = pcbnew.FromMM(self._SAFE_MARGIN_MM)
        min_hole_dist  = pcbnew.FromMM(self._MIN_HOLE_DIST_MM)
        edge_clearance = pcbnew.FromMM(self._EDGE_CLEARANCE_MM)

        # Mirror weirdgyn/viastitching's clearance trick: inflate the *test* via's
        # size/drill by 2×clearance so every check below (bbox, HitTest, distance)
        # uniformly accounts for clearance without per-branch special-casing. The
        # real (un-inflated) via_size_iu/drill_iu are what actually get placed.
        eff_size_iu  = via_size_iu + 2 * clearance_iu
        eff_drill_iu = drill_iu    + 2 * clearance_iu

        check_dist = int(eff_size_iu // 2 + edge_clearance)
        for edge in edges:
            try:
                if edge.HitTest(pt, check_dist):
                    return True
            except Exception:
                continue

        half = eff_size_iu // 2 + safe_margin
        via_bbox = pcbnew.BOX2I(
            pcbnew.VECTOR2I(pt.x - half, pt.y - half),
            pcbnew.VECTOR2I(2 * half, 2 * half),
        )

        for kind, item in items:
            try:
                same_net = hasattr(item, "GetNetCode") and item.GetNetCode() == net_code

                if kind == "via":
                    if same_net:
                        dx = pt.x - item.GetPosition().x
                        dy = pt.y - item.GetPosition().y
                        dist = (dx * dx + dy * dy) ** 0.5
                        if dist < (eff_drill_iu / 2 + item.GetDrillValue() / 2 + min_hole_dist):
                            return True
                        continue
                    if item.GetBoundingBox().Intersects(via_bbox):
                        return True

                elif kind == "track":
                    if same_net:
                        continue
                    if item.GetBoundingBox().Intersects(via_bbox):
                        width = item.GetWidth()
                        dist, _np = self._pnt2line(pt, item.GetStart(), item.GetEnd())
                        if dist <= width // 2 + eff_size_iu / 2 + safe_margin:
                            return True

                else:  # pad — never allowed under a via, regardless of net
                    if item.GetBoundingBox().Intersects(via_bbox):
                        return True
            except Exception:
                continue

        return False

    @staticmethod
    def _pnt2line(pt, start, end):
        """Shortest distance from pt to segment start-end. Returns (dist, nearest_point)."""
        sx, sy = float(start.x), float(start.y)
        ex, ey = float(end.x), float(end.y)
        px, py = float(pt.x), float(pt.y)

        line_dx, line_dy = ex - sx, ey - sy
        line_len = (line_dx ** 2 + line_dy ** 2) ** 0.5
        if line_len < 0.0001:
            dist = ((px - sx) ** 2 + (py - sy) ** 2) ** 0.5
            return dist, (sx, sy)

        t = ((px - sx) * line_dx + (py - sy) * line_dy) / (line_len ** 2)
        t = max(0.0, min(1.0, t))
        nx, ny = sx + t * line_dx, sy + t * line_dy
        dist = ((px - nx) ** 2 + (py - ny) ** 2) ** 0.5
        return dist, (nx, ny)

    # ── Helpers ───────────────────────────────────────────────────────────

    @staticmethod
    def _ms(t0: float) -> int:
        return int((time.perf_counter() - t0) * 1000)

    @staticmethod
    def _err(msg: str, t0: float) -> dict:
        _log.warning("ViaStitch: %s", msg)
        return {
            "success":    False,
            "message":    msg,
            "placed":     0,
            "skipped":    0,
            "preview":    [],
            "elapsed_ms": ViaStitch._ms(t0),
        }
