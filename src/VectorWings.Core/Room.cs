namespace VectorWings.Core;

/// <summary>
/// One match of VectorWings in memory (server and offline app). Every client flies its own ship (the driver also the bots)
/// and reports; the room decides hit points, kills, pickups, shields, lives, boss phases, cores and the result.
/// The enemies themselves are deterministic in the browser (Levels.json), so the room only needs their ids.
/// </summary>
public sealed class Room
{
    public const int TickRate = 20;
    public const double Step = 1.0 / TickRate;
    private static readonly string[] Crew = ["Mira", "Brakk", "Sola", "Pip"];
    private static readonly int[] ShipShield = [100, 85, 130];
    private static readonly int[] ShipBombs = [3, 2, 3];
    private static readonly int[] ShipLaser = [1, 1, 2];

    private readonly List<Pilot> pilots = [];
    private readonly Dictionary<int, int> enemyHealth = [];
    private readonly HashSet<int> dead = [];
    private readonly List<double[]> kills = [];
    private readonly Dictionary<int, double> taken = [];
    private readonly HashSet<int> drops = [];
    private readonly List<EventView> events = [];
    private readonly Guid token = Guid.NewGuid();
    private int eventSeq;
    private long ticks;
    private double? failAt;
    private BossState? boss;
    private int[] winners = [];
    private bool? success;

    public Room(string code, GameMode mode, int mission, bool fillBots, int seed)
    {
        Code = code;
        Mode = mode;
        Mission = mode == GameMode.Campaign ? Levels.Missions[mission] : null;
        FillBots = fillBots;
        _ = seed;
    }

    public string Code { get; }
    public GameMode Mode { get; }
    public MissionSpec? Mission { get; }
    public int MissionId => Mission?.Id ?? -1;
    public bool FillBots { get; }
    public string State { get; private set; } = "Lobby";
    public double Time { get; private set; }
    public MatchResult? Result { get; private set; }
    public int Humans => pilots.Count(p => p.Connection is not null);
    public int Leader => pilots.Where(p => p.Connection is not null).OrderBy(p => p.Slot).FirstOrDefault()?.Slot ?? -1;
    public int Driver => Leader;
    public bool HasPilot(long accountId) => pilots.Any(p => p.AccountId == accountId);
    /// <summary>A running campaign or timed match with a bot seat a newcomer can take over.</summary>
    public bool Open => State == "Lobby" ? pilots.Count < 4 : State == "Playing" && Mode != GameMode.Battle && pilots.Any(p => p.AccountId is null);

    public string Phase
    {
        get
        {
            if (Mission is null) return State == "Finished" ? "done" : Time < Levels.Countdown ? "countdown" : "battle";
            if (boss is { Down: >= 0 }) return "outro";
            if (Time < Levels.Intro) return "intro";
            if (Time < Mission.BossAt) return "stage";
            if (Time < Mission.BossAt + Levels.BossIntro) return "bossIntro";
            return "boss";
        }
    }

    // ─── Seats ──────────────────────────────────────────────────────────────────────

    public int Join(long accountId, string name, string connection, int ship)
    {
        ship = Math.Clamp(ship, 0, ShipShield.Length - 1);
        var pilot = pilots.FirstOrDefault(p => p.AccountId == accountId);
        if (State == "Finished") throw new InvalidOperationException("Diese Partie ist bereits beendet.");
        if (pilot is null)
        {
            if (State == "Lobby")
            {
                if (pilots.Count >= 4) throw new InvalidOperationException("Die Staffel ist voll.");
                var slot = Enumerable.Range(0, 4).First(index => pilots.All(p => p.Slot != index));
                pilot = new Pilot(slot, accountId, name, ship);
                pilots.Add(pilot);
            }
            else
            {
                // Drop-in: a newcomer takes over a bot of a running campaign or timed match.
                pilot = Mode == GameMode.Battle ? null : pilots.Where(p => p.AccountId is null).OrderBy(p => p.Slot).FirstOrDefault();
                if (pilot is null) throw new InvalidOperationException("In dieser Partie ist kein Platz frei.");
                pilot.AccountId = accountId;
                pilot.Name = name;
                pilot.Lives = Math.Max(pilot.Lives, 2);
                Event("join", pilot.Slot);
            }
        }
        pilot.Connection = connection;
        if (State == "Lobby") SetShip(pilot, ship);
        return pilot.Slot;
    }

    public int Seat(string connection) => pilots.FirstOrDefault(p => p.Connection == connection)?.Slot ?? -1;

    public void ChooseShip(string connection, int ship)
    {
        var pilot = pilots.FirstOrDefault(p => p.Connection == connection) ?? throw new InvalidOperationException("Du sitzt in keiner Staffel.");
        if (State != "Lobby") throw new InvalidOperationException("Das Schiff wählt man in der Lobby.");
        SetShip(pilot, ship);
    }

    private static void SetShip(Pilot pilot, int ship)
    {
        pilot.Ship = Math.Clamp(ship, 0, ShipShield.Length - 1);
    }

    public void Leave(string connection)
    {
        var pilot = pilots.FirstOrDefault(p => p.Connection == connection);
        if (pilot is null) return;
        pilot.Connection = null;
        if (State == "Lobby") pilots.Remove(pilot);
        if (Humans == 0 && State != "Finished") Finish(null);
    }

    public void RemoveAccount(long accountId)
    {
        var pilot = pilots.FirstOrDefault(p => p.AccountId == accountId);
        if (pilot is null) return;
        if (pilot.Connection is { } connection) Leave(connection);
        pilot.AccountId = null;
        pilot.Name = "Pilot";
        if (Result is not null)
            Result = Result with { Players = Result.Players.Where(standing => standing.AccountId != accountId).ToArray() };
    }

    public void Start(string connection)
    {
        if (State != "Lobby" || Seat(connection) < 0 || Seat(connection) != Leader)
            throw new InvalidOperationException("Nur der Staffelführer kann starten.");
        if (Mode != GameMode.Campaign && pilots.Count < 2 && !FillBots)
            throw new InvalidOperationException("Ein Duell braucht mindestens zwei Piloten.");
        if (FillBots)
            for (var slot = 0; slot < 4; slot++)
                if (pilots.All(p => p.Slot != slot))
                    pilots.Add(new Pilot(slot, null, Crew[slot], slot % 3));
        pilots.Sort((a, b) => a.Slot.CompareTo(b.Slot));
        foreach (var pilot in pilots) Equip(pilot);
        State = "Playing";
        Time = 0;
    }

    private void Equip(Pilot pilot)
    {
        var battle = Mode != GameMode.Campaign;
        pilot.MaxShield = battle ? 100 : ShipShield[pilot.Ship];
        pilot.Shield = pilot.MaxShield;
        pilot.Bombs = battle ? 1 : ShipBombs[pilot.Ship];
        pilot.Laser = ShipLaser[pilot.Ship];
        pilot.Cores = Mode == GameMode.Battle ? 3 : 0;
        pilot.Lives = 3;
        pilot.Alive = true;
        pilot.InvulnerableUntil = 2;
    }

    public void Abort()
    {
        if (State != "Finished") Finish(null);
    }

    // ─── Reports ────────────────────────────────────────────────────────────────────

    public void Report(string connection, Report? report)
    {
        if (State != "Playing" || report is null) return;
        var seat = Seat(connection);
        if (seat < 0) return;
        var driver = seat == Driver;
        Pilot? Of(double[]? entry)
        {
            if (entry is not { Length: > 0 } || !double.IsFinite(entry[0])) return null;
            var slot = (int)entry[0];
            var pilot = pilots.FirstOrDefault(p => p.Slot == slot);
            if (pilot is null) return null;
            return pilot.Slot == seat || (driver && pilot.Ai) ? pilot : null;
        }
        foreach (var entry in report.S ?? [])
            if (Of(entry) is { } pilot && entry.Length == 9 && entry.All(v => double.IsFinite(v) && Math.Abs(v) < 100000))
                pilot.St = entry[1..];
        foreach (var entry in report.H ?? [])
            if (Of(entry) is { } pilot && entry.Length >= 3) Hit(pilot, (int)entry[1], (int)entry[2]);
        foreach (var entry in report.D ?? [])
            if (Of(entry) is { } pilot && entry.Length >= 2) Damage(pilot, (int)entry[1]);
        foreach (var entry in report.P ?? [])
            if (Of(entry) is { } pilot && entry.Length >= 2) Pickup(pilot, (int)entry[1]);
        foreach (var entry in report.B ?? [])
            if (Of(entry) is { } pilot && entry.Length == 7 && pilot.Alive && pilot.Bombs > 0 && entry.All(double.IsFinite))
            {
                pilot.Bombs--;
                Event("bomb", pilot.Slot, entry[1..]);
            }
        foreach (var entry in report.V ?? [])
            if (Of(entry) is { } pilot && entry.Length >= 3) Versus(pilot, pilots.FirstOrDefault(p => p.Slot == (int)entry[1]), (int)entry[2]);
    }

    private bool Spend(Pilot pilot, int damage)
    {
        // A pilot can deal about 60 points per second (lasers, charged shots and bombs together); more is not plausible.
        pilot.Budget = Math.Min(140, pilot.Budget + (Time - pilot.BudgetAt) * 60);
        pilot.BudgetAt = Time;
        if (pilot.Budget < damage) return false;
        pilot.Budget -= damage;
        return true;
    }

    private void Hit(Pilot pilot, int id, int damage)
    {
        if (Mission is null) return;
        damage = Math.Clamp(damage, 0, 12);
        if (damage == 0 || !Spend(pilot, damage)) return;
        if (id < 0)
        {
            BossHit(pilot, -1 - id, damage);
            return;
        }
        if (id >= Levels.DroneBase)
        {
            if (Phase != "boss" || id > Levels.DroneBase + 100000 || !dead.Add(id)) return;
            Kill(pilot, id, 50, false);
            return;
        }
        if (id >= Mission.Enemies.Length || dead.Contains(id)) return;
        var enemy = Mission.Enemies[id];
        if (Time < enemy.Time - 6 || Time > enemy.Time + 40) return;
        var health = enemyHealth.GetValueOrDefault(id, enemy.Health) - damage;
        enemyHealth[id] = health;
        if (health > 0) return;
        dead.Add(id);
        Kill(pilot, id, enemy.Score, true);
        if (enemy.Drop is not null) drops.Add(Levels.DropBase + id);
    }

    private void Kill(Pilot pilot, int id, int score, bool count)
    {
        enemyHealth.Remove(id);
        kills.Add([id, Math.Round(Time, 3), pilot.Slot]);
        pilot.Score += score;
        if (count) pilot.Hits++;
    }

    private void BossHit(Pilot pilot, int part, int damage)
    {
        if (boss is null || Phase != "boss" || boss.Down >= 0) return;
        var phases = Mission!.Boss.Phases;
        if (boss.Phase >= phases.Length || !phases[boss.Phase].Contains(part) || boss.Health[part] <= 0) return;
        boss.Health[part] = Math.Max(0, boss.Health[part] - damage);
        pilot.Score += 10 * damage;
        if (boss.Health[part] > 0) return;
        pilot.Score += 500;
        pilot.Hits++;
        Event("part", pilot.Slot, [part]);
        if (!phases[boss.Phase].All(index => boss.Health[index] <= 0)) return;
        if (boss.Phase + 1 >= phases.Length)
        {
            boss.Down = Time;
            foreach (var other in pilots.Where(p => p.Alive)) other.Score += 2000;
            pilot.Score += 3000;
            pilot.Hits += 5;
            Event("bossdown", pilot.Slot);
        }
        else
        {
            boss.Phase++;
            boss.Start = Time + 1.5;
            Event("phase", pilot.Slot, [boss.Phase]);
        }
    }

    private void Damage(Pilot pilot, int amount)
    {
        // In the core hunt only cores count: crashes bounce the ship off without damage.
        if (Mode == GameMode.Battle || !pilot.Alive || Time < pilot.InvulnerableUntil || Phase is "intro" or "bossIntro" or "outro" or "countdown") return;
        amount = Math.Clamp(amount, 0, 40);
        pilot.Shield = Math.Max(0, pilot.Shield - amount);
        pilot.InvulnerableUntil = Time + .45;
        if (pilot.Shield == 0) Down(pilot, null);
    }

    private void Down(Pilot pilot, Pilot? by)
    {
        pilot.Alive = false;
        Event("down", pilot.Slot, by is null ? [] : [by.Slot]);
        switch (Mode)
        {
            case GameMode.Campaign when pilot.AccountId is null:
                pilot.RespawnAt = Time + 12;
                break;
            case GameMode.Campaign:
                pilot.Lives--;
                if (pilot.Lives > 0) pilot.RespawnAt = Time + 3;
                else pilot.Out = true;
                break;
            case GameMode.Battle:
                pilot.Out = true;
                break;
            default:
                pilot.RespawnAt = Time + 2.5;
                break;
        }
    }

    private void Pickup(Pilot pilot, int id)
    {
        if (!pilot.Alive) return;
        string? kind;
        if (Mission is not null)
        {
            if (id >= Levels.DropBase && id < Levels.DroneBase)
            {
                if (!drops.Contains(id) || taken.ContainsKey(id)) return;
                kind = Mission.Enemies[id - Levels.DropBase].Drop;
            }
            else
            {
                var index = id - Levels.PickupBase;
                if (index < 0 || index >= Mission.Pickups.Length || taken.ContainsKey(id)) return;
                var spec = Mission.Pickups[index];
                if (Math.Abs(Time - spec.Time) > 8) return;
                kind = spec.Kind;
            }
            if (kind != "gate") taken[id] = Time;
        }
        else
        {
            var index = id - Levels.PickupBase;
            if (index < 0 || index >= Levels.Arena.Pickups.Length) return;
            if (taken.TryGetValue(id, out var at) && Time < at + Levels.Arena.Respawn) return;
            kind = Levels.Arena.Pickups[index];
            taken[id] = Time;
        }
        switch (kind)
        {
            case "ring": pilot.Shield = Math.Min(pilot.MaxShield, pilot.Shield + 30); break;
            case "gold":
                pilot.Shield = Math.Min(pilot.MaxShield, pilot.Shield + 30);
                if (++pilot.Gold % 3 == 0) pilot.Lives = Math.Min(9, pilot.Lives + 1);
                break;
            case "gate":
                if (pilot.Gate) return;
                pilot.Gate = true;
                pilot.Shield = Math.Min(pilot.MaxShield, pilot.Shield + 50);
                break;
            case "bomb": pilot.Bombs = Math.Min(9, pilot.Bombs + 1); break;
            case "laser": pilot.Laser = Math.Min(3, pilot.Laser + 1); break;
            default: return;
        }
        Event("pickup", pilot.Slot, [id]);
    }

    private void Versus(Pilot attacker, Pilot? victim, int kind)
    {
        if (Mode == GameMode.Campaign || victim is null || victim == attacker || !attacker.Alive || !victim.Alive) return;
        if (Phase != "battle" || Time < victim.InvulnerableUntil || kind is < 0 or > 3) return;
        var distance = Math.Sqrt(Math.Pow(attacker.St[0] - victim.St[0], 2) + Math.Pow(attacker.St[1] - victim.St[1], 2) + Math.Pow(attacker.St[2] - victim.St[2], 2));
        if (distance > (kind == 3 ? 10 : 170)) return;
        // A barrel roll (flag 8) deflects lasers.
        if (kind == 0 && ((int)victim.St[6] & 8) != 0) return;
        if (Mode == GameMode.Battle)
        {
            victim.Cores--;
            victim.InvulnerableUntil = Time + 1.4;
            attacker.Score += 100;
            attacker.Hits++;
            if (kind == 3) attacker.Cores = Math.Min(5, attacker.Cores + 1);
            Event("pop", victim.Slot, [attacker.Slot, kind]);
            if (victim.Cores <= 0)
            {
                attacker.Score += 300;
                Down(victim, attacker);
            }
        }
        else
        {
            victim.Shield = Math.Max(0, victim.Shield - kind switch { 0 => 25, 1 => 60, 2 => 50, _ => 30 });
            victim.InvulnerableUntil = Time + .35;
            attacker.Score += 10;
            Event("pop", victim.Slot, [attacker.Slot, kind]);
            if (victim.Shield == 0)
            {
                attacker.Score += 100;
                attacker.Hits++;
                Down(victim, attacker);
            }
        }
    }

    private void Event(string kind, int slot, double[]? data = null) =>
        events.Add(new EventView(++eventSeq, Math.Round(Time, 3), kind, slot, data ?? []));

    // ─── Clock ──────────────────────────────────────────────────────────────────────

    public void Advance()
    {
        if (State != "Playing") return;
        ticks++;
        Time = ticks * Step;
        foreach (var pilot in pilots)
        {
            if (pilot.Alive || pilot.Out || pilot.RespawnAt <= 0 || Time < pilot.RespawnAt) continue;
            pilot.Alive = true;
            pilot.Shield = pilot.MaxShield;
            pilot.InvulnerableUntil = Time + 2.5;
            if (Mission is not null) pilot.Laser = Math.Max(ShipLaser[pilot.Ship], pilot.Laser - 1);
            pilot.RespawnAt = 0;
            Event("respawn", pilot.Slot);
        }
        if (Mission is not null)
        {
            if (boss is null && Time >= Mission.BossAt)
            {
                var humans = pilots.Count(p => p.AccountId is not null);
                var bots = pilots.Count - humans;
                var factor = 1 + .45 * Math.Max(0, humans - 1) + .15 * bots;
                var maximum = Mission.Boss.Health.Select(health => (int)Math.Round(health * factor)).ToArray();
                boss = new BossState { Start = Mission.BossAt + Levels.BossIntro, Health = (int[])maximum.Clone(), Maximum = maximum };
            }
            if (pilots.Where(p => p.AccountId is not null).All(p => p.Out))
            {
                failAt ??= Time;
                if (Time > failAt + 3.5) Finish(false);
            }
            if (boss is { Down: >= 0 } && Time > boss.Down + Levels.Outro) Finish(true);
        }
        else if (Time >= Levels.Countdown)
        {
            var standing = pilots.Where(p => !p.Out).ToArray();
            var humansStanding = standing.Any(p => p.AccountId is not null);
            if ((Mode == GameMode.Battle && (standing.Length <= 1 || !humansStanding)) || Time >= Levels.Countdown + Levels.BattleTime) Finish(true);
        }
        kills.RemoveAll(kill => Time - kill[1] > 3);
        events.RemoveAll(e => Time - e.T > 2);
    }

    private void Finish(bool? completed)
    {
        if (State == "Finished") return;
        success = completed;
        if (completed is not null && Mode == GameMode.Battle)
        {
            var best = pilots.Max(p => p.Out ? -1 : p.Cores);
            winners = pilots.Where(p => (p.Out ? -1 : p.Cores) == best).Select(p => p.Slot).ToArray();
        }
        else if (completed is not null && Mode == GameMode.Timed)
        {
            var best = pilots.Max(p => p.Score);
            winners = pilots.Where(p => p.Score == best).Select(p => p.Slot).ToArray();
        }
        State = "Finished";
        var medal = Mission is not null && completed == true && pilots.Sum(p => p.Hits) >= Mission.Medal;
        Result = new MatchResult(token, Mode, MissionId, success, medal, winners,
            pilots.Where(p => p.AccountId.HasValue).Select(p => new Standing(p.AccountId!.Value, p.Score, p.Hits)).ToArray());
    }

    // ─── Frames ─────────────────────────────────────────────────────────────────────

    public Frame Snapshot(bool full = false)
    {
        var driver = Driver;
        return new Frame(Code, State, Mode.ToString(), MissionId, Phase, Math.Round(Time, 3), Leader, driver, Humans,
            pilots.Select(p => new PilotView(p.Slot, p.Name, p.AccountId is null, p.Ai, p.Connection is not null, p.Ship, p.St,
                p.Shield, p.MaxShield, p.Lives, p.Bombs, p.Laser, p.Cores, p.Score, p.Hits, p.Alive, p.Out, Time < p.InvulnerableUntil)).ToArray(),
            kills.ToArray(),
            full || ticks % 20 == 0 ? dead.ToArray() : null,
            enemyHealth.Select(pair => new[] { pair.Key, pair.Value }).ToArray(),
            taken.Where(pair => Mission is not null || Time < pair.Value + Levels.Arena.Respawn).Select(pair => pair.Key).ToArray(),
            boss is null ? null : new BossView(boss.Phase, boss.Start, (int[])boss.Health.Clone(), boss.Maximum, boss.Down),
            events.ToArray(), success, winners);
    }

    private sealed class BossState
    {
        public int Phase;
        public double Start;
        public int[] Health = [];
        public int[] Maximum = [];
        public double Down = -1;
    }

    private sealed class Pilot(int slot, long? accountId, string name, int ship)
    {
        public int Slot { get; } = slot;
        public long? AccountId { get; set; } = accountId;
        public string Name { get; set; } = name;
        public string? Connection;
        public int Ship = ship;
        public bool Ai => AccountId is null || Connection is null;
        public double[] St = new double[8];
        public int Shield, MaxShield, Lives = 3, Bombs, Laser = 1, Cores, Score, Hits, Gold;
        public bool Alive = true, Out, Gate;
        public double InvulnerableUntil, RespawnAt, Budget = 140, BudgetAt;
    }
}
