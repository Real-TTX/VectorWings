using MatGame.Sdk;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using VectorWings.Core;

namespace VectorWings.Module;

public sealed class FlightHub(RoomRegistry rooms) : Hub
{
    private GameAccount Account => Context.User?.ToAccount() ?? throw new HubException("Bitte in MatGame anmelden.");

    public RoomListing[] List() => rooms.List(Account.Id);
    public SeatInfo Create(string mode, int mission, bool bots) => Reply(() => rooms.Create(Account, Context.ConnectionId, mode, mission, bots));
    public SeatInfo Join(string code) => Reply(() => rooms.Join(Account, Context.ConnectionId, code));
    public SeatInfo Start() => Reply(() => rooms.Start(Context.ConnectionId));
    public void Input(PilotInput? input) => rooms.Input(Context.ConnectionId, input);
    public void Leave() => rooms.Leave(Context.ConnectionId);

    public override Task OnDisconnectedAsync(Exception? exception)
    {
        Leave();
        return base.OnDisconnectedAsync(exception);
    }

    private static T Reply<T>(Func<T> action)
    {
        try { return action(); }
        catch (InvalidOperationException error) { throw new HubException(error.Message); }
    }
}

internal sealed class GameTicker(RoomRegistry rooms, IHubContext<FlightHub> hub, ProgressStore store, ILogger<GameTicker> log)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1d / Match.StepRate));
        var persistence = Task.CompletedTask;
        var tick = 0;
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            var sends = rooms.Step(++tick % 2 == 0)
                .Select(message => hub.Clients.Client(message.Connection)
                    .SendAsync("Frame", new SeatInfo(message.Slot, message.Frame), stoppingToken));
            await Task.WhenAll(sends);
            if (persistence.IsCompleted && tick % 15 == 0) persistence = SaveAsync(stoppingToken);
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
