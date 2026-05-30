"""
KiCad API Probe Script — Anti-Hallucination Protocol.

Run this INSIDE KiCad's scripting console BEFORE implementing any pcbnew API
calls. This confirms the exact method names, return types, and data shapes
available in your KiCad version.

Usage in KiCad scripting console:
    exec(open('D:/AI_tools/KiMaster/KiMaster/bridge/probe/ProbeKiCadApi.py').read())
    probe_all()

Each probe prints confirmed API shapes — only use confirmed APIs in BoardExporter.py.
"""

import json


# ── Helpers ────────────────────────────────────────────────────────────────

def _safe(fn, default="N/A"):
    try:
        return fn()
    except Exception as e:
        return f"ERROR: {e}"


def _header(title: str):
    bar = "=" * 55
    print(f"\n{bar}\n  {title}\n{bar}")


# ── Probes ─────────────────────────────────────────────────────────────────

def probe_version():
    """Confirm KiCad version and build info."""
    import pcbnew
    _header("KiCad Version")
    print(f"  GetBuildVersion : {_safe(pcbnew.GetBuildVersion)}")
    print(f"  KICAD_MAJOR_VER : {_safe(lambda: pcbnew.KICAD_MAJOR_VERSION)}")


def probe_board(board=None):
    """Probe basic board methods."""
    import pcbnew
    board = board or pcbnew.GetBoard()
    _header("Board basics")
    print(f"  GetFileName     : {_safe(board.GetFileName)}")
    print(f"  GetCopperLayerCount: {_safe(board.GetCopperLayerCount)}")

    fps = list(board.GetFootprints())
    print(f"  GetFootprints() : {len(fps)} footprints")
    return board


def probe_footprint(board=None):
    """Probe footprint / component API."""
    import pcbnew
    board = board or pcbnew.GetBoard()
    fps = list(board.GetFootprints())
    if not fps:
        print("  [no footprints]")
        return

    fp = fps[0]
    _header(f"Footprint API  (fp = '{fp.GetReference()}')")
    pos = fp.GetPosition()
    print(f"  GetReference()      : {_safe(fp.GetReference)}")
    print(f"  GetValue()          : {_safe(fp.GetValue)}")
    print(f"  GetFPIDAsString()   : {_safe(fp.GetFPIDAsString)}")
    print(f"  GetPosition()       : x={pos.x}  y={pos.y}  (IU; /1e6 = mm)")
    print(f"  IsFlipped()         : {_safe(fp.IsFlipped)}")
    print(f"  IsLocked()          : {_safe(fp.IsLocked)}")
    print(f"  IsSelected()        : {_safe(fp.IsSelected)}")
    print(f"  GetDNP()            : {_safe(fp.GetDNP) if hasattr(fp, 'GetDNP') else 'N/A (KiCad<9?)'}")

    # Orientation
    if hasattr(fp, 'GetOrientationDegrees'):
        print(f"  GetOrientationDegrees(): {_safe(fp.GetOrientationDegrees)}")
    elif hasattr(fp, 'GetOrientation'):
        print(f"  GetOrientation()/10.0   : {_safe(fp.GetOrientation) / 10.0}")

    # Fields
    try:
        fields = fp.GetFields()
        for f in list(fields)[:4]:
            print(f"  Field '{f.GetName()}' = '{f.GetText()}'")
    except Exception as e:
        print(f"  Fields error: {e}")

    # Pads
    try:
        pads = list(fp.Pads())
        print(f"  Pads(): {len(pads)} pads")
        if pads:
            p = pads[0]
            print(f"    pad[0].GetNetname(): {_safe(p.GetNetname)}")
    except Exception as e:
        print(f"  Pads error: {e}")


def probe_nets(board=None):
    """Probe net information API."""
    import pcbnew
    board = board or pcbnew.GetBoard()
    _header("Nets API")
    net_info = board.GetNetInfo()
    nets = net_info.NetsByName()
    print(f"  NetsByName() count: {len(nets)}")
    for name, net in list(nets.items())[:5]:
        print(f"  Net '{name}' -> netcode={net.GetNetCode()}")
    if len(nets) > 5:
        print(f"  ... {len(nets) - 5} more nets")


def probe_layers(board=None):
    """Probe layer API."""
    import pcbnew
    board = board or pcbnew.GetBoard()
    _header("Layer API")
    print(f"  GetCopperLayerCount(): {_safe(board.GetCopperLayerCount)}")
    enabled = board.GetEnabledLayers()
    print(f"  PCB_LAYER_ID_COUNT  : {pcbnew.PCB_LAYER_ID_COUNT}")
    print(f"  IsCopperLayer(0)    : {pcbnew.IsCopperLayer(0)}  (F.Cu)")
    print(f"  IsCopperLayer(31)   : {pcbnew.IsCopperLayer(31)} (B.Cu)")
    print("\n  Enabled layers:")
    for lid in range(pcbnew.PCB_LAYER_ID_COUNT):
        try:
            if enabled.Contains(lid):
                print(f"    {lid:3d} | {board.GetLayerName(lid):20s} | copper={pcbnew.IsCopperLayer(lid)}")
        except Exception:
            pass


def probe_board_size(board=None):
    """Probe board outline / size."""
    import pcbnew
    board = board or pcbnew.GetBoard()
    _header("Board size")
    try:
        bbox = board.GetBoardEdgesBoundingBox()
        mm = 1_000_000
        print(f"  Width : {bbox.GetWidth()  / mm:.3f} mm")
        print(f"  Height: {bbox.GetHeight() / mm:.3f} mm")
        print(f"  X     : {bbox.GetX()      / mm:.3f} mm")
        print(f"  Y     : {bbox.GetY()       / mm:.3f} mm")
    except Exception as e:
        print(f"  ERROR: {e}")


def probe_design_rules(board=None):
    """Probe design settings / rules."""
    import pcbnew
    board = board or pcbnew.GetBoard()
    _header("Design rules")
    mm = 1_000_000
    try:
        ds = board.GetDesignSettings()
        print(f"  m_MinClearance   : {ds.m_MinClearance   / mm:.4f} mm")
        print(f"  m_TrackMinWidth  : {ds.m_TrackMinWidth  / mm:.4f} mm")
        print(f"  m_MinThroughDrill: {ds.m_MinThroughDrill/ mm:.4f} mm")
    except Exception as e:
        print(f"  ERROR: {e}")


def probe_selection(board=None):
    """Probe selection API."""
    import pcbnew
    board = board or pcbnew.GetBoard()
    _header("Selection API")
    fps = list(board.GetFootprints())
    selected = [fp.GetReference() for fp in fps if fp.IsSelected()]
    print(f"  Currently selected: {selected or '(none)'}")
    print(f"  IsSelected() method exists: {hasattr(fps[0], 'IsSelected') if fps else 'N/A'}")
    print(f"  SetHighLight exists: {hasattr(board, 'SetHighLight')}")
    print(f"  FindNet exists: {hasattr(board, 'FindNet')}")


def probe_highlight(board=None):
    """Test highlight APIs without actually modifying the board (read-only check)."""
    import pcbnew
    board = board or pcbnew.GetBoard()
    _header("Highlight API")
    print(f"  board.SetHighLight exists: {hasattr(board, 'SetHighLight')}")
    print(f"  board.GetHighLightNetCode(): {_safe(board.GetHighLightNetCode)}")
    print(f"  board.FindNet exists: {hasattr(board, 'FindNet')}")
    try:
        net = board.FindNet("GND")
        print(f"  FindNet('GND'): {net}")
    except Exception as e:
        print(f"  FindNet error: {e}")
    print(f"  pcbnew.Refresh exists: {hasattr(pcbnew, 'Refresh')}")


def probe_websockets():
    """Check if websockets package is available."""
    _header("websockets package")
    try:
        import websockets
        print(f"  websockets version: {websockets.__version__}")
        print(f"  websockets.serve  : {hasattr(websockets, 'serve')}")
    except ImportError:
        print("  NOT FOUND — install: pip install websockets")


def probe_all():
    """Run all probes. Call this from KiCad scripting console."""
    probe_version()
    board = probe_board()
    probe_footprint(board)
    probe_nets(board)
    probe_layers(board)
    probe_board_size(board)
    probe_design_rules(board)
    probe_selection(board)
    probe_highlight(board)
    probe_websockets()
    print("\n" + "=" * 55)
    print("  Probe complete — copy findings to BoardExporter.py")
    print("=" * 55)


if __name__ == "__main__":
    probe_all()
