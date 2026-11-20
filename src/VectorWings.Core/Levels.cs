using System.Text.Json;

namespace VectorWings.Core;

public enum GameMode { Campaign, Battle, Timed }

/// <summary>An enemy of a mission: the running number over all waves is its id (the browser numbers them the same way).</summary>
public sealed record EnemySpec(int Id, string Kind, double Time, int Health, int Score, string? Drop);

public sealed record PickupSpec(int Id, string Kind, double Time);

public sealed record BossSpec(string Name, string[] Parts, int[] Health, int[][] Phases);

public sealed record MissionSpec(int Id, string Key, string Name, string Subtitle, double BossAt, int Medal,
    EnemySpec[] Enemies, PickupSpec[] Pickups, BossSpec Boss, string Briefing);

public sealed record ArenaSpec(string Name, string[] Pickups, double Respawn);

/// <summary>A way on the campaign map: from mission (-1 = the home station) to mission, open when the start is cleared ("clear"),
/// its medal is won ("medal", a secret way) or always ("start").</summary>
public sealed record RouteSpec(int From, int To, string Condition);

/// <summary>Levels.json, shared with the browser part: waves, pickups and bosses of the missions and the arena.</summary>
public static class Levels
{
    public const int PickupBase = 5000, DropBase = 6000, DroneBase = 100000;
    public const double Intro = 6, BossIntro = 7, Outro = 9, Countdown = 4, BattleTime = 180;

    private static readonly Lazy<(MissionSpec[] Missions, ArenaSpec Arena, RouteSpec[] Routes)> Data = new(Load);

    public static IReadOnlyList<MissionSpec> Missions => Data.Value.Missions;
    public static ArenaSpec Arena => Data.Value.Arena;
    public static IReadOnlyList<RouteSpec> Routes => Data.Value.Routes;

    /// <summary>The missions a pilot may fly: reached over an open way, or granted by an administrator.</summary>
    public static int[] Unlocked(IEnumerable<int> cleared, IEnumerable<int> medals, IEnumerable<int> granted)
    {
        var done = cleared.ToHashSet();
        var gold = medals.ToHashSet();
        var open = granted.Where(m => m >= 0 && m < Missions.Count).ToHashSet();
        foreach (var route in Routes)
            if (route.Condition == "start" || (route.Condition == "clear" && done.Contains(route.From)) || (route.Condition == "medal" && gold.Contains(route.From)))
                open.Add(route.To);
        return open.Order().ToArray();
    }

    public static string NameOf(int mission) =>
        mission >= 0 && mission < Missions.Count ? Missions[mission].Name : Arena.Name;

    private static (MissionSpec[], ArenaSpec, RouteSpec[]) Load()
    {
        using var stream = typeof(Levels).Assembly.GetManifestResourceStream("VectorWings.Levels")
                           ?? throw new InvalidOperationException("Levels.json is not embedded.");
        using var document = JsonDocument.Parse(stream);
        var root = document.RootElement;
        var kinds = root.GetProperty("kinds").EnumerateObject()
            .ToDictionary(kind => kind.Name, kind => (Health: kind.Value.GetProperty("hp").GetInt32(), Score: kind.Value.GetProperty("score").GetInt32()));
        var missions = new List<MissionSpec>();
        foreach (var mission in root.GetProperty("missions").EnumerateArray())
        {
            var enemies = new List<EnemySpec>();
            foreach (var wave in mission.GetProperty("waves").EnumerateArray())
            {
                var time = wave[0].GetDouble();
                var kind = wave[1].GetString()!;
                var count = wave[3].GetInt32();
                string? drop = null;
                if (wave.GetArrayLength() > 6 && wave[6].TryGetProperty("drop", out var dropValue)) drop = dropValue.GetString();
                for (var i = 0; i < count; i++)
                    enemies.Add(new EnemySpec(enemies.Count, kind, time, kinds[kind].Health, kinds[kind].Score, drop));
            }
            var pickups = mission.GetProperty("pickups").EnumerateArray()
                .Select((pickup, index) => new PickupSpec(PickupBase + index, pickup[1].GetString()!, pickup[0].GetDouble())).ToArray();
            var boss = mission.GetProperty("bossDef");
            var parts = boss.GetProperty("parts").EnumerateArray().ToArray();
            var spec = new BossSpec(mission.GetProperty("boss").GetString()!,
                parts.Select(part => part[0].GetString()!).ToArray(),
                parts.Select(part => part[1].GetInt32()).ToArray(),
                boss.GetProperty("phases").EnumerateArray().Select(phase => phase.EnumerateArray().Select(index => index.GetInt32()).ToArray()).ToArray());
            var briefing = mission.GetProperty("intro")[0][1].GetString() ?? "";
            missions.Add(new MissionSpec(mission.GetProperty("id").GetInt32(), mission.GetProperty("key").GetString()!,
                mission.GetProperty("name").GetString()!, mission.GetProperty("subtitle").GetString()!,
                mission.GetProperty("bossAt").GetDouble(), mission.GetProperty("medal").GetInt32(), enemies.ToArray(), pickups, spec, briefing));
        }
        var arena = root.GetProperty("arena");
        var routes = root.GetProperty("routes").EnumerateArray().Select(r => new RouteSpec(r[0].GetInt32(), r[1].GetInt32(), r[2].GetString()!)).ToArray();
        return (missions.ToArray(), new ArenaSpec(arena.GetProperty("name").GetString()!,
            arena.GetProperty("pickups").EnumerateArray().Select(pickup => pickup[0].GetString()!).ToArray(),
            arena.GetProperty("respawn").GetDouble()), routes);
    }
}

/// <summary>What a client reports about the ships it flies (its own, and the bots when it drives them).</summary>
/// <param name="S">States [slot, x, y, z, yaw, pitch, roll, flags, aux]</param>
/// <param name="H">Hits on enemies, drones and boss parts [slot, id (boss part: -1 - index), damage]</param>
/// <param name="D">Damage taken [slot, amount]</param>
/// <param name="P">Pickups touched [slot, id]</param>
/// <param name="B">Bombs launched [slot, x, y, z, dx, dy, dz]</param>
/// <param name="V">Versus hits [slot, victim, kind (0 laser, 1 bomb, 2 charged shot, 3 ram)]</param>
public sealed record Report(double[][]? S = null, double[][]? H = null, double[][]? D = null, double[][]? P = null, double[][]? B = null, double[][]? V = null);

public sealed record PilotView(int Slot, string Name, bool Bot, bool Ai, bool Connected, int Ship, double[] St, int Shield, int MaxShield,
    int Lives, int Bombs, int Laser, int Cores, int Score, int Hits, bool Alive, bool Out, bool Invuln, string Avatar = "");

/// <summary>The pilot's file: call sign, portrait and starting ship.</summary>
public sealed record PilotProfile(string Callsign, string Avatar, int Ship)
{
    /// <summary>Portraits a pilot can choose (the first four are also the crew that flies the free seats).</summary>
    public static readonly string[] Avatars = ["mira", "brakk", "sola", "pip", "rico", "penny", "bo", "nima"];

    /// <summary>A clean profile: call sign trimmed to 20 printable characters (fallback when empty), a known portrait, ship 0–2.</summary>
    public static PilotProfile Clean(string? callsign, string? avatar, int ship, string fallback)
    {
        var name = new string((callsign ?? "").Where(c => !char.IsControl(c)).ToArray()).Trim();
        if (name.Length > 20) name = name[..20].Trim();
        if (name.Length == 0) name = string.IsNullOrWhiteSpace(fallback) ? "Pilot" : fallback.Trim();
        return new PilotProfile(name, Avatars.Contains(avatar) ? avatar! : Avatars[0], Math.Clamp(ship, 0, 2));
    }
}

public sealed record BossView(int Phase, double Start, int[] Hp, int[] Max, double Down);

public sealed record EventView(int N, double T, string K, int S, double[] A);

public sealed record Frame(string Code, string State, string Mode, int Mission, string Phase, double Time, int Leader, int Driver, int Humans,
    PilotView[] Pilots, double[][] Kills, int[]? Dead, int[][] Hurt, int[] Taken, BossView? Boss, EventView[] Events, bool? Success, int[] Winners);

public sealed record Standing(long AccountId, int Score, int Hits);

public sealed record MatchResult(Guid Token, GameMode Mode, int Mission, bool? Success, bool Medal, int[] Winners, Standing[] Players);
