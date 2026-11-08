import Foundation
import CoreBluetooth
import Network
import AppKit

// Mudra Smart Cursor Mac Companion.
// Only reuses system-connected BLE peripherals exposing FFF0.
// Does not call scanForPeripherals, request pairing, or modify HID settings.

private enum MudraGATT {
    static let service = CBUUID(string: "FFF0")
    static let command = CBUUID(string: "FFF1")
    static let batteryService = CBUUID(string: "180F")
    static let batteryLevel = CBUUID(string: "2A19")
    static let mapRequest = Data([0x75, 0x00, 0x00])

    static func airTouch(from bytes: Data) -> Bool? {
        // Flutter's current 26+ byte System Map:
        // [0] header 0x01; [2] IMU master; [5...16] imuSpecific[0...11].
        // Air Touch is imuSpecific[10], at absolute offset 15.
        guard bytes.count >= 26, bytes[0] == 0x01,
              bytes[2] <= 1, bytes[15] <= 1 else { return nil }
        return bytes[2] == 1 && bytes[15] == 1
    }
}

private struct BridgeStatus: Encodable {
    let connected: Bool
    let airTouch: Bool?
    let batteryLevel: Int?
    let state: String
    let lastMapUtc: String?
    let pairedCount: Int
    let error: String?
    let version: String
}

private final class MudraMonitor: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    private var central: CBCentralManager!
    private var peripheral: CBPeripheral?
    private var command: CBCharacteristic?
    private var batteryCharacteristic: CBCharacteristic?
    private var candidateCount = 0
    private var airTouch: Bool?
    private var battery: Int?
    private var lastMap: Date?
    private var ready = false
    private var writePending = false
    private var lastWrite: Date?
    private var state = "starting"
    private var error: String?
    private var pollNumber = 0
    private var queryTimer: Timer?
    private var discoveryTimer: Timer?
    private let preferredName: String?
    private let listMode: Bool

    init(preferredName: String?, listMode: Bool) {
        self.preferredName = preferredName
        self.listMode = listMode
        super.init()
        central = CBCentralManager(delegate: self, queue: .main,
                                   options: [CBCentralManagerOptionShowPowerAlertKey: false])
        discoveryTimer = Timer.scheduledTimer(withTimeInterval: 4, repeats: true) { [weak self] _ in
            self?.lookForAlreadyConnectedDevice()
        }
        queryTimer = Timer.scheduledTimer(withTimeInterval: 0.75, repeats: true) { [weak self] _ in
            self?.pollSystemMap()
        }
    }

    func centralManagerDidUpdateState(_ manager: CBCentralManager) {
        switch manager.state {
        case .poweredOn:
            state = "looking-for-system-connected-device"
            error = nil
            lookForAlreadyConnectedDevice()
        case .poweredOff:
            reset("bluetooth-powered-off", "Bluetooth is off on this Mac.")
        case .unauthorized:
            reset("bluetooth-permission-denied", "Allow Bluetooth for MudraSmartCursorBridge in macOS Privacy & Security.")
        case .unsupported:
            reset("bluetooth-unsupported", "CoreBluetooth is unavailable on this Mac.")
        case .resetting:
            reset("bluetooth-resetting", "macOS Bluetooth is resetting.")
        default:
            reset("bluetooth-unavailable", "Bluetooth is not ready yet.")
        }
    }

    private func lookForAlreadyConnectedDevice() {
        guard central.state == .poweredOn else { return }
        // Apple documents that this includes peripherals connected to macOS
        // by OTHER applications; connect() adopts them into our central.
        // This is *not* an inventory of all paired devices.
        let connected = central.retrieveConnectedPeripherals(withServices: [MudraGATT.service])
        let matches = connected.filter {
            preferredName == nil ||
                ($0.name?.localizedCaseInsensitiveContains(preferredName!) ?? false)
        }
        candidateCount = matches.count
        if listMode {
            print("System-connected BLE devices exposing FFF0 (no scan):")
            for item in matches {
                print("  " + (item.name ?? "<unnamed>"))
            }
            if matches.isEmpty { print("  None currently exposed by CoreBluetooth.") }
            fflush(stdout)
            exit(0)
        }
        guard peripheral == nil else { return }
        let candidate = matches.first {
            ($0.name ?? "").localizedCaseInsensitiveContains("Mudra") ||
            ($0.name ?? "").localizedCaseInsensitiveContains("Wearable")
        } ?? matches.first

        guard let candidate else {
            state = "no-system-connected-fff0-device"
            error = "No OS-connected Mudra FFF0 service visible. The HID link may not expose custom GATT to CoreBluetooth."
            return
        }
        peripheral = candidate
        candidate.delegate = self
        state = "attaching-to-system-connected-device"
        error = nil
        central.connect(candidate, options: nil)
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        guard self.peripheral === peripheral else { return }
        state = "discovering-fff0"
        peripheral.discoverServices([MudraGATT.service, MudraGATT.batteryService])
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error failure: Error?) {
        guard self.peripheral === peripheral else { return }
        reset("gatt-unavailable", failure?.localizedDescription ?? "Could not attach to the existing system Bluetooth link.")
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error failure: Error?) {
        guard self.peripheral === peripheral else { return }
        reset("gatt-disconnected", failure?.localizedDescription)
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices discoveryError: Error?) {
        guard self.peripheral === peripheral else { return }
        if let discoveryError {
            reset("service-discovery-failed", discoveryError.localizedDescription)
            return
        }
        let services = peripheral.services ?? []
        guard let firmware = services.first(where: { $0.uuid == MudraGATT.service }) else {
            reset("fff0-not-exposed", "Mudra FFF0 GATT service is not exposed on this macOS link.")
            return
        }
        peripheral.discoverCharacteristics([MudraGATT.command], for: firmware)
        if let bas = services.first(where: { $0.uuid == MudraGATT.batteryService }) {
            peripheral.discoverCharacteristics([MudraGATT.batteryLevel], for: bas)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error discoveryError: Error?) {
        guard self.peripheral === peripheral else { return }
        if service.uuid == MudraGATT.batteryService {
            guard discoveryError == nil else { return } // BAS optional
            if let characteristic = service.characteristics?.first(where: { $0.uuid == MudraGATT.batteryLevel }) {
                batteryCharacteristic = characteristic
                if characteristic.properties.contains(.read) { peripheral.readValue(for: characteristic) }
                if characteristic.properties.contains(.notify) {
                    peripheral.setNotifyValue(true, for: characteristic)
                }
            }
            return
        }

        if let discoveryError {
            reset("fff1-discovery-failed", discoveryError.localizedDescription)
            return
        }
        guard let characteristic = service.characteristics?.first(where: { $0.uuid == MudraGATT.command }) else {
            reset("fff1-missing", "Firmware characteristic FFF1 was not found.")
            return
        }
        guard characteristic.properties.contains(.notify) else {
            reset("fff1-notify-unavailable", "FFF1 does not support notifications.")
            return
        }
        guard characteristic.properties.contains(.write) || characteristic.properties.contains(.writeWithoutResponse) else {
            reset("fff1-write-unavailable", "FFF1 cannot request the system map.")
            return
        }
        command = characteristic
        state = "subscribing-to-system-map"
        peripheral.setNotifyValue(true, for: characteristic)
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error notificationError: Error?) {
        guard self.peripheral === peripheral else { return }
        if characteristic.uuid == MudraGATT.command {
            if let notificationError {
                reset("fff1-subscription-failed", notificationError.localizedDescription)
                return
            }
            ready = characteristic.isNotifying
            state = ready ? "waiting-for-system-map" : "fff1-not-notifying"
            if ready { pollSystemMap() }
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error updateError: Error?) {
        guard self.peripheral === peripheral, updateError == nil, let data = characteristic.value else { return }
        if characteristic.uuid == MudraGATT.command {
            if let enabled = MudraGATT.airTouch(from: data) {
                airTouch = enabled
                lastMap = Date()
                error = nil
                state = "ready"
            }
        } else if characteristic.uuid == MudraGATT.batteryLevel {
            if let first = data.first, first <= 100 { battery = Int(first) }
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error writeError: Error?) {
        guard self.peripheral === peripheral, characteristic.uuid == MudraGATT.command else { return }
        writePending = false
        if let writeError {
            state = "map-request-failed"
            error = writeError.localizedDescription
        }
    }

    private func pollSystemMap() {
        guard ready, central.state == .poweredOn,
              let peripheral, let command,
              peripheral.state == .connected else { return }
        if writePending {
            if let lastWrite, Date().timeIntervalSince(lastWrite) < 3 { return }
            writePending = false
        }
        let withResponse = command.properties.contains(.write)
        let mode: CBCharacteristicWriteType = withResponse ? .withResponse : .withoutResponse
        if withResponse {
            writePending = true
            lastWrite = Date()
        }
        // The ONLY firmware write: a read-only GET of the existing system map.
        peripheral.writeValue(MudraGATT.mapRequest, for: command, type: mode)
        pollNumber += 1
        if pollNumber % 40 == 0, let batteryCharacteristic,
           batteryCharacteristic.properties.contains(.read) {
            peripheral.readValue(for: batteryCharacteristic)
        }
    }

    private func reset(_ newState: String, _ newError: String?) {
        ready = false
        airTouch = nil
        battery = nil
        lastMap = nil
        writePending = false
        state = newState
        error = newError
        command = nil
        batteryCharacteristic = nil
        // This companion never cancels the system Bluetooth connection and
        // never unpairs anything. It only drops its local CBPeripheral handle.
        peripheral?.delegate = nil
        peripheral = nil
    }

    func snapshot() -> BridgeStatus {
        // Called via DispatchQueue.main.sync from the local HTTP listener.
        let isConnected = ready && peripheral?.state == .connected
        let fresh = isConnected && lastMap.map { Date().timeIntervalSince($0) < 5 } == true
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return BridgeStatus(
            connected: isConnected,
            airTouch: fresh ? airTouch : nil,
            batteryLevel: isConnected ? battery : nil,
            state: isConnected && !fresh && lastMap != nil ? "system-map-stale" : state,
            lastMapUtc: fresh ? lastMap.map { iso.string(from: $0) } : nil,
            // macOS has no global paired BLE enumeration API. Here this is
            // the count of *system-connected* FFF0 candidate devices only.
            pairedCount: candidateCount,
            error: error,
            version: "2.1-macos"
        )
    }
}

private final class StatusServer {
    private let monitor: MudraMonitor
    private let siteHTML: Data?
    private let listener: NWListener
    private let queue = DispatchQueue(label: "mudra.bridge.http")

    init(monitor: MudraMonitor) throws {
        self.monitor = monitor
        // The signed/unsigned .app bundle includes the self-contained
        // static page at Contents/Resources/index.html.
        let bundledPage = Bundle.main.url(forResource: "index", withExtension: "html")
        self.siteHTML = bundledPage.flatMap { try? Data(contentsOf: $0) }
        let params = NWParameters.tcp
        // Restrict service to this Mac. Never listen on LAN interfaces.
        params.requiredLocalEndpoint = .hostPort(
            host: NWEndpoint.Host("127.0.0.1"),
            port: NWEndpoint.Port(rawValue: 8765)!)
        listener = try NWListener(using: params)
    }

    func start() {
        listener.stateUpdateHandler = { state in
            switch state {
            case .ready:
                print("Mudra Mac Bridge ready at http://127.0.0.1:8765/api/status")
                // Finder launch is one action: start the helper and open the UI.
                // Browser loopback consent may still be requested once.
                if !CommandLine.arguments.contains("--no-browser") {
                    DispatchQueue.main.async {
                        if let url = URL(string: "http://127.0.0.1:8765/") {
                            NSWorkspace.shared.open(url)
                        }
                    }
                }
            case .failed(let error): fputs("Local HTTP listener failed: \(error)\n", stderr)
            default: break
            }
        }
        listener.newConnectionHandler = { [weak self] conn in
            self?.handle(conn)
        }
        listener.start(queue: queue)
    }

    private func handle(_ connection: NWConnection) {
        connection.start(queue: queue)
        receive(connection, bytes: Data())
    }

    private func receive(_ connection: NWConnection, bytes: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] data, _, done, error in
            guard let self else { connection.cancel(); return }
            var accumulated = bytes
            if let data { accumulated.append(data) }
            if accumulated.count > 8192 {
                self.respond(connection, status: "413 Payload Too Large", data: Data(), contentType: "text/plain")
                return
            }
            let headerComplete = accumulated.range(of: Data("\r\n\r\n".utf8)) != nil
            if !headerComplete {
                if done || error != nil { connection.cancel() }
                else { self.receive(connection, bytes: accumulated) }
                return
            }
            let request = String(data: accumulated, encoding: .utf8) ?? ""
            let fields = request.components(separatedBy: "\r\n").first?.split(separator: " ") ?? []
            guard fields.count >= 2 else {
                self.respond(connection, status: "400 Bad Request", data: Data(), contentType: "text/plain")
                return
            }
            let method = String(fields[0])
            let path = String(fields[1])
            if method == "OPTIONS" {
                self.respond(connection, status: "204 No Content", data: Data(), contentType: "text/plain")
                return
            }
            guard method == "GET" else {
                self.respond(connection, status: "405 Method Not Allowed", data: Data(), contentType: "text/plain")
                return
            }
            if path == "/api/status" {
                let status = DispatchQueue.main.sync { self.monitor.snapshot() }
                let output = (try? JSONEncoder().encode(status)) ?? Data("{}".utf8)
                self.respond(connection, status: "200 OK", data: output, contentType: "application/json; charset=utf-8")
            } else if path == "/" {
                guard let page = siteHTML else {
                    self.respond(connection, status: "503 Service Unavailable",
                                 data: Data("Bundled Smart Cursor page is missing.".utf8),
                                 contentType: "text/plain; charset=utf-8")
                    return
                }
                self.respond(connection, status: "200 OK", data: page,
                             contentType: "text/html; charset=utf-8")
            } else if path == "/health" {
                self.respond(connection, status: "200 OK",
                             data: Data("Mudra macOS bridge running".utf8),
                             contentType: "text/plain; charset=utf-8")
            } else {
                self.respond(connection, status: "404 Not Found", data: Data(), contentType: "text/plain")
            }
        }
    }

    private func respond(_ connection: NWConnection, status: String, data: Data, contentType: String) {
        let headers = [
            "HTTP/1.1 \(status)",
            "Content-Type: \(contentType)",
            "Content-Length: \(data.count)",
            "Cache-Control: no-store",
            "X-Content-Type-Options: nosniff",
            "Access-Control-Allow-Origin: *",
            "Access-Control-Allow-Methods: GET, OPTIONS",
            "Access-Control-Allow-Headers: content-type",
            "Access-Control-Allow-Private-Network: true",
            "Connection: close", "", ""
        ].joined(separator: "\r\n")
        var output = Data(headers.utf8)
        output.append(data)
        connection.send(content: output, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }
}

let arguments = Array(CommandLine.arguments.dropFirst())
if arguments.contains("--help") {
    print("""
Mudra Smart Cursor Bridge for macOS (already-connected device only)
Usage: MudraSmartCursorBridge [--list] [--name=substring] [--self-test]
Binds http://127.0.0.1:8765. Ctrl+C to quit.
""")
    exit(0)
}
if arguments.contains("--self-test") {
    var packet = Data(repeating: 0, count: 27)
    packet[0] = 0x01; packet[2] = 1; packet[15] = 1
    precondition(MudraGATT.airTouch(from: packet) == true)
    packet[15] = 0
    precondition(MudraGATT.airTouch(from: packet) == false)
    packet[15] = 1; packet[2] = 0
    precondition(MudraGATT.airTouch(from: packet) == false)
    packet[2] = 1; packet[15] = 0x17
    precondition(MudraGATT.airTouch(from: packet) == nil)
    precondition(MudraGATT.airTouch(from: Data(repeating: 0, count: 21)) == nil)
    print("macOS System Map tests passed (Air Touch on/off, master off, invalid, legacy).")
    exit(0)
}
let name = arguments.first(where: { $0.hasPrefix("--name=") }).map { String($0.dropFirst(7)) }
private let monitor = MudraMonitor(preferredName: name, listMode: arguments.contains("--list"))
if !arguments.contains("--list") {
    do {
        let server = try StatusServer(monitor: monitor)
        server.start()
        print("Reusing system-connected Mudra BLE FFF0; no scans, pairing or HID changes.")
        print("Grant Bluetooth access when macOS requests it. Ctrl+C to exit.")
        RunLoop.main.run()
        withExtendedLifetime(server) {}
    } catch {
        fputs("Cannot start localhost server: \(error)\n", stderr)
        exit(1)
    }
} else {
    RunLoop.main.run()
}
