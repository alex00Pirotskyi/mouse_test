# Mudra Smart Cursor — macOS companion (Apple Silicon + Intel)

This helper bundles the same self-contained Smart Cursor website and provides the
**same local read-only JSON API** as the Windows companion:
`http://127.0.0.1:8765/api/status`. The existing GitHub Pages / Chrome extension
can use either helper without changes.

## macOS Bluetooth behavior

CoreBluetooth on macOS **cannot enumerate the full set of paired BLE devices**.
It can retrieve peripherals **already connected to macOS** that expose a
particular service using `retrieveConnectedPeripherals(withServices:)`.
This includes peripherals connected by the system or another app. The helper
requests only FFF0 and **never scans or initiates pairing**.

It then calls `central.connect()` to adopt the **existing system connection**
into its CoreBluetooth context. That does not mean disconnecting/re-pairing HID.
If your macOS HID-connected Mudra device is not returned for FFF0, it will
report `no-system-connected-fff0-device` and will **not scan**.

## Download and launch

1. Go to [macOS helper build](https://github.com/alex00Pirotskyi/mouse_test/actions/workflows/macos-helper.yml)
   and download the `arm64` artifact for Apple Silicon (M1/M2/M3/M4/M5 etc.) or
   the `x86_64` artifact for Intel Mac.
2. Extract the GitHub artifact and the zip inside it.
3. Keep Mudra normally paired / connected as HID in macOS Bluetooth settings.
4. Double-click the `MudraSmartCursorBridge.app` bundle, or for diagnostic
   output open **Terminal** in the extracted folder and run:

   ```bash
   ./MudraSmartCursorBridge.app/Contents/MacOS/MudraSmartCursorBridge
   ```

   macOS may block this unsigned prototype at first launch. Review it in
   **System Settings → Privacy & Security** and choose **Open Anyway** if you
   trust the source. When asked, allow Bluetooth access.
5. Check `http://127.0.0.1:8765/api/status` in Chrome. A successful status
   includes `connected:true`, `airTouch:true/false`, and optional battery.
6. The companion opens **http://127.0.0.1:8765/** automatically, serves the
   bundled Smart Cursor page, and starts status monitoring. Because the
   page and API are same-origin, no Chrome cross-origin permission is needed.

To inspect system-connected FFF0 devices without BLE scanning:

```bash
./MudraSmartCursorBridge.app/Contents/MacOS/MudraSmartCursorBridge --list
```

To match a particular system-connected peripheral name:

```bash
./MudraSmartCursorBridge.app/Contents/MacOS/MudraSmartCursorBridge --name=Mudra
```

Stop the helper with Ctrl+C.

## Security and firmware behavior

- No CoreBluetooth `scanForPeripherals`, no advertising scans, no pairing.
- Service `FFF0`, notification/write characteristic `FFF1`.
- Every 750 ms, write **GET-only** map request `75 00 00`. Map reply header
  `01` has IMU master at index 2 and Air Touch `imuSpecific[10]` at byte 15.
- Standard Battery Service `180F/2A19`, if available.
- **No firmware commands to enable/disable Air Touch**, no HID injection.
- No identifying device details exposed to websites; `pairedCount` is
  retained for cross-platform JSON compatibility but means the number of
  **system-connected FFF0 candidates** on macOS (not the full paired set).
- Only binds localhost; no cloud connection.
- Chrome must still have user activation to enter Pointer Lock; Air Touch OFF
  automatically exits virtual mode.
- Web pages with Chrome loopback permission can read the status; browser
  extension uses an explicitly declared localhost permission.

## Build from source (requires Xcode Command Line Tools)

```bash
mkdir -p out/MudraSmartCursorBridge.app/Contents/MacOS out/MudraSmartCursorBridge.app/Contents/Resources
cp mac-helper/Info.plist out/MudraSmartCursorBridge.app/Contents/Info.plist
cp index.html out/MudraSmartCursorBridge.app/Contents/Resources/index.html
swiftc -O mac-helper/Sources/MudraSmartCursorBridge/main.swift \
  -framework CoreBluetooth -framework Network -framework AppKit \
  -o out/MudraSmartCursorBridge.app/Contents/MacOS/MudraSmartCursorBridge
codesign --force --sign - out/MudraSmartCursorBridge.app
out/MudraSmartCursorBridge.app/Contents/MacOS/MudraSmartCursorBridge --self-test
```

The build workflow checks both architectures on macOS hosted runners. A successful
CI compilation cannot prove a physical HID-connected Mac exposes FFF0 through
CoreBluetooth; actual on-device GATT availability remains to be tested.
