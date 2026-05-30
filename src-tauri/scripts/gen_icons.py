"""
Generates minimal placeholder icons for Tauri development builds.
Run once: python src-tauri/scripts/gen_icons.py
Real icons should be generated with: npm run tauri icon /path/to/source.png
"""

import struct
import os
import zlib

ICON_DIR = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(ICON_DIR, exist_ok=True)

# Accent color in BGRA: #7B61FF → B=0xFF, G=0x61, R=0x7B, A=0xFF
ACCENT_BGRA = (0xFF, 0x61, 0x7B, 0xFF)
# Dark background
BG_BGRA = (0x0D, 0x0C, 0x0C, 0xFF)


def minimal_png(width: int, height: int, color_rgba=(0x7B, 0x61, 0xFF, 0xFF)) -> bytes:
    """Create a minimal solid-color PNG."""
    r, g, b, a = color_rgba

    def make_chunk(chunk_type: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)

    # PNG signature
    sig = b"\x89PNG\r\n\x1a\n"

    # IHDR chunk
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8-bit RGB
    ihdr = make_chunk(b"IHDR", ihdr_data)

    # IDAT chunk — scanlines: filter_byte(0) + RGB * width, repeated height times
    raw = b""
    for _ in range(height):
        raw += b"\x00"  # filter type None
        raw += bytes([r, g, b]) * width
    compressed = zlib.compress(raw, level=9)
    idat = make_chunk(b"IDAT", compressed)

    # IEND chunk
    iend = make_chunk(b"IEND", b"")

    return sig + ihdr + idat + iend


def minimal_ico(sizes=((16, 16), (32, 32), (48, 48), (256, 256))) -> bytes:
    """Create a minimal multi-size ICO using embedded PNGs (modern ICO format)."""
    images = []
    for w, h in sizes:
        png_data = minimal_png(w, h, (0x7B, 0x61, 0xFF, 0xFF))
        images.append((w, h, png_data))

    count = len(images)
    # ICONDIR: reserved(2) + type(2) + count(2)
    header = struct.pack("<HHH", 0, 1, count)

    # Directory entries: 16 bytes each
    # Image data starts after header + all directory entries
    offset = 6 + count * 16
    dir_entries = b""
    image_blobs = b""
    for w, h, data in images:
        w_byte = 0 if w == 256 else w
        h_byte = 0 if h == 256 else h
        dir_entries += struct.pack(
            "<BBBBHHII",
            w_byte, h_byte,  # width, height (0 = 256)
            0, 0,            # color count, reserved
            1, 32,           # planes, bit count
            len(data), offset,
        )
        offset += len(data)
        image_blobs += data

    return header + dir_entries + image_blobs


def main():
    # Generate icon.ico (required by tauri-build for Windows .res file)
    ico_path = os.path.join(ICON_DIR, "icon.ico")
    ico_data = minimal_ico()
    with open(ico_path, "wb") as f:
        f.write(ico_data)
    print(f"  Created {ico_path} ({len(ico_data)} bytes)")

    # Generate PNG icons required by tauri.conf.json bundle config
    png_specs = [
        ("32x32.png", 32, 32),
        ("128x128.png", 128, 128),
        ("128x128@2x.png", 256, 256),
    ]
    for fname, w, h in png_specs:
        path = os.path.join(ICON_DIR, fname)
        data = minimal_png(w, h)
        with open(path, "wb") as f:
            f.write(data)
        print(f"  Created {path}")

    # macOS .icns placeholder (valid empty structure not needed for Windows builds)
    icns_path = os.path.join(ICON_DIR, "icon.icns")
    with open(icns_path, "wb") as f:
        # Minimal valid ICNS: just the header
        f.write(b"icns" + struct.pack(">I", 8))
    print(f"  Created {icns_path} (placeholder)")

    print("\nPlaceholder icons generated. Replace with real icons before shipping.")
    print("To generate proper icons: npm run tauri icon /path/to/512x512.png")


if __name__ == "__main__":
    main()
