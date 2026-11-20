using System.Text.Json;
using MatGame.Local;
using VectorWings.Core;

namespace VectorWings.Local;

/// <summary>
/// VectorWings offline in the app: the same room as on the server, the local guest flies with the crew as bots.
/// The hub methods and the Frame message have the shapes of the online hub (docs/PROTOCOL.md).
/// </summary>
public sealed class VectorWingsLocal : ILocalGame
{
    private const string Connection = "local";
    private readonly object gate = new();
    private readonly CancellationTokenSource shutdown = new();
    private ILocalHost host = null!;
    private Task? loop;
    private Room? room;
    private LocalProgress progress = new(0, [], 0, [], []);

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
                progress = progress with { Best = (int[][]?)progress.Best ?? [], Medals = (int[]?)progress.Medals ?? [] };
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
                ? LocalResponse.Ok(new
                {
                    progress.Matches, Missions = progress.Cleared.Length, progress.BestScore, progress.Cleared,
                    Best = progress.Best.ToDictionary(pair => pair[0].ToString(), pair => pair[1]), progress.Medals
                })
                : LocalResponse.Error(404, "Unbekannte Route."));
    }

    public Task<JsonElement?> InvokeAsync(string method, IReadOnlyList<JsonElement> args, CancellationToken ct)
    {
        lock (gate)
        {
            object? response = method switch
            {
                "List" => Array.Empty<object>(),
                "Create" when args.Count >= 3 => Create(args[0].GetString(), args[1].GetInt32(), args.Count > 3 ? args[3].GetInt32() : 0),
                "Ship" when room is not null && args.Count == 1 => Ship(args[0].GetInt32()),
                "Start" when room is not null => Start(),
                "Report" when args.Count == 1 => Report(args[0].Deserialize<Report>(LocalJson.Options)),
                "Leave" => Leave(),
                "Join" => throw new InvalidOperationException("Offline gibt es keine anderen Partien."),
                _ => throw new InvalidOperationException("Unbekannter Befehl.")
            };
            return Task.FromResult<JsonElement?>(response is null ? null : JsonSerializer.SerializeToElement(response, LocalJson.Options));
        }
    }

    private object Create(string? mode, int mission, int ship)
    {
        if (!Enum.TryParse<GameMode>(mode, out var selection) || selection.ToString() != mode ||
            (selection == GameMode.Campaign && (mission < 0 || mission >= Levels.Missions.Count)))
            throw new InvalidOperationException("Dieser Spielmodus oder diese Mission ist unbekannt.");
        room = new Room("LOKAL", selection, mission, true, Random.Shared.Next());
        room.Join(1, host.PlayerName, Connection, ship);
        return Seat(room);
    }

    private object Ship(int ship)
    {
        room!.ChooseShip(Connection, ship);
        return Seat(room);
    }

    private object Start()
    {
        room!.Start(Connection);
        return Seat(room);
    }

    private object? Report(Report? report)
    {
        room?.Report(Connection, report);
        return null;
    }

    private object? Leave()
    {
        room = null;
        return null;
    }

    private static object Seat(Room game, bool full = true) => new { Slot = game.Seat(Connection), Frame = game.Snapshot(full) };

    private async Task RunAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(Room.Step));
        while (await timer.WaitForNextTickAsync(ct))
        {
            object? message = null;
            LocalProgress? updated = null;
            lock (gate)
            {
                if (room is { State: "Playing" } game)
                {
                    game.Advance();
                    message = Seat(game, false);
                    if (game.Result is { } result)
                    {
                        updated = progress = Record(progress, result);
                        room = null;
                    }
                }
            }
            if (message is not null) host.Emit("Frame", message);
            if (updated is not null) await SaveAsync(updated, ct);
        }
    }

    internal static LocalProgress Record(LocalProgress progress, MatchResult result)
    {
        var score = result.Players.Length > 0 ? result.Players.Max(p => p.Score) : 0;
        var campaign = result.Mode == GameMode.Campaign;
        var cleared = campaign && result.Success == true ? progress.Cleared.Append(result.Mission).Distinct().Order().ToArray() : progress.Cleared;
        var best = progress.Best.Where(pair => pair[0] != result.Mission || !campaign).ToList();
        if (campaign) best.Add([result.Mission, Math.Max(score, progress.Best.FirstOrDefault(pair => pair[0] == result.Mission)?[1] ?? 0)]);
        var medals = result.Medal ? progress.Medals.Append(result.Mission).Distinct().Order().ToArray() : progress.Medals;
        return new LocalProgress(progress.Matches + 1, cleared, Math.Max(progress.BestScore, score), best.ToArray(), medals);
    }

    private async Task SaveAsync(LocalProgress updated, CancellationToken ct)
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

/// <summary>The offline profile (flight-progress.json): Best holds [mission, score] pairs.</summary>
internal sealed record LocalProgress(int Matches, int[] Cleared, int BestScore, int[][] Best, int[] Medals);
