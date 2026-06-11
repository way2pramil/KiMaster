"""
SchematicExporter — parses a .kicad_sch file (S-expression format) and
returns structured data without requiring the eeschema Python API.

The bridge plugin runs inside the PCB editor (pcbnew), which has no direct
access to the schematic data model. We derive the .kicad_sch path from the
open .kicad_pcb path and parse the file ourselves.

Data returned by get_schematic_state():
  {
    "sch_path":      str,          # absolute path that was parsed
    "symbols":       [Symbol],     # every symbol instance (one per unit placement)
    "components":    [Component],  # de-duplicated by reference (multi-unit merged)
    "net_labels":    [NetLabel],   # global/local labels and power symbols
    "sheet_count":   int,          # number of (hierarchical) sheets found
    "no_connect_count": int,
    "error":         str|null      # parse error message, if any
  }

Symbol:
  { "ref", "value", "footprint", "lib_id", "unit", "on_back",
    "position": {"x", "y", "angle"}, "properties": {name: value}, "uuid" }

Component (merged multi-unit):
  { "ref", "value", "footprint", "lib_id", "properties": {name: value} }

NetLabel:
  { "type": "label"|"global_label"|"power"|"hierarchical_label",
    "name": str, "position": {"x", "y"} }
"""

import logging
import os
import re
from typing import Any, Dict, List, Optional, Tuple

_log = logging.getLogger("kimaster.schematic")


# ── S-expression tokeniser / parser ─────────────────────────────────────────

_TOKEN_RE = re.compile(
    r'"(?:[^"\\]|\\.)*"'   # quoted string (may contain spaces / parens)
    r'|[()]'               # open / close paren
    r'|[^\s"()]+',         # unquoted atom
)


def _tokenize(text: str) -> List[str]:
    return _TOKEN_RE.findall(text)


def _parse_tokens(tokens: List[str], pos: List[int]) -> Any:
    """Recursively build a nested list from a flat token stream."""
    if pos[0] >= len(tokens):
        return None

    tok = tokens[pos[0]]
    pos[0] += 1

    if tok == '(':
        children = []
        while pos[0] < len(tokens) and tokens[pos[0]] != ')':
            children.append(_parse_tokens(tokens, pos))
        pos[0] += 1  # consume ')'
        return children

    if tok.startswith('"') and tok.endswith('"'):
        # Strip outer quotes and unescape backslash sequences
        return tok[1:-1].replace('\\"', '"').replace('\\\\', '\\')

    return tok


def _parse_sexpr(text: str) -> Any:
    tokens = _tokenize(text)
    pos = [0]
    return _parse_tokens(tokens, pos)


# ── Helpers to navigate the parsed tree ──────────────────────────────────────

def _children(node) -> List:
    """Return direct list children of a node (skip scalars)."""
    if not isinstance(node, list):
        return []
    return [c for c in node if isinstance(c, list)]


def _find_all(node, key: str) -> List:
    """All direct list children whose first element == key."""
    return [c for c in _children(node) if c and c[0] == key]


def _find_first(node, key: str) -> Optional[List]:
    results = _find_all(node, key)
    return results[0] if results else None


def _scalar(node, key: str, default: str = "") -> str:
    """Return the second element of the first child named key, or default."""
    child = _find_first(node, key)
    if child and len(child) > 1:
        return str(child[1])
    return default


def _at(node) -> Dict:
    """Parse an (at x y [angle]) child into {"x", "y", "angle"}."""
    child = _find_first(node, "at")
    if child and len(child) >= 3:
        try:
            return {
                "x":     round(float(child[1]), 4),
                "y":     round(float(child[2]), 4),
                "angle": round(float(child[3]), 2) if len(child) > 3 else 0.0,
            }
        except (ValueError, TypeError):
            pass
    return {"x": 0.0, "y": 0.0, "angle": 0.0}


# ── SchematicExporter ────────────────────────────────────────────────────────

class SchematicExporter:
    """
    Parses a .kicad_sch file and serialises its contents to plain dicts.
    Attach a PCB path; the matching .kicad_sch is auto-discovered.
    """

    def __init__(self):
        self._pcb_path: Optional[str] = None
        self._sch_path: Optional[str] = None

    # ── Public ────────────────────────────────────────────────────────────────

    def attach_pcb_path(self, pcb_path: str):
        """
        Derive the schematic path from the PCB path.
        E.g. /proj/board.kicad_pcb → /proj/board.kicad_sch
        Falls back to scanning the project directory for the first .kicad_sch.
        """
        self._pcb_path = pcb_path
        self._sch_path = self._resolve_sch_path(pcb_path)
        _log.info("SchematicExporter: pcb=%s  sch=%s", pcb_path, self._sch_path)

    def get_schematic_state(self) -> Dict[str, Any]:
        if not self._sch_path:
            return self._empty(error="No schematic path — call attach_pcb_path() first")

        if not os.path.isfile(self._sch_path):
            return self._empty(error=f"Schematic not found: {self._sch_path}")

        try:
            with open(self._sch_path, "r", encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        except OSError as e:
            return self._empty(error=f"Cannot read {self._sch_path}: {e}")

        try:
            return self._parse(text)
        except Exception as e:
            _log.warning("SchematicExporter: parse error: %s", e)
            return self._empty(error=str(e))

    # ── Path resolution ───────────────────────────────────────────────────────

    @staticmethod
    def _resolve_sch_path(pcb_path: str) -> Optional[str]:
        stem = os.path.splitext(pcb_path)[0]
        candidate = stem + ".kicad_sch"
        if os.path.isfile(candidate):
            return candidate

        # Fallback: scan project directory for the first .kicad_sch
        proj_dir = os.path.dirname(pcb_path)
        try:
            for name in os.listdir(proj_dir):
                if name.endswith(".kicad_sch"):
                    return os.path.join(proj_dir, name)
        except OSError:
            pass

        return None

    # ── Core parser ───────────────────────────────────────────────────────────

    def _parse(self, text: str) -> Dict[str, Any]:
        root = _parse_sexpr(text)
        if not isinstance(root, list) or not root:
            return self._empty(error="Empty or invalid S-expression")

        symbols      = self._extract_symbols(root)
        components   = self._merge_units(symbols)
        net_labels   = self._extract_labels(root)
        sheet_count  = len(_find_all(root, "sheet")) + 1  # +1 for the root sheet
        nc_count     = len(_find_all(root, "no_connect"))

        return {
            "sch_path":        self._sch_path,
            "symbols":         symbols,
            "components":      components,
            "net_labels":      net_labels,
            "sheet_count":     sheet_count,
            "no_connect_count": nc_count,
            "error":           None,
        }

    # ── Symbol extraction ─────────────────────────────────────────────────────

    def _extract_symbols(self, root: list) -> List[Dict]:
        """
        Each (symbol ...) in the root sheet represents one unit placement.
        We collect all of them, merging properties cleanly.
        """
        results = []
        for sym in _find_all(root, "symbol"):
            try:
                results.append(self._parse_symbol(sym))
            except Exception as e:
                _log.debug("SchematicExporter: skip symbol: %s", e)
        return results

    def _parse_symbol(self, sym: list) -> Dict:
        # Properties: (property "Name" "Value" ...)
        properties: Dict[str, str] = {}
        for prop in _find_all(sym, "property"):
            if len(prop) >= 3:
                key = str(prop[1])
                val = str(prop[2])
                properties[key] = val

        ref       = properties.get("Reference", "")
        value     = properties.get("Value", "")
        footprint = properties.get("Footprint", "")
        lib_id    = _scalar(sym, "lib_id")
        unit_raw  = _scalar(sym, "unit", "1")
        on_back   = _scalar(sym, "mirror", "") == "y"
        uuid      = _scalar(sym, "uuid")
        pos       = _at(sym)

        try:
            unit = int(unit_raw)
        except ValueError:
            unit = 1

        return {
            "ref":        ref,
            "value":      value,
            "footprint":  footprint,
            "lib_id":     lib_id,
            "unit":       unit,
            "on_back":    on_back,
            "position":   pos,
            "properties": properties,
            "uuid":       uuid,
        }

    # ── Component de-duplication (multi-unit merge) ───────────────────────────

    @staticmethod
    def _merge_units(symbols: List[Dict]) -> List[Dict]:
        """
        Multi-unit ICs appear once per unit in the schematic.
        Merge into one component entry per reference designator.
        Properties are merged (last non-empty value wins).
        """
        seen: Dict[str, Dict] = {}
        for sym in symbols:
            ref = sym["ref"]
            if not ref or ref.startswith("#"):
                # Power symbols (e.g. #PWR01) — skip
                continue
            if ref not in seen:
                seen[ref] = {
                    "ref":        ref,
                    "value":      sym["value"],
                    "footprint":  sym["footprint"],
                    "lib_id":     sym["lib_id"],
                    "properties": dict(sym["properties"]),
                }
            else:
                # Merge — keep first non-empty value for each property
                for k, v in sym["properties"].items():
                    if v and not seen[ref]["properties"].get(k):
                        seen[ref]["properties"][k] = v
                if sym["footprint"] and not seen[ref]["footprint"]:
                    seen[ref]["footprint"] = sym["footprint"]

        return sorted(seen.values(), key=lambda c: c["ref"])

    # ── Net label extraction ──────────────────────────────────────────────────

    def _extract_labels(self, root: list) -> List[Dict]:
        labels = []
        for kind in ("label", "global_label", "hierarchical_label"):
            for node in _find_all(root, kind):
                try:
                    name = node[1] if len(node) > 1 else ""
                    labels.append({
                        "type":     kind,
                        "name":     str(name),
                        "position": _at(node),
                    })
                except Exception:
                    pass

        # Power symbols (lib_id starts with "power:")
        for sym in _find_all(root, "symbol"):
            lib_id = _scalar(sym, "lib_id")
            if lib_id.startswith("power:"):
                properties = {}
                for prop in _find_all(sym, "property"):
                    if len(prop) >= 3:
                        properties[str(prop[1])] = str(prop[2])
                net_name = properties.get("Value", lib_id.split(":")[-1])
                labels.append({
                    "type":     "power",
                    "name":     net_name,
                    "position": _at(sym),
                })

        return labels

    # ── Empty state ───────────────────────────────────────────────────────────

    def _empty(self, error: str = "") -> Dict[str, Any]:
        return {
            "sch_path":        self._sch_path,
            "symbols":         [],
            "components":      [],
            "net_labels":      [],
            "sheet_count":     0,
            "no_connect_count": 0,
            "error":           error or None,
        }
