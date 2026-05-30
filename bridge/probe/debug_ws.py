"""Connect to live WS server and read all messages with longer timeout."""
import asyncio
import json
import sys
sys.path.insert(0, r"C:\Users\prami\OneDrive\Documents\KiCad\10.0\3rdparty\Python311\site-packages")
import websockets

async def test():
    print("Connecting to ws://127.0.0.1:40001 ...")
    try:
        async with websockets.connect("ws://127.0.0.1:40001") as ws:
            print("Connected! Waiting for messages...")
            # Try to read up to 3 messages with 10s total timeout
            for i in range(3):
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=10)
                    msg = json.loads(raw)
                    mtype = msg.get("type", "?")
                    print(f"\nMessage {i+1}: type={mtype}")
                    if mtype == "error":
                        print("  ERROR:", msg.get("message"))
                    elif mtype == "board_state":
                        d = msg.get("data", {})
                        print("  components:", len(d.get("components", [])))
                        print("  nets:", len(d.get("nets", [])))
                        print("  _diag:", d.get("_diag", []))
                    else:
                        print("  payload:", json.dumps(msg)[:300])
                except asyncio.TimeoutError:
                    print(f"\n  Timeout waiting for message {i+1}")
                    break
    except ConnectionRefusedError:
        print("Connection refused — is the KiCad bridge plugin running?")
    except Exception as e:
        print(f"Error: {e}")

asyncio.run(test())
