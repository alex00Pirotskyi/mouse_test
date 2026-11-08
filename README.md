# Mudra Smart Cursor

Web precision assistance for a **Mudra Band already paired with Windows as a BLE HID mouse**.
Live firmware status now comes from a **read-only Windows companion**, not Web Bluetooth.

## Get started

1. Keep Mudra normally paired and connected to Windows (HID).
2. Download the ZIP artifact from [Build Windows paired-device helper](https://github.com/alex00Pirotskyi/mouse_test/actions/workflows/windows-helper.yml), extract and launch `MudraSmartCursorBridge.exe`.
3. Open [Mudra Smart Cursor](https://alex00pirotskyi.github.io/mouse_test/), click **Test with Windows helper**, then **Connect local helper**.
4. Approve **Loopback network** access in Chrome if asked. Watch the Mudra connectivity, Air Touch and battery indicators.
5. With Air Touch ON, click **Enter virtual**. Firmware Air Touch OFF, disconnect, or stale map automatically exits virtual mode. Shake the virtual pointer to enlarge/re-center.
6. Install the latest bookmarklet or Chrome extension for other websites. The extension is more reliable on sites with a restrictive Content Security Policy.

## Windows paired-device discovery — no scans

`windows-helper` uses `BluetoothLEDevice.GetDeviceSelectorFromPairingState(true)`
and `DeviceInformation.FindAllAsync`, opening **only paired BLE devices**.
It does NOT scan advertisements or enumerate unpaired peripherals.
It queries the existing Mudra `FFF0 / FFF1` GATT characteristics without accessing protected HID service `1812`.
The companion is a local-only HTTP server (`127.0.0.1:8765`), with just a read-only status endpoint.

- Firmware system-map GET: `75 00 00`.
- Map response header `0x01`: IMU master at byte 2; Air Touch at `imuSpecific[10]` (byte 15).
- Battery: standard BLE Battery Service `180F`, characteristic `2A19` if accessible.
- No firmware feature writes, changes to pairing, installation of drivers, or remote telemetry.
- No guarantees all Windows HID connections expose GATT to another process; the companion reports failures.

For detailed helper instructions, see [windows-helper/README.md](windows-helper/README.md).
Test with `http://127.0.0.1:8765/api/status` while the helper runs.

## Browser controls

- `Alt+Shift+C`: re-center virtual cursor
- `Alt+Shift+P`: enter/exit virtual mode (entry requires user gesture)
- `Alt+Shift+M`: collapse/expand panel
- `Alt+Shift+D`: toggle optional dwell click
- `Esc`: leave Pointer Lock to use browser tabs
- Horizontal shake: enlarge and re-center virtual pointer

Firmware Air Touch OFF automatically unlocks. Moving to the top edge no longer unlocks.
Entering Pointer Lock on Air Touch ON still requires a user click due to browser security.
The bookmarklet cannot move the OS cursor, and normal HID mouse motion is unchanged.

## Browser/local security

The first local helper request occurs only after you click Connect local helper.
Chrome 156+ may prompt for **Loopback network** permission for requests from a public webpage.
The helper binds only to localhost and exposes only connection state, Air Touch, and battery.
Because bookmarklets may execute on many websites, CORS permits reads from different origins;
a site granted loopback access could read this small status payload.
No firmware control operations are exposed.

The page is hosted by GitHub Pages, with no backend. The Windows helper is installed only
on your PC. The Chrome extension uses `activeTab`, `scripting`, and a narrow loopback
host permission to fetch status. No broad site-scanning permission is required.

## Build & test

```
npm run check
npm run build
dotnet publish windows-helper/MudraSmartCursorBridge.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
```

GitHub Actions builds the Windows EXE and deploys the static page separately.
