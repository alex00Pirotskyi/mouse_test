using System.Net;
using MudraSmartCursorBridge;

if (!OperatingSystem.IsWindows())
{
    Console.Error.WriteLine("Mudra Smart Cursor Bridge requires Windows 10 or Windows 11.");
    return;
}

var listMode = args.Contains("--list", StringComparer.OrdinalIgnoreCase);
if (listMode)
{
    Console.WriteLine("Paired Windows BLE devices (no advertisement scan):");
    await MudraDeviceReader.ListPairedDevicesAsync();
    return;
}

var preferredName = args.FirstOrDefault(x => x.StartsWith("--device=", StringComparison.OrdinalIgnoreCase))?[9..];
var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://127.0.0.1:8765");
builder.Logging.ClearProviders();
builder.Logging.AddSimpleConsole(o => { o.SingleLine = true; o.TimestampFormat = "HH:mm:ss "; });
builder.Services.AddSingleton(new MudraDeviceReader(preferredName));
builder.Services.AddHostedService(p => p.GetRequiredService<MudraDeviceReader>());
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        // Read-only status, no commands and no identifiers exposed. Permission
        // for loopback access is independently enforced by the browser.
        policy.AllowAnyOrigin().WithMethods("GET").AllowAnyHeader());
});
var app = builder.Build();
app.UseCors();
app.Use(async (context, next) =>
{
    context.Response.Headers.CacheControl = "no-store";
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    await next();
});
app.MapGet("/api/status", (MudraDeviceReader reader) => Results.Json(reader.GetStatus()));
app.MapGet("/health", () => Results.Text("Mudra Smart Cursor Bridge is running"));
app.MapGet("/", () => Results.Text("Mudra Smart Cursor Bridge. Read-only API: /api/status"));
Console.WriteLine("Mudra Bridge http://127.0.0.1:8765");
Console.WriteLine("Reads paired Windows BLE devices only. Ctrl+C to exit.");
await app.RunAsync();
