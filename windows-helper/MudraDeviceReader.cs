using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.GenericAttributeProfile;
using Windows.Devices.Enumeration;
using Windows.Storage.Streams;

namespace MudraSmartCursorBridge;

public sealed record MudraStatus(
    bool connected,
    bool? airTouch,
    int? batteryLevel,
    string state,
    string? lastMapUtc,
    int pairedCount,
    string? error,
    string version = "2.0");

/// <summary>
/// Enumerates Windows-paired BLE devices only. Does not use BLE advertising,
/// pairing APIs, device watchers or unpaired discovery.
/// All GATT traffic is limited to FFF0/FFF1 map queries and BAS reads.
/// </summary>
public sealed class MudraDeviceReader : BackgroundService
{
    private static readonly Guid MudraService = Uuid16(0xFFF0);
    private static readonly Guid CommandChar = Uuid16(0xFFF1);
    private static readonly Guid BatteryService = Uuid16(0x180F);
    private static readonly Guid BatteryChar = Uuid16(0x2A19);
    private static Guid Uuid16(ushort value) =>
        Guid.Parse($"0000{value:x4}-0000-1000-8000-00805f9b34fb");

    private readonly object gate = new();
    private readonly ILogger<MudraDeviceReader>? log;
    private readonly string? preferredName;
    private BluetoothLEDevice? device;
    private GattDeviceService? firmwareService;
    private GattCharacteristic? configChar;
    private GattDeviceService? batteryService;
    private GattCharacteristic? batteryChar;
    private bool connected;
    private bool? airTouch;
    private int? battery;
    private DateTimeOffset? lastMap;
    private int pairedCount;
    private string state = "starting";
    private string? error;

    public MudraDeviceReader(string? preferredName = null, ILogger<MudraDeviceReader>? logger = null)
    {
        this.preferredName = string.IsNullOrWhiteSpace(preferredName) ? null : preferredName;
        log = logger;
    }

    public MudraStatus GetStatus()
    {
        lock (gate)
        {
            // A missing/stale FW map must never be interpreted as Air Touch ON.
            var fresh = lastMap.HasValue && DateTimeOffset.UtcNow - lastMap.Value < TimeSpan.FromSeconds(5);
            return new MudraStatus(
                connected,
                connected && fresh ? airTouch : null,
                connected ? battery : null,
                state,
                fresh ? lastMap?.ToString("O") : null,
                pairedCount,
                error);
        }
    }

    public static async Task ListPairedDevicesAsync()
    {
        var selector = BluetoothLEDevice.GetDeviceSelectorFromPairingState(true);
        var devices = await DeviceInformation.FindAllAsync(selector);
        if (devices.Count == 0)
            Console.WriteLine("No paired BLE devices found in Windows.");
        foreach (var item in devices)
            Console.WriteLine($"  {(string.IsNullOrWhiteSpace(item.Name) ? "<unnamed>" : item.Name)} (paired={item.Pairing.IsPaired})");
    }

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        while (!stop.IsCancellationRequested)
        {
            try
            {
                SetState("looking-for-paired-device", null);
                var paired = await DeviceInformation.FindAllAsync(
                    BluetoothLEDevice.GetDeviceSelectorFromPairingState(true));
                lock (gate) pairedCount = paired.Count;

                // Prefer obvious Mudra names, but allow any already-paired BLE
                // device exposing FFF0. Never enumerate unpaired advertisers.
                var candidates = paired.Where(item => item.Pairing.IsPaired);
                if (preferredName is not null)
                    candidates = candidates.Where(item => item.Name.Contains(preferredName, StringComparison.OrdinalIgnoreCase));
                else
                    candidates = candidates.OrderByDescending(item =>
                        item.Name.Contains("Mudra", StringComparison.OrdinalIgnoreCase) ||
                        item.Name.Contains("Wearable", StringComparison.OrdinalIgnoreCase));

                var found = false;
                foreach (var item in candidates)
                {
                    if (stop.IsCancellationRequested) break;
                    try
                    {
                        if (await OpenPairedDeviceAsync(item, stop))
                        {
                            found = true;
                            await MonitorAsync(stop);
                            break;
                        }
                    }
                    catch (OperationCanceledException) when (stop.IsCancellationRequested) { break; }
                    catch (Exception ex)
                    {
                        log?.LogWarning("Paired device GATT unavailable: {Message}", ex.Message);
                        SetState("gatt-unavailable", ex.Message);
                    }
                    finally
                    {
                        await CloseDeviceAsync();
                    }
                }

                if (!found && !stop.IsCancellationRequested)
                    SetState("paired-device-not-ready",
                        preferredName is null
                            ? "No paired Windows BLE device exposed Mudra FFF0 GATT. Keep HID paired; try --list."
                            : $"No paired BLE device matching '{preferredName}' exposed FFF0.");
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                log?.LogWarning("Windows Bluetooth enumeration failed: {Message}", ex.Message);
                SetState("windows-bluetooth-error", ex.Message);
            }

            try { await Task.Delay(TimeSpan.FromSeconds(3), stop); }
            catch (OperationCanceledException) { break; }
        }
    }

    private async Task<bool> OpenPairedDeviceAsync(DeviceInformation info, CancellationToken stop)
    {
        var candidate = await BluetoothLEDevice.FromIdAsync(info.Id);
        if (candidate is null) return false;
        var services = await candidate.GetGattServicesForUuidAsync(MudraService, BluetoothCacheMode.Cached);
        if (services.Status != GattCommunicationStatus.Success || services.Services.Count == 0)
        {
            candidate.Dispose();
            return false;
        }

        // Only query FFF0: Windows may forbid reading system-owned HID 0x1812.
        var service = services.Services[0];
        var chars = await service.GetCharacteristicsForUuidAsync(CommandChar, BluetoothCacheMode.Cached);
        if (chars.Status != GattCommunicationStatus.Success || chars.Characteristics.Count == 0)
        {
            service.Dispose();
            candidate.Dispose();
            return false;
        }

        var command = chars.Characteristics[0];
        if (!command.CharacteristicProperties.HasFlag(GattCharacteristicProperties.Notify))
        {
            service.Dispose();
            candidate.Dispose();
            return false;
        }

        var sub = await command.WriteClientCharacteristicConfigurationDescriptorAsync(
            GattClientCharacteristicConfigurationDescriptorValue.Notify);
        if (sub != GattCommunicationStatus.Success)
        {
            service.Dispose();
            candidate.Dispose();
            return false;
        }

        device = candidate;
        firmwareService = service;
        configChar = command;
        configChar.ValueChanged += OnFirmwareData;

        // Battery service is optional; Windows can deny it on some devices.
        try
        {
            var bas = await candidate.GetGattServicesForUuidAsync(BatteryService, BluetoothCacheMode.Cached);
            if (bas.Status == GattCommunicationStatus.Success && bas.Services.Count > 0)
            {
                batteryService = bas.Services[0];
                var values = await batteryService.GetCharacteristicsForUuidAsync(BatteryChar, BluetoothCacheMode.Cached);
                if (values.Status == GattCommunicationStatus.Success && values.Characteristics.Count > 0)
                    batteryChar = values.Characteristics[0];
            }
        }
        catch (Exception ex) { log?.LogDebug("Battery GATT unavailable: {Message}", ex.Message); }

        lock (gate)
        {
            connected = true;
            airTouch = null;
            lastMap = null;
            state = "waiting-for-system-map";
            error = null;
        }
        Console.WriteLine("Mudra FFF0 found on paired Windows device. HID pairing preserved.");
        await ReadBatteryAsync();
        return true;
    }

    private void OnFirmwareData(GattCharacteristic sender, GattValueChangedEventArgs args)
    {
        try
        {
            var reader = DataReader.FromBuffer(args.CharacteristicValue);
            var packet = new byte[reader.UnconsumedBufferLength];
            reader.ReadBytes(packet);
            // Same current firmware map layout as MudraFlutter parser.
            // byte 0: 0x01; byte 2: IMU master; byte 5..16: 12 IMU feature
            // flags, including Air Touch at byte 15 (imuSpecific[10]).
            if (packet.Length < 26 || packet[0] != 0x01) return;
            if (packet[2] > 1 || packet[15] > 1) return;
            lock (gate)
            {
                airTouch = packet[2] == 1 && packet[15] == 1;
                lastMap = DateTimeOffset.UtcNow;
                state = "ready";
                error = null;
            }
        }
        catch (Exception ex) { log?.LogDebug("Invalid map: {Message}", ex.Message); }
    }

    private async Task ReadBatteryAsync()
    {
        var ch = batteryChar;
        if (ch is null) return;
        try
        {
            var read = await ch.ReadValueAsync(BluetoothCacheMode.Uncached);
            if (read.Status != GattCommunicationStatus.Success) return;
            var bytes = DataReader.FromBuffer(read.Value);
            if (bytes.UnconsumedBufferLength == 0) return;
            int percentage = bytes.ReadByte();
            if (percentage <= 100) lock (gate) battery = percentage;
        }
        catch (Exception ex) { log?.LogDebug("Battery read unavailable: {Message}", ex.Message); }
    }

    private async Task MonitorAsync(CancellationToken stop)
    {
        var iteration = 0;
        while (!stop.IsCancellationRequested && device is not null)
        {
            if (device.ConnectionStatus != BluetoothConnectionStatus.Connected)
                break;

            try
            {
                var command = configChar;
                if (command is null) break;
                // Firmware status only; never write feature enable/disable.
                using var writer = new DataWriter();
                writer.WriteBytes(new byte[] {0x75, 0x00, 0x00});
                var option = command.CharacteristicProperties.HasFlag(GattCharacteristicProperties.Write)
                    ? GattWriteOption.WriteWithResponse
                    : GattWriteOption.WriteWithoutResponse;
                var status = await command.WriteValueAsync(writer.DetachBuffer(), option);
                if (status != GattCommunicationStatus.Success)
                {
                    SetState("map-request-failed", $"System map write status: {status}");
                }
                if (iteration++ % 40 == 0) await ReadBatteryAsync(); // ~30 seconds
            }
            catch (Exception ex)
            {
                SetState("gatt-read-error", ex.Message);
                break;
            }
            try { await Task.Delay(750, stop); }
            catch (OperationCanceledException) { break; }
        }
    }

    private async Task CloseDeviceAsync()
    {
        lock (gate)
        {
            connected = false;
            airTouch = null;
            battery = null;
            lastMap = null;
        }
        if (configChar is not null)
        {
            try { configChar.ValueChanged -= OnFirmwareData; } catch { }
            try { await configChar.WriteClientCharacteristicConfigurationDescriptorAsync(
                GattClientCharacteristicConfigurationDescriptorValue.None); } catch { }
        }
        firmwareService?.Dispose();
        batteryService?.Dispose();
        device?.Dispose();
        firmwareService = null;
        batteryService = null;
        configChar = null;
        batteryChar = null;
        device = null;
    }

    private void SetState(string name, string? message)
    {
        lock (gate) { state = name; error = message; }
    }
}
