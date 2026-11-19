using System.Text.Json;
using MatGame.Local;
using MatGame.Sdk;
using VectorWings.Core;
using VectorWings.Local;
using VectorWings.Module;
using Xunit;

namespace VectorWings.Tests;

public sealed class FlightTests
{
    [Fact]
    public void ReturningPilotKeepsTheSlotAndCannotBeRemovedByAnOldTab()
    {
        var rooms = new RoomRegistry();
        var pilot = new GameAccount(1, "Mira", false, true);
        var friend = new GameAccount(2, "Tavi", false, false);
        var visitor = new GameAccount(3, "Neri", false, true);
        var created = rooms.Create(pilot, "first", "Timed", 0, false);
        var code = created.Frame.Code;
        rooms.Join(friend, "friend", code);
        rooms.Start("first");
        Assert.Empty(rooms.List(visitor.Id));
        Assert.Throws<InvalidOperationException>(() => rooms.Join(visitor, "visitor", code));
        Assert.Equal(created.Slot, rooms.Join(pilot, "second-tab", code).Slot);
        rooms.Leave("first");
        Assert.Equal(2, rooms.Stats().PlayersOnline);
        rooms.Leave("second-tab");
        Assert.True(Assert.Single(rooms.List(pilot.Id)).Returning);
        var returned = rooms.Join(pilot, "reconnected", code);
        Assert.Equal(created.Slot, returned.Slot);
        Assert.Equal(3, returned.Frame.Pilots.Single(player => player.Slot == returned.Slot).Shield);
        rooms.Leave("friend");
        Assert.Equal(1, rooms.Stats().RunningMatches);
        rooms.Leave("reconnected");
        Assert.Empty(rooms.List(pilot.Id));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    public void CampaignHasReachableBossAndCanBeCompleted(int mission)
    {
        var game = new Match("TEST", GameMode.Campaign, mission, true, 13);
        game.Join(1, "Mira", "human");
        game.Start("human");
        var bossSeen = false;
        for (var tick = 0; tick < 30 * 175 && game.State == "Playing"; tick++)
        {
            var state = game.Snapshot();
            var own = state.Pilots[0];
            var target = state.Targets.Where(target => target.Kind is "drone" or "turret" && target.Z > 1)
                .MinBy(target => target.Z);
            var x = target?.X ?? state.Boss?.X ?? 0;
            var y = target?.Y ?? state.Boss?.Y ?? 5;
            game.SetInput("human", new(Math.Clamp(x - own.X, -1, 1), Math.Clamp(y - own.Y, -1, 1), true, false, false, true));
            game.Step();
            bossSeen |= state.Boss?.Name == Missions.Campaign[mission].Boss;
        }
        Assert.True(bossSeen);
        Assert.True(game.Result?.Success);
    }

    [Fact]
    public void TimedRoundEndsAtThreeMinutesAndSupportsATie()
    {
        var game = new Match("TEST", GameMode.Timed, 0, false, 42);
        game.Join(1, "Mira", "one");
        game.Join(2, "Tavi", "two");
        game.Start("one");
        for (var tick = 0; tick < Match.StepRate * 180; tick++) game.Step();
        Assert.Equal(0, game.Snapshot().TimeLeft);
        Assert.Equal([0, 1], game.Snapshot().Winners);
    }

    [Theory]
    [InlineData(GameMode.Cores)]
    [InlineData(GameMode.Timed)]
    public void EachHitTakesOneCoreAndTimedModeRespawnsThePilot(GameMode mode)
    {
        var game = new Match("TEST", mode, 0, false, 23);
        game.Join(1, "Mira", "shooter");
        game.Join(2, "Tavi", "vacant");
        var targetSlot = game.Join(3, "Neri", "target");
        game.Leave("vacant");
        game.Start("shooter");

        PilotView Target() => game.Snapshot().Pilots.Single(pilot => pilot.Slot == targetSlot);
        for (var i = 0; i < 115 && Target().Alive; i++)
        {
            game.SetInput("shooter", new(0, 0, true, false, true, false));
            game.SetInput("target", new(0, 0, false, false, true, false));
            game.Step();
        }
        Assert.Equal(0, Target().Shield);
        Assert.False(Target().Alive);
        Assert.Equal(3, game.Snapshot().Pilots[0].Points);
        if (mode == GameMode.Cores)
        {
            Assert.Equal("Finished", game.State);
            Assert.Equal([0], game.Snapshot().Winners);
        }
        else
        {
            Assert.Equal("Playing", game.State);
            game.SetInput("shooter", new(0, 0, false, false, true, false));
            for (var i = 0; i < 2 * Match.StepRate; i++) game.Step();
            Assert.Equal(3, Target().Shield);
            Assert.True(Target().Alive);
        }
    }

    [Fact]
    public async Task LocalBridgeCanStartWithBotsAndEmitFramesWithoutAHostServer()
    {
        await using var game = new VectorWingsLocal();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(4));
        var host = new LocalHost();
        await game.StartAsync(host, timeout.Token);
        var arguments = new[] { JsonSerializer.SerializeToElement("Cores"), JsonSerializer.SerializeToElement(0), JsonSerializer.SerializeToElement(true) };
        await game.InvokeAsync("Create", arguments, timeout.Token);
        await game.InvokeAsync("Start", [], timeout.Token);
        var frame = (await host.Frame.Task.WaitAsync(timeout.Token)).GetProperty("frame");
        Assert.Equal("Playing", frame.GetProperty("state").GetString());
        Assert.Equal(4, frame.GetProperty("pilots").GetArrayLength());
    }

    private sealed class LocalHost : ILocalHost
    {
        public string DataDirectory => Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        public string PlayerName => "Mira";
        public TaskCompletionSource<JsonElement> Frame { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public void Emit(string name, params object?[] args) => Frame.TrySetResult(JsonSerializer.SerializeToElement(args[0], LocalJson.Options));
        public void Log(string message) { }
    }
}
