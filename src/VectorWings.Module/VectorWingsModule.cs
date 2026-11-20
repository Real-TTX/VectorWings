using System.Net;
using System.Reflection;
using MatGame.Sdk;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace VectorWings.Module;

public sealed class VectorWingsModule : IGameModule
{
    public static string Version { get; } = typeof(VectorWingsModule).Assembly
        .GetCustomAttribute<AssemblyInformationalVersionAttribute>()!.InformationalVersion;

    /// <summary>The hub protocol of the game (docs/PROTOCOL.md); 2 = client-simulated ships with reports (VectorWings 0.2).</summary>
    public const int Protocol = 2;

    public GameInfo Info { get; } = new("vectorwings", "VectorWings",
        "Low-Poly-Weltraumshooter: Koop-Kampagne mit Bossen und Smart-Bomben, Kernjagd-Duelle in der Arena.",
        Version, Protocol, "0.2.0", "#ff8a3d", "img/cover.jpg", "img/mark.svg");

    public IReadOnlyList<AdminLink> Admin { get; } =
        [new("VectorWings", "/Admin/VectorWings", "dashboard")];

    public void AddServices(IServiceCollection services, GameEnvironment environment)
    {
        services.AddSingleton(_ => NpgsqlDataSource.Create(environment.ConnectionString));
        services.AddSingleton<ProgressStore>();
        services.AddSingleton<RoomRegistry>();
        services.AddHostedService<GameTicker>();
    }

    public void MapGame(IEndpointRouteBuilder game, GameEnvironment environment)
    {
        game.MapGet("/", (HttpContext http, IWebHostEnvironment host) => PlayerPage(http, host, environment.BasePath))
            .AllowAnonymous();
        game.MapHub<FlightHub>("/hub").RequireAuthorization(GameAccounts.AnyScheme)
            .RequireCors(MatGameProtocol.AppCorsPolicy);
        game.MapGroup("/api").ForGame(Info).MapGet("/progress", async (HttpContext http, ProgressStore store, CancellationToken ct) =>
        {
            var player = http.User.ToAccount();
            if (player is null) return Results.Unauthorized();
            return Results.Ok(await store.ProfileAsync(player.Id, ct));
        }).RequireAuthorization(GameAccounts.AnyScheme);
    }

    private static IResult PlayerPage(HttpContext http, IWebHostEnvironment host, string basePath)
    {
        if (http.Request.Path.Value == basePath) return Results.Redirect(basePath + "/" + http.Request.QueryString);
        var file = host.WebRootFileProvider.GetFileInfo("vectorwings/index.html");
        if (!file.Exists) return Results.NotFound();
        using var reader = new StreamReader(file.CreateReadStream());
        http.Response.Headers.CacheControl = "no-cache";
        var html = reader.ReadToEnd().Replace("content=\"\" name=\"matgame-version\"",
            $"content=\"{WebUtility.HtmlEncode(Version)}\" name=\"matgame-version\"", StringComparison.Ordinal);
        return Results.Content(html, "text/html; charset=utf-8");
    }

    public Task StartAsync(IServiceProvider services, CancellationToken ct) =>
        services.GetRequiredService<ProgressStore>().InitializeAsync(ct);

    public Task<GameStats> StatsAsync(IServiceProvider services, CancellationToken ct) =>
        Task.FromResult(services.GetRequiredService<RoomRegistry>().Stats());

    public async Task<GameProfile?> ProfileAsync(IServiceProvider services, long accountId, CancellationToken ct)
    {
        var profile = await services.GetRequiredService<ProgressStore>().ProfileAsync(accountId, ct);
        return profile.Matches == 0 ? null : new GameProfile(profile.Missions + 1,
            $"{profile.Missions}/4 Missionen · {profile.Medals.Length} Medaillen · {profile.BestScore:N0} Punkte");
    }

    public async Task AccountDeletedAsync(IServiceProvider services, long accountId, CancellationToken ct)
    {
        services.GetRequiredService<RoomRegistry>().RemoveAccount(accountId);
        await services.GetRequiredService<ProgressStore>().RemoveAccountAsync(accountId, ct);
    }
}
