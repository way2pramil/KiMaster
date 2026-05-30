"""
Test the BoardExporter serialization with KiCad's Python.
Imports BoardExporter.py directly (not the package) to avoid
triggering plugin registration.
"""
import sys
import os
import json

# Add the plugin SOURCE dir so we can import the module directly
plugin_dir = r"D:\AI_tools\KiMaster\KiMaster\bridge\kimaster_plugin"
sys.path.insert(0, plugin_dir)

# Import the module file directly (NOT the package __init__)
import importlib.util
spec = importlib.util.spec_from_file_location(
    "BoardExporter",
    os.path.join(plugin_dir, "BoardExporter.py"),
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

BoardExporter = mod.BoardExporter
_s = mod._s

# Test 1: _s() helper with simulated wxString
class FakeWxString:
    def __init__(self, val):
        self._val = val
    def __str__(self):
        return self._val

print("=== _s() tests ===")
print("str:", repr(_s("hello")))
print("None:", repr(_s(None)))
print("wxString:", repr(_s(FakeWxString("GND"))))

# Test 2: json.dumps with _s() wrapped values
test_dict = {
    "ref": _s(FakeWxString("U1")),
    "value": _s(FakeWxString("STM32")),
    "number": 42,
    "flag": True,
}
print("\njson.dumps:", json.dumps(test_dict))

# Test 3: Try actual pcbnew board
try:
    import pcbnew
    board = pcbnew.GetBoard()
    if board is None:
        print("\npcbnew.GetBoard() = None (normal outside KiCad)")
        print("Testing empty state serialization...")
        exporter = BoardExporter()
        state = exporter.get_board_state()
        serialized = json.dumps(state)
        print("Empty state JSON OK, length:", len(serialized))
    else:
        print("\n=== LIVE BOARD ===")
        print("file:", _s(board.GetFileName()))
        fps = board.GetFootprints()
        print("footprints:", len(fps))
        if fps:
            fp = fps[0]
            print("  first ref:", _s(fp.GetReference()), "type:", type(fp.GetReference()))
            print("  first val:", _s(fp.GetValue()), "type:", type(fp.GetValue()))

        # Full exporter test
        exporter = BoardExporter()
        exporter.attach_board(board)
        state = exporter.get_board_state()
        serialized = json.dumps(state)
        print("\nFull state JSON OK, length:", len(serialized))
        print("components:", len(state.get("components", [])))
        print("nets:", len(state.get("nets", [])))
        print("layers:", state.get("layers", []))
        print("_diag:", state.get("_diag", []))
except ImportError:
    print("\npcbnew not importable outside KiCad env")
except Exception as e:
    print("\nERROR:", e)
    import traceback
    traceback.print_exc()
