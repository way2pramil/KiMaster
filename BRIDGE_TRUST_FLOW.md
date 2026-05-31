# Bridge Trust-Building Flow — Implementation Guide

## Overview

The KiCad Bridge integration now uses a **human-friendly, zero-friction approach** that builds trust through explicit permissions and warm language. No jargon. No fear. Just clear explanations of what happens.

---

## ✨ What Changed

### Before
- Dashboard shows "Auto-connecting…"
- Click "Connect" → immediately tries to connect to KiCad
- User has no clear understanding of what the bridge does
- Silent auto-connect in background

### After
- Dashboard shows "Not connected · Click 'Connect' to start"
- Click "Connect" → **BridgeConnectGate modal** shows up
- Modal explains: what happens, what you can do, why it's safe
- User actively clicks "Connect" button to approve
- Clear status: "Connected to KiCad · Live sync"

---

## 🎯 New Components

### 1. **BridgePermissionsModal** (`src/components/features/Bridge/BridgePermissionsModal.js`)

**Purpose:** Explains what the bridge does in warm, human language

**When shown:**
- First-time setup (future: detect via localStorage flag)
- User clicks "Learn more" link in other modals
- Settings panel: "Bridge info" button

**Key features:**
- One expandable "What it can do" section
- Shows 5 capabilities with read-only vs write-with-approval badges
- Emoji icons for warmth, not technical icons
- "Learn more" link for those who want details
- Two buttons: "Not now" and "Let's connect"

**Language examples:**
- ✅ "See your board layout, components, nets"
- ✅ "Move and rotate footprints (you'll confirm each time)"
- ❌ "Instantiate WebSocket bridge with async board state sync"

---

### 2. **BridgeConnectGate** (`src/components/features/Bridge/BridgeConnectGate.js`)

**Purpose:** Simple, warm confirmation before connecting

**When shown:** User clicks "Connect" button on Dashboard bridge hero

**Key features:**
- Icons showing bridge connecting (🔌 + 🔗)
- Title: "Ready to connect?"
- 3-item checklist showing what happens (See board live, Select together, Make changes)
- Safety reassurance: "Your board is safe — changes only happen when you ask"
- Loading state with spinner during connection
- Two buttons: "Cancel" and "Connect"

**User journey:**
```
User clicks "Connect" on Dashboard
           ↓
    BridgeConnectGate modal appears
           ↓
   User reads: "Ready to connect?"
   Sees: ✓ See board layout live
         ✓ Select in both apps together
         ✓ Make changes (with approval)
   Reads: 🛡️ "Your board is safe"
           ↓
   User clicks "Connect"
           ↓
   Modal shows spinner: "Connecting…"
           ↓
   Bridge connects (via showConnectGate → connectBridge)
           ↓
   Dashboard shows: "Connected to KiCad · Live sync"
```

---

## 🔄 Updated Flow: Dashboard Bridge Section

### Before Connection
```
┌─────────────────────────────────────────┐
│ 🏢 KiMaster Dashboard                   │
├─────────────────────────────────────────┤
│                                          │
│ ◯ Bridge disconnected                   │
│   Auto-connecting to port 40001…       │
│   [Connect]                            │
│                                          │
└─────────────────────────────────────────┘
```

### After Click "Connect"
```
BridgeConnectGate modal appears:

┌──────────────────────────────────────────┐
│ 🔌🔗 Ready to connect?                   │
├──────────────────────────────────────────┤
│                                           │
│ KiMaster will sync with KiCad in real    │
│ time. You can browse, select, and modify │
│ your board from here.                    │
│                                           │
│ ✓ See your board layout and components   │
│   live                                    │
│ ✓ Select parts in both KiCad and         │
│   KiMaster together                      │
│ ✓ Make changes (you'll confirm each one) │
│                                           │
│ 🛡️ Your board is safe. Changes only      │
│    happen when you ask, and you can      │
│    undo them in KiCad.                   │
│                                           │
│ [Cancel] [Connect]                       │
│                                           │
└──────────────────────────────────────────┘
```

### After Connection
```
┌─────────────────────────────────────────┐
│ 🏢 KiMaster Dashboard                   │
├─────────────────────────────────────────┤
│                                          │
│ ● Connected to KiCad (glowing cyan)     │
│   Live sync · my_board.kicad_pcb        │
│   [↻] [Disconnect]                     │
│                                          │
└─────────────────────────────────────────┘
```

---

## 📝 New Function: `showConnectGate()`

In `src/modules/kicad-bridge/BridgeClient.js`:

```javascript
/**
 * Show the connection gate modal, then connect if user approves.
 * This is the entry point for user-initiated connections.
 */
export async function showConnectGate(port = 40001) {
  const { BridgeConnectGate } = await import('../../components/features/Bridge/index.js');
  const approved = await BridgeConnectGate.show();
  if (!approved) {
    Logger.debug('Bridge', 'Connection cancelled by user');
    return;
  }
  return connectBridge(port);
}
```

**Key points:**
- Returns a Promise that resolves when user approves or cancels
- `BridgeConnectGate.show()` returns Promise<boolean>
- Only calls `connectBridge()` if user approves
- Logs cancellation for debugging

---

## 🎨 Zero-Friction Principles Applied

| Principle | Implementation |
|-----------|-----------------|
| **Warm language** | "Ready to connect?" not "Initiate WS bridge" |
| **5-second rule** | User understands in 5s: it syncs KiCad, safe, needs approval |
| **One checkbox** | All permissions under one expandable "What it can do" |
| **Human eye path** | Icon → Title → Checklist → Safety message → Button |
| **Click depth** | 2 clicks max: "Connect" button → "Connect" in modal |
| **Emoji warmth** | 🔌 📡 👁️ 🔗 instead of `[connect-icon]` |
| **Progressive disclosure** | Details hidden in expandable sections |
| **Reassurance** | Safety badge immediately visible |
| **No mystery meat** | Every button label clearly explains what happens |

---

## 🧪 Testing the Flow

### Desktop App (Tauri)
1. Run `npm run tauri dev`
2. App opens → Dashboard shows bridge section
3. Click "Connect" → BridgeConnectGate modal appears
4. Verify modal content and styling
5. Click "Connect" → gate closes, bridge connects (if KiCad is running)
6. Dashboard updates to "Connected to KiCad · Live sync"

### Browser Dev Mode
1. Run `npm run dev`
2. Open http://localhost:1420
3. Components load (note: IPC calls will mock out)
4. Click "Connect" → BridgeConnectGate modal appears
5. Styling and animation work as expected

---

## 📱 Permissions Modal (Future: Optional First-Time)

The `BridgePermissionsModal` component is ready but currently not auto-shown on first launch.

**To enable first-time setup:**

In `main.js`, add:
```javascript
async function _initializeBridge() {
  const hasSeenPermissions = localStorage.getItem('km-bridge-permissions-seen');
  if (!hasSeenPermissions) {
    const { BridgePermissionsModal } = await import('./components/features/Bridge/index.js');
    const approved = await BridgePermissionsModal.show();
    if (approved) {
      localStorage.setItem('km-bridge-permissions-seen', 'true');
      // Show BridgeConnectGate next
    }
  }
}
```

**Current state:** Component is ready to use, just needs integration point.

---

## 🛠️ Files Modified

| File | Change | Reason |
|------|--------|--------|
| `src/components/features/Bridge/BridgePermissionsModal.js` | **NEW** | Explains permissions with expandable sections |
| `src/components/features/Bridge/BridgeConnectGate.js` | **NEW** | Warm confirmation gate before connecting |
| `src/components/features/Bridge/index.js` | **NEW** | Barrel export for Bridge components |
| `src/modules/kicad-bridge/BridgeClient.js` | Added `showConnectGate()` | Entry point for user-initiated connections |
| `src/components/features/Dashboard/Dashboard.js` | Updated `_renderBridge()` | Shows human-friendly status, calls `showConnectGate()` |

---

## 🎯 Zero-Friction Checklist

- [x] **Emotional target:** Safe, understood, confident
- [x] **Core task:** User clicks "Connect" → understands what happens → approves
- [x] **Click depth:** 2 clicks (Connect button → modal button)
- [x] **Element count:** 5-7 actionable elements max in each modal
- [x] **Warmth test:** No jargon, sounds like a calm colleague
- [x] **Progressive disclosure:** Details in expandable sections
- [x] **Reassurance:** Safety message visible immediately
- [x] **Purposeful animation:** Dot breathing, modal slide-up
- [x] **No mystery meat:** Every label is clear and warm
- [x] **Calm partner test:** Feels like an assistant, not a config form

---

## 🚀 Next Steps (Optional Enhancements)

1. **First-time setup flow** — Auto-show permissions modal on app launch
2. **Settings integration** — "Bridge info" button in Settings → show permissions modal
3. **Version verification** — Check plugin version matches app, show warning if mismatch
4. **Trust badge** — Visual indicator showing "plugin verified" on successful connection
5. **Session persistence** — Remember "trusted" sessions, skip gate on re-launch
6. **Disconnect safe-guard** — Warn if user has uncommitted changes in KiCad

---

## 📚 Related Documentation

- Zero-Friction UI Constitution: `~/.claude/skills/zero-friction-ui/SKILL.md`
- Bridge Technical: See `src-tauri/src/ipc/BridgeCommands.rs`
- Permissions & Trust: This file (BRIDGE_TRUST_FLOW.md)

---

## 💡 Key Principle

**The system decides. The user overrides.**

- The bridge is smart: if user doesn't explicitly connect, it doesn't force a connection
- But once connected, the system proactively syncs board state (user can always disconnect)
- Changes require explicit approval before happening
- User is always in control — they just don't see unnecessary complexity

---

**Status:** ✅ **Ready to use**

All components are syntactically valid and follow zero-friction UI principles. Modal animations and warmth language create emotional connection. Trust is built through explicit gates and clear language, not through technical documentation.
