"""
KiMaster pipeline integration test — C144198 (MCP4725A0T-E/CH)

Replicates the exact Rust pipeline:
  API fetch → parse symbol/footprint → generate KiCad files → write vault

Run: python test_pipeline.py
"""

import urllib.request, json, gzip, ssl, re, math, os, struct
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional

# ── Output dir ────────────────────────────────────────────────────────────────

OUT = Path(os.environ.get("TEMP", "/tmp")) / "kimaster_pipeline_test"
LCSC_ID = "C144198"

# ── API ───────────────────────────────────────────────────────────────────────

API_URL      = f"https://easyeda.com/api/products/{LCSC_ID}/components"
STEP_URL     = "https://modules.easyeda.com/qAxj6KHrDKw4blvCG8QJPs7Y/{uuid}"
HEADERS      = {
    "Accept-Encoding": "gzip, deflate",
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://easyeda.com/",
}

def fetch(url):
    ctx = ssl.create_default_context()
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
        raw = r.read()
    return gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw

# ── Coordinate helpers (mirrors Rust EdaParser) ───────────────────────────────

def px_to_mm(px):       return 10.0 * float(px) * 0.0254
def fp_to_mm(px):       return round(float(px) * 10 * 0.0254, 6)
def px_to_mm_grid(px):
    mm = px_to_mm(px); grid = 1.27
    return round(mm / grid) * grid

def snap_bbox(x, y):
    g = 5.0
    return round(float(x)/g)*g, round(float(y)/g)*g

def pf(s):
    try: return float(s)
    except: return 0.0

def angle_to_ki(rot):
    rot = float(rot)
    return -(360.0 - rot) if rot > 180.0 else rot

# ── Symbol parser (mirrors Rust parse_sym_pin, parse_sym_rect) ───────────────

@dataclass
class EePin:
    number: str; name: str; x_mm: float; y_mm: float
    rotation: float; length_mm: float; pin_type: str = "unspecified"

@dataclass
class EeRect:
    x0: float; y0: float; x1: float; y1: float

@dataclass
class EeSymbol:
    pins: list = field(default_factory=list)
    rects: list = field(default_factory=list)

def compute_origin(head_x, head_y, bbox):
    bx, by = pf(bbox.get("x",0)), pf(bbox.get("y",0))
    bw, bh = pf(bbox.get("width",0)), pf(bbox.get("height",0))
    if bw > 0 or bh > 0:
        return bx + bw/2, by + bh/2
    elif bx or by:
        return bx, by
    return pf(head_x), pf(head_y)

def extract_pin_length(path_str):
    path_str = path_str.replace("v","h")
    if "h" in path_str:
        part = path_str.split("h")[-1].split()[0]
        val = abs(pf(part))
        if val > 0:
            return px_to_mm_grid(val)
    return 2.54

PIN_TYPES = {1:"input",2:"output",3:"bidirectional",4:"power_in"}

def parse_sym_pin(line, ox, oy):
    after = line[line.index("~")+1:]
    segs  = [s.split("~") for s in after.split("^^")]
    if len(segs) < 5: return None
    settings = segs[0]
    name_seg = segs[3] if len(segs)>3 else []
    num_seg  = segs[4] if len(segs)>4 else []
    path_seg = segs[2] if len(segs)>2 else []

    pin_type_code = int(pf(settings[1])) if len(settings)>1 else 0
    pin_type = PIN_TYPES.get(pin_type_code, "unspecified")

    pos_x = px_to_mm_grid(pf(settings[3]) - ox) if len(settings)>3 else 0.0
    pos_y = -px_to_mm_grid(pf(settings[4]) - oy) if len(settings)>4 else 0.0
    rotation = pf(settings[5]) if len(settings)>5 else 0.0

    name   = name_seg[4].strip() if len(name_seg)>4 else ""
    number = num_seg[4].strip()  if len(num_seg)>4  else (settings[2] if len(settings)>2 else "")

    length_mm = extract_pin_length(path_seg[0]) if path_seg else 2.54

    return EePin(number=number, name=name, x_mm=pos_x, y_mm=pos_y,
                 rotation=rotation, length_mm=length_mm, pin_type=pin_type)

def parse_sym_rect(line, ox, oy):
    parts = line.split("~")
    if len(parts) < 6: return None
    rx, ry = pf(parts[1]), pf(parts[2])
    if parts[3]=="" and parts[4]=="" and len(parts)>=7:
        w, h = pf(parts[5]), pf(parts[6])
    elif len(parts)>=7:
        w, h = pf(parts[5]), pf(parts[6])
    else:
        return None
    x0 = px_to_mm(rx - ox); y0 = -px_to_mm(ry - oy)
    x1 = x0 + px_to_mm(w);  y1 = y0 - px_to_mm(h)
    return EeRect(x0, y0, x1, y1)

def parse_symbol(shapes, ox, oy):
    ox, oy = snap_bbox(ox, oy)
    sym = EeSymbol()
    for line in shapes:
        line = line.strip()
        if not line: continue
        tag = line.split("~")[0]
        if tag == "P":
            p = parse_sym_pin(line, ox, oy)
            if p: sym.pins.append(p)
        elif tag == "R":
            r = parse_sym_rect(line, ox, oy)
            if r: sym.rects.append(r)
    return sym

# ── Footprint parser (mirrors Rust parse_fp_pad) ──────────────────────────────

@dataclass
class EePad:
    number: str; x_mm: float; y_mm: float
    w_mm: float; h_mm: float; rotation: float
    pad_type: str; pad_shape: str; layers: str

def smd_layers(lid):
    return {1:"F.Cu F.Paste F.Mask",2:"B.Cu B.Paste B.Mask",
            11:"*.Cu *.Paste *.Mask"}.get(lid, "F.Cu F.Paste F.Mask")

def parse_fp_pad(fields, bx, by):
    if len(fields) < 9: return None
    shape_str = fields[0]
    cx = fp_to_mm(pf(fields[1])) - bx
    cy = fp_to_mm(pf(fields[2])) - by
    w  = fp_to_mm(pf(fields[3]))
    h  = fp_to_mm(pf(fields[4]))
    lid = int(pf(fields[5]))
    num = fields[7] if len(fields)>7 else ""
    hole_r = fp_to_mm(pf(fields[8])) if len(fields)>8 else 0.0
    rot = pf(fields[10]) if len(fields)>10 else 0.0

    pad_type = "thru_hole" if hole_r > 0 else "smd"
    shape_map = {"ELLIPSE":"circle","RECT":"rect","OVAL":"oval","POLYGON":"custom"}
    pad_shape = shape_map.get(shape_str, "custom")
    layers = smd_layers(lid) if pad_type=="smd" else "*.Cu *.Mask"

    return EePad(number=num, x_mm=cx, y_mm=cy, w_mm=max(w,0.01), h_mm=max(h,0.01),
                 rotation=angle_to_ki(rot), pad_type=pad_type, pad_shape=pad_shape, layers=layers)

def parse_footprint(shapes, head_x, head_y):
    bx, by = fp_to_mm(head_x), fp_to_mm(head_y)
    pads = []
    svgnode = None
    for line in shapes:
        line = line.strip()
        if not line: continue
        tag = line.split("~")[0]
        rest = line[len(tag)+1:].split("~")
        if tag == "PAD":
            p = parse_fp_pad(rest, bx, by)
            if p: pads.append(p)
        elif tag == "SVGNODE":
            svgnode = line  # keep raw for 3D model extraction
    return pads, svgnode

def extract_3d_uuid(svgnode_line):
    m = re.search(r'"uuid"\s*:\s*"([^"]+)"', svgnode_line)
    return m.group(1) if m else None

# ── KiCad generators ──────────────────────────────────────────────────────────

def gen_symbol(lcsc_id, title, package, datasheet, manufacturer, mpn, prefix, sym):
    name = lcsc_id
    pins = sym.pins
    y_low  = min((p.y_mm for p in pins), default=0.0)
    y_high = max((p.y_mm for p in pins), default=0.0)

    lines = [f'  (symbol "{name}"']
    lines.append('    (in_bom yes)')
    lines.append('    (on_board yes)')

    # Properties
    fy = 5.08
    lines.append(f'    (property "Reference" "{prefix.rstrip("?")}"')
    lines.append(f'      (at 0 {y_high+fy:.4f} 0)')
    lines.append(f'      (effects (font (size 1.27 1.27)))')
    lines.append('    )')
    lines.append(f'    (property "Value" "{title}"')
    lines.append(f'      (at 0 {y_low-fy:.4f} 0)')
    lines.append(f'      (effects (font (size 1.27 1.27)))')
    lines.append('    )')
    fy += 2.54
    lines.append(f'    (property "Footprint" "KiMaster:{name}"')
    lines.append(f'      (at 0 {y_low-fy:.4f} 0)')
    lines.append(f'      (effects (font (size 1.27 1.27)) hide)')
    lines.append('    )')
    fy += 2.54
    lines.append(f'    (property "Datasheet" "{datasheet}"')
    lines.append(f'      (at 0 {y_low-fy:.4f} 0)')
    lines.append(f'      (effects (font (size 1.27 1.27)) hide)')
    lines.append('    )')
    fy += 2.54
    lines.append(f'    (property "LCSC Part" "{lcsc_id}"')
    lines.append(f'      (at 0 {y_low-fy:.4f} 0)')
    lines.append(f'      (effects (font (size 1.27 1.27)) hide)')
    lines.append('    )')

    # Sub-symbol
    lines.append(f'    (symbol "{name}_0_1"')
    for r in sym.rects:
        lines.append(f'      (rectangle')
        lines.append(f'        (start {r.x0:.2f} {r.y0:.2f})')
        lines.append(f'        (end {r.x1:.2f} {r.y1:.2f})')
        lines.append(f'        (stroke (width 0) (type default))')
        lines.append(f'        (fill (type background))')
        lines.append(f'      )')
    for p in pins:
        rot_ki = int((180 + p.rotation) % 360)
        lines.append(f'      (pin {p.pin_type} line')
        lines.append(f'        (at {p.x_mm:.2f} {p.y_mm:.2f} {rot_ki})')
        lines.append(f'        (length {p.length_mm:.2f})')
        lines.append(f'        (name "{p.name}" (effects (font (size 1.27 1.27))))')
        lines.append(f'        (number "{p.number}" (effects (font (size 1.27 1.27))))')
        lines.append(f'      )')
    lines.append('    )')
    lines.append('  )')
    return "\n".join(lines) + "\n"

def gen_footprint(lcsc_id, pads, model_path=None):
    y_vals = [p.y_mm for p in pads] or [0]
    y_low, y_high = min(y_vals), max(y_vals)

    lines = [f'(footprint "KiMaster:{lcsc_id}"']
    lines.append('  (version 20231120)')
    lines.append('  (generator "kimaster")')
    lines.append('  (layer "F.Cu")')
    lines.append('  (attr smd)')
    lines.append(f'  (fp_text reference "REF**" (at 0 {y_low-4.0:.3f})')
    lines.append('    (layer "F.SilkS")')
    lines.append('    (effects (font (size 1 1) (thickness 0.15)))')
    lines.append('  )')
    lines.append(f'  (fp_text value "{lcsc_id}" (at 0 {y_high+4.0:.3f})')
    lines.append('    (layer "F.Fab")')
    lines.append('    (effects (font (size 1 1) (thickness 0.15)))')
    lines.append('  )')
    lines.append(f'  (property "LCSC Part" "{lcsc_id}")')

    for p in pads:
        rot_str = f" {p.rotation:.2f}" if abs(p.rotation) > 0.01 else ""
        layers_str = " ".join(f'"{l}"' for l in p.layers.split())
        lines.append(f'  (pad "{p.number}" {p.pad_type} {p.pad_shape}')
        lines.append(f'    (at {p.x_mm:.3f} {p.y_mm:.3f}{rot_str})')
        lines.append(f'    (size {p.w_mm:.3f} {p.h_mm:.3f})')
        lines.append(f'    (layers {layers_str}))')

    if model_path:
        mp = str(model_path).replace("\\", "/")
        lines.append(f'  (model "{mp}"')
        lines.append('    (offset (xyz 0 0 0))')
        lines.append('    (scale (xyz 1 1 1))')
        lines.append('    (rotate (xyz 0 0 0))')
        lines.append('  )')

    lines.append(')')
    return "\n".join(lines) + "\n"

# ── Write vault files ─────────────────────────────────────────────────────────

def write_vault(vault_dir, lcsc_id, sym_block, mod_content, step_bytes=None):
    lib_dir    = vault_dir / "library"
    pretty_dir = lib_dir / "KiMaster.pretty"
    models_dir = lib_dir / "3dmodels"
    for d in (pretty_dir, models_dir): d.mkdir(parents=True, exist_ok=True)

    # Symbol lib
    sym_lib = lib_dir / "KiMaster.kicad_sym"
    header = f'(kicad_symbol_lib\n  (version 20231120)\n  (generator "kimaster")\n'
    sym_lib.write_text(header + sym_block + ")\n", encoding="utf-8")

    # Footprint
    (pretty_dir / f"{lcsc_id}.kicad_mod").write_text(mod_content, encoding="utf-8")

    # 3D model
    step_path = None
    if step_bytes:
        step_path = models_dir / f"{lcsc_id}.step"
        step_path.write_bytes(step_bytes)

    return sym_lib, pretty_dir / f"{lcsc_id}.kicad_mod", step_path

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print(f"KiMaster Pipeline Test — {LCSC_ID}")
    print("=" * 50)

    # 1. Fetch API
    print(f"\n[1] Fetching {LCSC_ID} from EasyEDA API…")
    raw = fetch(API_URL)
    data   = json.loads(raw)
    result = data["result"]
    print(f"    Title   : {result.get('title')}")
    print(f"    Package : {result.get('packageDetail',{}).get('title')}")

    # 2. Extract data
    ds  = result["dataStr"]
    pds = result["packageDetail"]["dataStr"]

    sym_shapes = ds.get("shape", [])
    fp_shapes  = pds.get("shape", [])
    bbox       = ds.get("BBox", {})
    head       = ds.get("head", {})
    fp_head    = pds.get("head", {})

    metadata = head.get("c_para", {})
    prefix   = metadata.get("pre", "U").rstrip("?")
    title    = result.get("title", LCSC_ID)
    package  = result.get("packageDetail", {}).get("title", "")
    datasheet = result.get("datasheet", "")
    manufacturer = metadata.get("Manufacturer", "") or metadata.get("BOM_Manufacturer", "")
    mpn          = metadata.get("Manufacturer Part", "") or metadata.get("BOM_Manufacturer Part", "")

    # 3. Parse symbol
    print(f"\n[2] Parsing symbol ({len(sym_shapes)} shapes)…")
    ox, oy = compute_origin(head.get("x",0), head.get("y",0), bbox)
    sym = parse_symbol(sym_shapes, ox, oy)
    print(f"    Pins     : {len(sym.pins)}")
    print(f"    Rects    : {len(sym.rects)}")
    for p in sym.pins:
        print(f"      Pin {p.number:>3}: {p.name:<12} at ({p.x_mm:+.2f}, {p.y_mm:+.2f})  rot={p.rotation:.0f}°")

    # 4. Parse footprint
    print(f"\n[3] Parsing footprint ({len(fp_shapes)} shapes)…")
    fp_head_x = float(fp_head.get("x", 0))
    fp_head_y = float(fp_head.get("y", 0))
    pads, svgnode = parse_footprint(fp_shapes, fp_head_x, fp_head_y)
    print(f"    Pads     : {len(pads)}")
    for p in pads:
        print(f"      Pad {p.number:>3}: {p.pad_shape:<6} at ({p.x_mm:+.3f}, {p.y_mm:+.3f})  rot={p.rotation:.0f}°  {p.layers}")

    # 5. Fetch 3D model
    uuid_3d = fp_head.get("uuid_3d") or (extract_3d_uuid(svgnode) if svgnode else None)
    step_bytes = None
    if uuid_3d:
        print(f"\n[4] Fetching 3D STEP model (uuid={uuid_3d[:16]}…)…")
        try:
            step_bytes = fetch(STEP_URL.format(uuid=uuid_3d))
            print(f"    Size     : {len(step_bytes):,} bytes")
            is_valid = step_bytes[:5] == b"ISO-1" or b"STEP" in step_bytes[:20]
            print(f"    Valid    : {is_valid}")
        except Exception as e:
            print(f"    WARN: {e}")
    else:
        print(f"\n[4] No 3D model UUID found")

    # 6. Generate files
    print(f"\n[5] Generating KiCad files…")
    OUT.mkdir(parents=True, exist_ok=True)
    step_out = OUT / "library" / "3dmodels" / f"{LCSC_ID}.step" if step_bytes else None

    sym_block   = gen_symbol(LCSC_ID, title, package, datasheet, manufacturer, mpn, prefix, sym)
    mod_content = gen_footprint(LCSC_ID, pads, model_path=step_out)
    sym_file, mod_file, step_file = write_vault(OUT, LCSC_ID, sym_block, mod_content, step_bytes)

    # 7. Verify
    print(f"\n[6] File verification…")
    def check(label, path, min_bytes=10):
        sz = path.stat().st_size if path and path.exists() else 0
        ok = "✓" if sz >= min_bytes else "✗"
        print(f"    {ok}  {label:<35} {sz:>8,} bytes  {path}")
        return sz >= min_bytes

    all_ok = True
    all_ok &= check("KiMaster.kicad_sym",   sym_file,  100)
    all_ok &= check(f"{LCSC_ID}.kicad_mod", mod_file,  100)
    if step_bytes:
        all_ok &= check(f"{LCSC_ID}.step",  step_file, 1000)

    # 8. Content checks
    print(f"\n[7] Content checks…")
    sym_text = sym_file.read_text()
    mod_text = mod_file.read_text()

    sym_pin_count  = sym_text.count("(pin ")
    mod_pad_count  = mod_text.count("(pad ")
    sym_rect_count = sym_text.count("(rectangle")
    has_model_ref  = "(model " in mod_text

    def chk(label, val, expected=""):
        ok = "✓" if val else "✗"
        exp = f"  (expected {expected})" if expected else ""
        print(f"    {ok}  {label}: {val}{exp}")
        return bool(val)

    all_ok &= chk("Symbol pins",          sym_pin_count,  f"== {len(sym.pins)}")
    all_ok &= chk("Symbol rectangles",    sym_rect_count, f">= 1")
    all_ok &= chk("Footprint pads",       mod_pad_count,  f"== {len(pads)}")
    all_ok &= chk("3D model reference",   has_model_ref,  "True" if step_bytes else "n/a")
    all_ok &= chk("LCSC in symbol",       "C144198" in sym_text)
    all_ok &= chk("LCSC in footprint",    "C144198" in mod_text)

    # easyeda2kicad reference comparison
    print(f"\n[8] vs easyeda2kicad reference…")
    ref_dir = Path(os.environ.get("TEMP", "/tmp")) / "km_test_C144198.pretty"
    if ref_dir.exists():
        ref_files = list(ref_dir.glob("*.kicad_mod"))
        if ref_files:
            ref_text = ref_files[0].read_text()
            ref_pads = ref_text.count("(pad ")
            print(f"    Reference pads : {ref_pads}")
            print(f"    KiMaster pads  : {mod_pad_count}")
            match = "✓ MATCH" if ref_pads == mod_pad_count else "⚠ DIFFER"
            print(f"    {match}")
    else:
        print(f"    (no reference found at {ref_dir})")

    print(f"\n{'='*50}")
    print(f"RESULT: {'ALL PASS ✓' if all_ok else 'SOME FAILURES ✗'}")
    print(f"Output: {OUT}")

if __name__ == "__main__":
    main()
