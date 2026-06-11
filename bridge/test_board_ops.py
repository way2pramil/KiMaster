#!/usr/bin/env python3
"""
Standalone smoke test for the Via Stitch / Teardrops / Panelize bridge ops.

Connects directly to the running KiMaster bridge WebSocket (bypassing the
KiMaster frontend entirely) and sends each op with dry_run=True so nothing
on the board is mutated. Prints the op_result payload for each.

Usage: python test_board_ops.py [port]
"""
import asyncio
import json
import sys

import websockets

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 40002
URL = f"ws://127.0.0.1:{PORT}"


async def send_and_wait(ws, msg, want_op, timeout=15):
    await ws.send(json.dumps(msg))
    deadline = asyncio.get_event_loop().time() + timeout
    while True:
        remaining = deadline - asyncio.get_event_loop().time()
        if remaining <= 0:
            return None
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
        except (TimeoutError, asyncio.TimeoutError):
            return None
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if payload.get("type") == "op_result" and payload.get("op") == want_op:
            return payload
        # board_state / hello_ack etc - keep waiting for our op_result


async def main():
    print(f"Connecting to {URL} ...")
    async with websockets.connect(URL) as ws:
        await ws.send(json.dumps({"type": "hello", "client": "kimaster-test", "version": "0.1.0"}))

        # Drain initial board_state / hello_ack to discover nets/layers
        nets, layers = [], []
        for _ in range(5):
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=3)
            except asyncio.TimeoutError:
                break
            payload = json.loads(raw)
            if payload.get("type") == "board_state":
                data = payload.get("data", {})
                nets = data.get("nets", [])
                layers = data.get("layers", [])
            if payload.get("type") == "hello_ack":
                break

        net = next((n for n in nets if n in ("GND", "/GND")), (nets[0] if nets else "GND"))
        cu_layers = [l for l in layers if "Cu" in l] or ["F.Cu", "B.Cu"]
        print(f"Using net={net!r}  layers={cu_layers[:2]}")

        tests = [
            ("via_stitch", {
                "type": "via_stitch",
                "data": {
                    "net": net,
                    "via_size_mm": 0.8, "drill_mm": 0.4, "pitch_mm": 2.5,
                    "layer_from": cu_layers[0], "layer_to": cu_layers[-1],
                    "zone_name": None, "clearance_mm": 0, "randomize": False,
                    "dry_run": True,
                },
            }),
            ("apply_teardrops", {
                "type": "apply_teardrops",
                "data": {
                    "scope": "all", "style": "curved", "dry_run": True,
                },
            }),
            ("panelize_board", {
                "type": "panelize_board",
                "data": {
                    "rows": 2, "cols": 2, "spacing_mm": 2.0,
                    "rail_top_mm": 5.0, "rail_bottom_mm": 5.0,
                    "mousebites": True, "dry_run": True,
                },
            }),
        ]

        for op, msg in tests:
            print(f"\n--- {op} (dry_run) ---")
            print(f"-> sending: {json.dumps(msg['data'])}")
            result = await send_and_wait(ws, msg, op)
            if result is None:
                print(f"TIMEOUT - no op_result for '{op}' within 15s "
                      f"(plugin likely still running stale code / message unhandled)")
            else:
                print(f"<- op_result: {json.dumps(result, indent=2)}")


if __name__ == "__main__":
    asyncio.run(main())
