using VectorWings.Core;
using VectorWings.Local;
using Xunit;

namespace VectorWings.Tests;

public sealed class RoomTests
{
    private static Room Campaign(int mission = 0, bool bots = true, params string[] connections)
    {
        var room = new Room("TEST", GameMode.Campaign, mission, bots, 1);
        var account = 1;
        foreach (var connection in connections.Length == 0 ? ["a"] : connections)
            room.Join(account++, "Pilot " + connection, connection, 0);
        return room;
    }

    private static void Until(Room room, double time)
    {
        while (room.Time < time && room.State == "Playing") room.Advance();
    }

    private static PilotView Pilot(Room room, int slot) => room.Snapshot().Pilots.Single(p => p.Slot == slot);

    private static Report Hits(int slot, int id, int damage) => new(H: [[slot, id, damage]]);

    [Fact]
    public void LevelsLoadFromTheSharedJson()
    {
        Assert.Equal(4, Levels.Missions.Count);
        foreach (var mission in Levels.Missions)
        {
            Assert.Equal(Enumerable.Range(0, mission.Enemies.Length), mission.Enemies.Select(e => e.Id));
            Assert.All(mission.Boss.Phases.SelectMany(p => p), index => Assert.InRange(index, 0, mission.Boss.Parts.Length - 1));
            Assert.Equal(mission.Boss.Parts.Length, mission.Boss.Phases.SelectMany(p => p).Distinct().Count());
            Assert.True(mission.Enemies.All(e => e.Time < mission.BossAt));
            Assert.Contains(mission.Pickups, p => p.Kind == "gate");
        }
        Assert.Equal(7, Levels.Arena.Pickups.Length);
    }

    [Fact]
    public void OnlyTheLeaderStartsAndBotsFillTheSquadron()
    {
        var room = Campaign(0, true, "a", "b");
        Assert.Throws<InvalidOperationException>(() => room.Start("b"));
        room.ChooseShip("b", 2);
        room.Start("a");
        var frame = room.Snapshot();
        Assert.Equal("Playing", frame.State);
        Assert.Equal(4, frame.Pilots.Length);
        Assert.Equal(2, frame.Pilots.Count(p => p.Bot));
        Assert.Equal(130, frame.Pilots.Single(p => p.Slot == 1).MaxShield);
        Assert.Equal(2, frame.Pilots.Single(p => p.Slot == 1).Laser);
        Assert.Equal(0, frame.Driver);
    }

    [Fact]
    public void HitsKillEnemiesOnceAndScore()
    {
        var room = Campaign();
        room.Start("a");
        var bomber = Levels.Missions[0].Enemies.First(e => e.Kind == "bomber");
        room.Report("a", Hits(0, bomber.Id, 3));
        Assert.Empty(room.Snapshot().Kills);
        Until(room, bomber.Time - 1);
        room.Report("a", Hits(0, bomber.Id, 3));
        Assert.Contains(room.Snapshot().Hurt, pair => pair[0] == bomber.Id && pair[1] == bomber.Health - 3);
        room.Report("a", Hits(0, bomber.Id, 12));
        room.Report("a", Hits(0, bomber.Id, 12));
        var frame = room.Snapshot(true);
        Assert.Single(frame.Kills);
        Assert.Contains(bomber.Id, frame.Dead!);
        Assert.Equal(bomber.Score, Pilot(room, 0).Score);
        Assert.Equal(1, Pilot(room, 0).Hits);
    }

    [Fact]
    public void AClientMayOnlyReportItsShipAndTheBotsItDrives()
    {
        var room = Campaign(0, true, "a", "b");
        room.Start("a");
        var fighter = Levels.Missions[0].Enemies[0];
        Until(room, fighter.Time);
        room.Report("b", new Report(S: [[0, 5, 5, 5, 0, 0, 0, 0, 1]], H: [[0, fighter.Id, 1]], D: [[0, 40]]));
        Assert.Equal(0, Pilot(room, 0).Score);
        Assert.Equal(100, Pilot(room, 0).Shield);
        Assert.Equal(0, Pilot(room, 0).St[0]);
        var full = Pilot(room, 2).MaxShield;
        room.Report("b", new Report(D: [[2, 10]]));
        Assert.Equal(full, Pilot(room, 2).Shield);
        room.Report("a", new Report(S: [[2, 3, 4, 5, 0, 0, 0, 0, 1]], D: [[2, 10]]));
        Assert.Equal(3, Pilot(room, 2).St[0]);
        Assert.Equal(full - 10, Pilot(room, 2).Shield);
    }

    [Fact]
    public void DamageBudgetStopsImplausibleFire()
    {
        var room = Campaign();
        room.Start("a");
        Until(room, 60);
        var alive = Levels.Missions[0].Enemies.Where(e => Math.Abs(e.Time - 60) < 30).ToArray();
        foreach (var enemy in alive) room.Report("a", Hits(0, enemy.Id, 12));
        Assert.True(room.Snapshot().Kills.Length < alive.Length);
    }

    [Fact]
    public void PilotsLoseLivesRespawnAndTheMissionFailsWhenAllAreOut()
    {
        var room = Campaign();
        room.Start("a");
        Until(room, 10);
        for (var life = 3; life > 0; life--)
        {
            room.Report("a", new Report(D: [[0, 40]]));
            Until(room, room.Time + .5);
            room.Report("a", new Report(D: [[0, 40]]));
            Until(room, room.Time + .5);
            room.Report("a", new Report(D: [[0, 40]]));
            Assert.False(Pilot(room, 0).Alive);
            Assert.Equal(life - 1, Pilot(room, 0).Lives);
            Until(room, room.Time + 5.7);
        }
        Assert.True(Pilot(room, 0).Out);
        Until(room, room.Time + 4);
        Assert.Equal("Finished", room.State);
        Assert.False(room.Result!.Success);
    }

    [Fact]
    public void BotsReturnFromRepairsWithoutLosingLives()
    {
        var room = Campaign();
        room.Start("a");
        Until(room, 10);
        room.Report("a", new Report(D: [[1, 40]]));
        Until(room, room.Time + .5);
        room.Report("a", new Report(D: [[1, 40]]));
        Until(room, room.Time + .5);
        room.Report("a", new Report(D: [[1, 40]]));
        Assert.False(Pilot(room, 1).Alive);
        Until(room, room.Time + 12.2);
        Assert.True(Pilot(room, 1).Alive);
        Assert.Equal(3, Pilot(room, 1).Lives);
    }

    [Fact]
    public void TheBossFallsPhaseByPhaseAndTheMissionEndsAfterTheOutro()
    {
        var room = Campaign();
        room.Start("a");
        var mission = Levels.Missions[0];
        Until(room, mission.BossAt + Levels.BossIntro + .1);
        Assert.Equal("boss", room.Phase);
        var boss = room.Snapshot().Boss!;
        Assert.Equal(0, boss.Phase);
        // The reactor (part 3) cannot be hit in phase 1.
        room.Report("a", Hits(0, -4, 10));
        Assert.Equal(boss.Max[3], room.Snapshot().Boss!.Hp[3]);
        for (var phase = 0; phase < mission.Boss.Phases.Length; phase++)
        {
            foreach (var part in mission.Boss.Phases[phase])
                while (room.Snapshot().Boss!.Hp[part] > 0)
                {
                    room.Report("a", Hits(0, -1 - part, 10));
                    Until(room, room.Time + .2);
                }
            Until(room, room.Time + 2);
        }
        var down = room.Snapshot().Boss!.Down;
        Assert.True(down > 0);
        Assert.Equal("outro", room.Phase);
        Until(room, down + Levels.Outro + .2);
        Assert.Equal("Finished", room.State);
        Assert.True(room.Result!.Success);
        Assert.True(room.Result.Players.Single().Score > 5000);
    }

    [Fact]
    public void BossHealthGrowsWithTheSquadron()
    {
        var solo = new Room("A", GameMode.Campaign, 0, false, 1);
        solo.Join(1, "A", "a", 0);
        solo.Start("a");
        var squad = Campaign(0, true, "a", "b", "c");
        squad.Start("a");
        Until(solo, Levels.Missions[0].BossAt + 1);
        Until(squad, Levels.Missions[0].BossAt + 1);
        Assert.True(squad.Snapshot().Boss!.Max.Sum() > solo.Snapshot().Boss!.Max.Sum());
    }

    [Fact]
    public void PickupsAreTakenOnceAndCarriersDropTheirCargo()
    {
        var room = Campaign(0, true, "a", "b");
        room.Start("a");
        var mission = Levels.Missions[0];
        var ring = mission.Pickups.First(p => p.Kind == "ring");
        Until(room, ring.Time - 1);
        room.Report("a", new Report(D: [[0, 35]]));
        room.Report("a", new Report(P: [[0, ring.Id]]));
        room.Report("b", new Report(P: [[1, ring.Id]]));
        Assert.Equal(95, Pilot(room, 0).Shield);
        Assert.Contains(ring.Id, room.Snapshot().Taken);
        var carrier = mission.Enemies.First(e => e.Drop == "laser");
        var drop = Levels.DropBase + carrier.Id;
        room.Report("a", new Report(P: [[0, drop]]));
        Assert.Equal(1, Pilot(room, 0).Laser);
        Until(room, carrier.Time + 1);
        room.Report("a", Hits(0, carrier.Id, 10));
        room.Report("a", new Report(P: [[0, drop]]));
        Assert.Equal(2, Pilot(room, 0).Laser);
    }

    [Fact]
    public void BombsAreCountedAndAnnounced()
    {
        var room = Campaign();
        room.Start("a");
        Until(room, 8);
        for (var i = 0; i < 5; i++) room.Report("a", new Report(B: [[0, 0, 10, 2, 1, 0, 0]]));
        var frame = room.Snapshot();
        Assert.Equal(0, frame.Pilots.Single(p => p.Slot == 0).Bombs);
        Assert.Equal(3, frame.Events.Count(e => e.K == "bomb"));
    }

    [Fact]
    public void ANewcomerTakesOverABotInARunningCampaign()
    {
        var room = Campaign();
        room.Start("a");
        Until(room, 20);
        Assert.True(room.Open);
        var slot = room.Join(7, "Später", "late", 1);
        Assert.Equal(1, slot);
        var pilot = Pilot(room, 1);
        Assert.False(pilot.Bot);
        Assert.Equal("Später", pilot.Name);
    }

    [Fact]
    public void BattlePopsCoresDeflectsWithRollsAndRamsSteal()
    {
        var room = new Room("ARENA", GameMode.Battle, 0, false, 1);
        room.Join(1, "A", "a", 0);
        room.Join(2, "B", "b", 1);
        room.Start("a");
        Until(room, Levels.Countdown + .1);
        room.Report("a", new Report(S: [[0, 0, 30, 0, 0, 0, 0, 0, 30]]));
        room.Report("b", new Report(S: [[1, 0, 30, 40, 0, 0, 0, 8, 30]]));
        room.Report("a", new Report(V: [[0, 1, 0]]));
        Assert.Equal(3, Pilot(room, 1).Cores);
        room.Report("b", new Report(S: [[1, 0, 30, 5, 0, 0, 0, 0, 30]]));
        room.Report("a", new Report(V: [[0, 1, 3]]));
        Assert.Equal(2, Pilot(room, 1).Cores);
        Assert.Equal(4, Pilot(room, 0).Cores);
        room.Report("a", new Report(V: [[0, 1, 0]]));
        Assert.Equal(2, Pilot(room, 1).Cores);
        for (var i = 0; i < 2; i++)
        {
            Until(room, room.Time + 1.5);
            room.Report("a", new Report(V: [[0, 1, 1]]));
        }
        Assert.True(Pilot(room, 1).Out);
        Until(room, room.Time + .1);
        Assert.Equal("Finished", room.State);
        Assert.Equal([0], room.Result!.Winners);
    }

    [Fact]
    public void CrashesCostNoCoresInTheCoreHunt()
    {
        var room = new Room("ARENA", GameMode.Battle, 0, true, 1);
        room.Join(1, "A", "a", 0);
        room.Start("a");
        Until(room, Levels.Countdown + 1);
        for (var i = 0; i < 5; i++) { room.Report("a", new Report(D: [[0, 40]])); Until(room, room.Time + .5); }
        Assert.True(Pilot(room, 0).Alive);
        Assert.Equal(3, Pilot(room, 0).Cores);
    }

    [Fact]
    public void TimedMatchesRespawnAndEndAfterThreeMinutes()
    {
        var room = new Room("ZEIT", GameMode.Timed, 0, true, 1);
        room.Join(1, "A", "a", 0);
        room.Start("a");
        Until(room, Levels.Countdown + 1);
        room.Report("a", new Report(S: [[0, 0, 30, 0, 0, 0, 0, 0, 30]]));
        room.Report("a", new Report(S: [[1, 0, 30, 20, 0, 0, 0, 0, 30]]));
        for (var i = 0; i < 4; i++)
        {
            room.Report("a", new Report(V: [[0, 1, 0]]));
            Until(room, room.Time + .5);
        }
        Assert.False(Pilot(room, 1).Alive);
        Until(room, room.Time + 3);
        Assert.True(Pilot(room, 1).Alive);
        Until(room, Levels.Countdown + Levels.BattleTime + .1);
        Assert.Equal("Finished", room.State);
        Assert.Equal([0], room.Result!.Winners);
    }

    [Fact]
    public void TheLastHumanLeavingAbortsTheMatch()
    {
        var room = Campaign();
        room.Start("a");
        Until(room, 5);
        room.Leave("a");
        Assert.Equal("Finished", room.State);
        Assert.Null(room.Result!.Success);
    }

    [Fact]
    public void OfflineProgressKeepsBestScoresAndMedals()
    {
        var progress = new LocalProgress(0, [], 0, [], []);
        progress = VectorWingsLocal.Record(progress, new MatchResult(Guid.NewGuid(), GameMode.Campaign, 1, true, true, [], [new Standing(1, 4200, 120)]));
        progress = VectorWingsLocal.Record(progress, new MatchResult(Guid.NewGuid(), GameMode.Campaign, 1, false, false, [], [new Standing(1, 1000, 20)]));
        Assert.Equal(2, progress.Matches);
        Assert.Equal([1], progress.Cleared);
        Assert.Equal([1], progress.Medals);
        Assert.Equal(4200, progress.Best.Single(pair => pair[0] == 1)[1]);
    }
}
