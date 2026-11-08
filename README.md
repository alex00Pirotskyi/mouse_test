# Mudra Smart Cursor — Windows + macOS

Web precision assistance for the Mudra Band **already paired/connected to your OS as a BLE HID mouse**.

**No browser Bluetooth scanning or pairing.** A tiny OS-native helper reads Mudra's
existing firmware GATT status and serves a compatible local JSON API.
The website, bookmarklet and Chrome extension all use this same API:
`http://127.0.0.1:8765/api/status`.

## Download the helper for your OS

| OS | Build (download from GitHub Actions → Artifacts) | Device selection |
| --- | --- | --- |
| Windows 10/11 | [Windows companion (win-x64)](https://github.com/alex00Pirotskyi/mouse_test/actions/workflows/windows-helper.yml) | Windows-paired BLE devices only |
| macOS Apple Silicon | [macOS companion (arm64)](https://github.com/alex00Pirotskyi/mouse_test/actions/workflows/macos-helper.yml) | Already **system-connected** FFF0 peripherals; no scanning |
| macOS Intel | [macOS companion (x86_64)](https://github.com/alex00Pirotskyi/mouse_test/actions/workflows/macos-helper.yml) | Already **system-connected** FFF0 peripherals; no scanning |

See [Windows instructions](windows-helper/README.md) or
[macOS instructions](mac-helper/README.md) for platform-specific setup.

## Quick start

1. Keep Mudra connected to your computer as a normal HID mouse.
2. Download/extract/start the native helper for your OS.
   On macOS, run `MudraSmartCursorBridge.app/Contents/MacOS/MudraSmartCursorBridge`
   in Terminal and allow Bluetooth when prompted. An unsigned app may require
   a manual Open Anyway approval in macOS Privacy & Security.
3. Open the [Mudra Smart Cursor website](https://alex00pirotskyi.github.io/mouse_test/),
   click **Test with local helper**, then **Connect local helper**.
4. Chrome may ask for permission to reach the local network / loopback address.
   The panel shows the OS connection, firmware Air Touch state, and optional battery level.
5. When firmware Air Touch is ON, click **Enter virtual**; OFF or stale status
   returns to normal OS HID mode. Shake to enlarge and re-center the virtual cursor.

The browser cannot enter Pointer Lock silently after a firmware notification.
A user gesture is still required, and Chrome tab bar remains outside virtual mode.

## Firmware contract

- Custom service `FFF0` / notification + command characteristic `FFF1`.
- Read-only system-map request `75 00 00`, about every 750 ms.
- Reply header `01`; IMU master at byte 2; Air Touch `imuSpecific[10]` at byte 15.
- Battery via standard service `180F/2A19` if the operating system permits access.
- No enable/disable writes, no driver changes, no re-pairing, no internet telemetry.
- Windows uses `GetDeviceSelectorFromPairingState(true)`.
- macOS uses CoreBluetooth `retrieveConnectedPeripherals(withServices: [FFF0])`.
  **macOS cannot enumerate all paired BLE peripherals via CoreBluetooth**;
  the no-scan helper reports unavailable if it cannot see HID-connected Mudra.

## Browser controls

- `Alt+Shift+C`: re-center virtual cursor.
- `Alt+Shift+P`: enter/exit virtual mode (user activation required).
- `Alt+Shift+M`: collapse/expand panel.
- `Alt+Shift+D`: toggle optional dwell.
- `Esc`: release Pointer Lock to access browser tabs.
- Horizontal shake: enlarge and re-center the virtual pointer.

The website never moves the OS cursor. Firmware Air Touch OFF releases virtual
mode; moving to the top of the page no longer exits virtual mode.

## Security

The native helper binds only `127.0.0.1:8765` and exposes read-only status.
The website connects locally after a click, and the Chrome extension has a
narrow localhost host permission. Bookmarklets run in page origin, so sites
granted loopback access may read the non-identifying status JSON.
The native helper does not provide device identifiers or firmware write APIs.

## Build and verification

```bash
npm run check
npm run build
```

GitHub Actions builds a Windows executable, macOS arm64 + x86_64 app bundles,
and the Pages website. CI compile/test success does **not** prove macOS will
allow concurrent GATT access to a particular BLE HID device; test on Mudra hardware.
