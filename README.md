# Mudra Smart Cursor

**Precision assistance for the Mudra Band / any standard BLE HID air mouse.** A privacy-first, entirely local browser-side prototype.

## Features

- Magnetic target detection with a configurable proximity radius.
- Sticky selection with hysteresis to reject hand jitter.
- Optional near-miss click assist; skips many dangerous controls.
- Optional dwell activation with a stability region and adjustable delay.
- Virtual cursor based on Pointer Lock and relative HID movement. Includes precision slowdown and configurable sensitivity.
- Re-center the **virtual cursor**, with a button or `Alt+Shift+C`.
- **Browser tab escape:** push the virtual pointer against the top edge and keep moving upward about 48px; Pointer Lock releases to the normal HID cursor, so you can reach Chrome's tab strip. Re-enable virtual mode after returning to the page. Pressing `Esc` also works. Browser APIs cannot directly move the OS cursor.
- In-page control panel, per-origin preferences, presets via the landing page, and shortcuts.
- Standalone bookmarklet (full source embedded, no remote script fetch) and optional Chrome MV3 extension.

## Install bookmarklet

1. Open the [GitHub Pages landing page](https://alex00pirotskyi.github.io/mouse_test/) once published.
2. Reveal the bookmarks bar (`Ctrl+Shift+B` in Chrome on Windows).
3. Drag the **Mudra Smart Cursor** button to the bookmarks bar, or copy its link into the URL field of a manually created bookmark.
4. Open an ordinary web page and click the bookmark. The floating panel appears.
5. The bookmarklet works until navigation/reload. Run again on the new page.

> Bookmarklets can be blocked by some sites' Content Security Policy and browser restrictions. They cannot run on `chrome://` pages, the Chrome Web Store, or other browser-privileged surfaces.

## Chrome extension (recommended fallback)

1. Download/clone this repository.
2. In Chrome open `chrome://extensions`, enable Developer mode.
3. Select **Load unpacked** and choose the `extension` folder.
4. Click the extension icon on any regular HTTP(S) page to inject or toggle the panel.

Uses only `activeTab` and `scripting` permissions. No persistent all-sites access or background telemetry. Extension is manual per tab and doesn't survive a reload; click the toolbar icon again.

## Controls

| Shortcut | Action |
|---|---|
| `Alt+Shift+C` | Re-center virtual cursor (shows explanatory notice in normal mode) |
| `Alt+Shift+P` | Request or leave virtual Pointer Lock mode |
| `Alt+Shift+M` | Collapse/expand floating panel |
| `Alt+Shift+D` | Toggle dwell click |
| `Esc` | Leave virtual Pointer Lock (native browser behavior) |
| Push upward past top edge | Exit Pointer Lock and regain normal HID cursor to switch browser tabs |

## Important browser limitations

- **No OS cursor teleportation:** web JavaScript cannot move the real operating system cursor. Re-centering works only for our *virtual cursor*.
- **No HID firmware re-zeroing:** a real-world orientation reset on Mudra hardware requires a firmware or companion-app command outside this web prototype.
- **Click assist is best-effort:** scripted `.click()` events are untrusted and may not work on pages requiring real user activation. Input focus is attempted for editable fields. Virtual mode is not intended for complex drag-and-drop, canvas apps, browsers' privileged UI, or every iframe.
- **Sticky hover isn't native CSS hover:** selection remains visually highlighted, but CSS `:hover` cannot generally be pinned from script.
- **No universal slowdown in normal mode:** virtual mode alone offers precision cursor scaling and re-centering. In normal HID mode, magnetic outline and click assist improve target acquisition without moving OS cursor.
- **Safety:** click assist and dwell are **off by default**. Auto activation uses a conservative filter for submit, payment, delete, and other risky actions, but filters are not foolproof. Avoid activating auto-click features on sensitive or financial sites.

## Rebuild

Requirements: Node.js 18+ (zero npm dependencies).

```bash
npm run build
npm run check
```

Commit `index.html` and `extension/engine.js` after rebuilding. `src/engine.js` is the canonical implementation. `index.template.html` is the site template and `build.js` embeds the self-contained bookmarklet source into the generated landing page.

## Publish GitHub Pages

1. Create a **public** repository named `mouse_test` under your own account.
2. Push this folder to its default `main` branch (see `PUBLISH.md`).
3. Go to **Settings → Pages → Build and deployment → Deploy from a branch**, choose `main`, `/ (root)`, **Save**.
4. Open `https://<your-username>.github.io/mouse_test/` after Pages publishes.

This project stores no user movement logs, makes no requests to analytics, and never sends HID signals to a server. Nothing in the code identifies connected hardware; it works with an ordinary mouse too.
## Firmware-linked Air Touch (v1.1)

This browser prototype uses the **existing Mudra firmware protocol** without
changing firmware settings. Click **Connect Mudra** in the injected panel.
Chrome asks which Bluetooth device to authorize. On Windows the device may
already be paired as a HID mouse; GATT access can still be unavailable on some
Bluetooth stacks.

- Service `FFF0`, command characteristic `FFF1` (notify/write).
- System map query: `75 00 00` every 750 ms.
- Response header `01`: firmware IMU master at offset 2 and Air Touch
  (`imuSpecific[10]`) at offset **15** in the current 26+ byte map.
- Air Touch OFF, disconnect, or a stale system map releases Pointer Lock
  back to ordinary HID; Air Touch ON permits virtual mode.
- Battery service `180F`, characteristic `2A19`: read on connect and every
  30 seconds (or notify when supported). Missing battery read does not
  affect the main GATT link.
- An upward motion at the screen edge **never** exits virtual mode.
- A fast horizontal left/right shake enlarges and re-centers the virtual
  pointer. Shake is detected from existing HID motion, without adding
  firmware data streams.

**Browser security limitation:** Chrome requires an actual user activation to
enter Pointer Lock. Air Touch ON cannot silently enter virtual mode from a GATT
notification. Click **Enter virtual** when the firmware status says ON. The
firmware can switch virtual mode OFF without a click. The real OS cursor is
never teleported by page JavaScript. The bookmarklet's Web Bluetooth pairing
is per website origin, and some pages prohibit Bluetooth or bookmarklets.
