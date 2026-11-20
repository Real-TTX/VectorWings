using MatGame.Sdk;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using VectorWings.Core;

namespace VectorWings.Module;

/// <summary>The hub of VectorWings (docs/PROTOCOL.md): lobby methods with an answer, Report without one, Frame from the server.</summary>
public sealed class FlightHub(RoomRegistry rooms) : Hub
{
    private GameAccount Account => Context.User?.ToAccount() ?? throw new HubException("Bitte in MatGame anmelden.");

    public RoomListing[] List() => rooms.List(Account.Id);
    public Task<SeatInfo> Create(string mode, int mission, bool bots, int ship) => Lobby(() => rooms.Create(Account, Context.ConnectionId, mode, mission, bots, ship));
    public Task<SeatInfo> Join(string code, int ship) => Lobby(() => rooms.Join(Account, Context.ConnectionId, code, ship));
    public Task<SeatInfo> Ship(int ship) => Lobby(() => rooms.Ship(Context.ConnectionId, ship));
    public Task<SeatInfo> Start() => Lobby(() => rooms.Start(Context.ConnectionId), started: true);
    public void Report(Report? report) => rooms.Report(Context.ConnectionId, report);

    public Task Leave() => Notify(rooms.Leave(Context.ConnectionId));

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await Leave();
        await base.OnDisconnectedAsync(exception);
    }

    private async Task<SeatInfo> Lobby(Func<SeatInfo> action, bool started = false)
    {
        SeatInfo seat;
        try { seat = action(); }
        catch (InvalidOperationException error) { throw new HubException(error.Message); }
        // Everybody else in the lobby sees the change at once (the ticker only sends running matches).
        await Notify(started ? [] : rooms.Lobby(Context.ConnectionId));
        return seat;
    }

    private Task Notify(List<Transmission> others) =>
        Task.WhenAll(others.Select(t => Clients.Client(t.Connection).SendAsync("Frame", new SeatInfo(t.Slot, t.Frame))));
}

/// <summary>Steps every room 20 times a second, sends the frames and saves finished results.</summary>
internal sealed class GameTicker(RoomRegistry rooms, IHubContext<FlightHub> hub, ProgressStore store, ILogger<GameTicker> log)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(Room.Step));
        var persistence = Task.CompletedTask;
        var tick = 0;
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            var sends = rooms.Advance().Select(message => hub.Clients.Client(message.Connection)
                .SendAsync("Frame", new SeatInfo(message.Slot, message.Frame), stoppingToken));
            try { await Task.WhenAll(sends); }
            catch (Exception error) when (!stoppingToken.IsCancellationRequested) { log.LogDebug(error, "A VectorWings frame could not be sent."); }
            if (persistence.IsCompleted && ++tick % 20 == 0) persistence = SaveAsync(stoppingToken);
        }
        await persistence;
    }

    private async Task SaveAsync(CancellationToken ct)
    {
        foreach (var result in rooms.Results())
        {
            try
            {
                await store.SaveAsync(result, ct);
                rooms.Acknowledge(result.Token);
            }
            catch (Exception error) when (!ct.IsCancellationRequested)
            {
                log.LogWarning(error, "VectorWings result {Token} could not be saved yet.", result.Token);
            }
        }
    }
}
