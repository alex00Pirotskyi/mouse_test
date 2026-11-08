# Mudra Smart Cursor — Windows paired-device companion

**Purpose:** Reuse the BLE band already paired with Windows as an HID mouse.
There is no Bluetooth scan, advertisement watcher, browser device picker,
re-pairing or connection to unpaired peripherals.

## Start

1. On Windows 10/11, download the `MudraSmartCursorBridge-win-x64` workflow
   artifact from GitHub Actions, extract the outer zip and inner zip.
2. Launch `MudraSmartCursorBridge.exe` (an unsigned local console tool).
   Keep the console open. It binds **127.0.0.1:8765 only**.
3. Keep the Mudra Band normally paired/connected in Windows Settings.
4. Open https://alex00pirotskyi.github.io/mouse_test/ and click
   **Test and connect Mudra here** → **Connect local helper**.
5. Allow Chrome's **Loopback network** permission if prompted. Air Touch status
   follows the firmware map; battery is shown if the Windows GATT battery read
   succeeds. Firmware Air Touch OFF releases virtual mode.

Check the local API at http://127.0.0.1:8765/api/status

To see devices Windows already considers paired, run in a console:

```powershell
.\MudraSmartCursorBridge.exe --list
```

To select a paired device by part of its Windows name (if multiple are found):

```powershell
.\MudraSmartCursorBridge.exe --device=Mudra
```

If already connected as HID but no FFF0 service is available, check the error
state in `/api/status`. Windows can block GATT enumeration, or your device may
not be present in the BLE paired-device enumeration. Do not remove/re-pair the
device as a first troubleshooting step.

## Firmware contract

- Enumerate **only paired** BLE devices with
  `BluetoothLEDevice.GetDeviceSelectorFromPairingState(true)`.
- Open `FFF0`, characteristic `FFF1`; subscribe to notifications.
- Query `75 00 00` every 750 ms, parse `0x01` system map:
  `imuSpecific[10]` at absolute byte offset 15; IMU master at byte 2.
- Read battery via standard `180F/2A19` every ~30 s if Windows allows.
- Status is **read-only**: no commands to toggle firmware features.
- No device identifiers exposed over HTTP, no external network calls.
- Service binds to `127.0.0.1`, exposes only GET endpoints.
- CORS allows other page origins because bookmarklets can run on arbitrary
  websites. This means a page granted Chrome's loopback-network permission
  may read the non-identifying Air Touch and battery status. For controlled
  deployments prefer an allowlist of trusted origins or an extension proxy.

## Build yourself (Windows .NET SDK 8)

```powershell
dotnet publish .\windows-helper\MudraSmartCursorBridge.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o .\windows-helper\dist
```

The helper does not move the system cursor, inject HID input, or bypass browser
Pointer Lock security. Virtual mode still requires one user-initiated click.
If Windows GATT is unavailable concurrently with HID, the helper reports that
rather than claiming a connection.
