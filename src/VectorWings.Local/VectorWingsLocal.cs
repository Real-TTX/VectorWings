using System.Text.Json;
using MatGame.Local;
using VectorWings.Core;

namespace VectorWings.Local;

public sealed class VectorWingsLocal : ILocalGame
{
    private const string Connection = "local";
    private readonly object gate = new();
    private readonly CancellationTokenSource shutdown = new();
    private ILocalHost host = null!;
    private Task? loop;
    private Match? match;
    private LocalProgress progress = new(0, [], 0);

    public string GameId => "vectorwings";

    public async Task StartAsync(ILocalHost localHost, CancellationToken ct)
    {
        host = localHost;
        if (File.Exists(ProfilePath))
        {
            try
            {
                await using var file = File.OpenRead(ProfilePath);
                progress = await JsonSerializer.DeserializeAsync<LocalProgress>(file, LocalJson.Options, ct) ?? progress;
            }
            catch (Exception error) when (error is IOException or JsonException)
            {
                host.Log($"VectorWings profile: {error.Message}");
            }
        }
        loop = RunAsync(shutdown.Token);
    }

    private string ProfilePath => Path.Combine(host.DataDirectory, "flight-progress.json");

    public Task<LocalResponse> RequestAsync(string method, string path, JsonElement? body, CancellationToken ct)
    {
        lock (gate)
            return Task.FromResult(method == "GET" && path == "/progress"
                ? LocalResponse.Ok(new { progress.Matches, Missions = progress.Cleared.Length, progress.BestScore })
                : LocalResponse.Error(404, "Unbekannte Route."));
    }

    public Task<JsonElement?> InvokeAsync(string method, IReadOnlyList<JsonElement> args, CancellationToken ct)
    {
        lock (gate)
        {
            object? response = method switch
            {
                "List" => Array.Empty<object>(),
                "Create" when args.Count == 3 => Create(args[0].GetString(), args[1].GetInt32()),
                "Start" when match is not null => Start(),
                "Input" when args.Count == 1 => Input(args[0].Deserialize<PilotInput>(LocalJson.Options)),
                "Leave" => Leave(),
                _ => throw new InvalidOperationException("Unbekannter Befehl.")
            };
            return Task.FromResult<JsonElement?>(response is null ? null : JsonSerializer.SerializeToElement(response, LocalJson.Options));
        }
    }

    private object Create(string? mode, int mission)
    {
        if (!Enum.TryParse<GameMode>(mode, out var selection) || selection.ToString() != mode ||
            (selection == GameMode.Campaign && (mission < 0 || mission >= Missions.Campaign.Count)))
            throw new InvalidOperationException("Dieser Spielmodus oder diese Mission ist unbekannt.");
        match = new Match("LOKAL", selection, mission, true, Random.Shared.Next());
        match.Join(1, host.PlayerName, Connection);
        return SeatInfo(match);
    }

    private object Start()
    {
        match!.Start(Connection);
        return SeatInfo(match);
    }

    private object? Input(PilotInput? input)
    {
        match?.SetInput(Connection, input);
        return null;
    }

    private object? Leave()
    {
        match = null;
        return null;
    }

    private static object SeatInfo(Match game) => new { Slot = game.Seat(Connection), Frame = game.Snapshot() };

    private async Task RunAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1d / Match.StepRate));
        var counter = 0;
        while (await timer.WaitForNextTickAsync(ct))
        {
            object? message = null;
            LocalProgress? updated = null;
            lock (gate)
            {
                if (match is { State: "Playing" } game)
                {
                    game.Step();
                    if (++counter % 2 == 0 || game.State == "Finished") message = SeatInfo(game);
                    if (game.Result is { } result)
                    {
                        var cleared = result.Mode == GameMode.Campaign && result.Success == true
                            ? progress.Cleared.Append(result.Mission).Distinct().ToArray() : progress.Cleared;
                        progress = updated = new(progress.Matches + 1, cleared,
                            Math.Max(progress.BestScore, result.Players.Single().Score));
                    }
                }
            }
            if (updated is not null)
            {
                try
                {
                    var temporary = ProfilePath + ".tmp";
                    Directory.CreateDirectory(host.DataDirectory);
                    await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(updated, LocalJson.Options), ct);
                    File.Move(temporary, ProfilePath, true);
                }
                catch (IOException error) { host.Log($"VectorWings profile: {error.Message}"); }
            }
            if (message is not null) host.Emit("Frame", message);
        }
    }

    public async ValueTask DisposeAsync()
    {
        await shutdown.CancelAsync();
        if (loop is not null)
        {
            try { await loop; }
            catch (OperationCanceledException) { }
        }
        shutdown.Dispose();
    }
}

internal sealed record LocalProgress(int Matches, int[] Cleared, int BestScore);
