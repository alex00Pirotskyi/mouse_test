using System.Net;
using System.Diagnostics;
using System.Reflection;
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
// Serve the same built website from the companion itself. No browser
// cross-origin requests or Local Network Access permission are needed here.
using var siteStream = Assembly.GetExecutingAssembly()
    .GetManifestResourceStream("MudraSmartCursorBridge.index.html")
    ?? throw new InvalidOperationException("Embedded index.html missing from native build.");
using var siteReader = new StreamReader(siteStream);
var siteHtml = siteReader.ReadToEnd();
app.MapGet("/", () => Results.Content(siteHtml, "text/html; charset=utf-8"));
Console.WriteLine("Mudra Bridge http://127.0.0.1:8765");
Console.WriteLine("Reads paired Windows BLE devices only. Ctrl+C to exit.");
// A normal double-click launches the local helper AND opens the web UI.
// The browser can then automatically poll /api/status. No second connect step.
if (!args.Contains("--no-browser", StringComparer.OrdinalIgnoreCase))
{
    app.Lifetime.ApplicationStarted.Register(() =>
    {
        try
        {
            Process.Start(new ProcessStartInfo(
                "http://127.0.0.1:8765/")
            {
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("Open the Smart Cursor URL manually: " + ex.Message);
        }
    });
}
await app.RunAsync();
