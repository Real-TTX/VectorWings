namespace VectorWings.Core;

public sealed class Match
{
    public const int StepRate = 30;
    private const float StepSeconds = 1f / StepRate;
    private const int ShieldMaximum = 100;
    private readonly List<Pilot> pilots = [];
    private readonly List<Target> targets = [];
    private readonly List<Shot> shots = [];
    private readonly Guid token = Guid.NewGuid();
    private readonly Random random;
    private int nextId;
    private int escort = 100;
    private int bossHealth;
    private int bossMaximum;
    private long bossStart;
    private bool? success;
    private int[] winners = [];
    private MatchResult? result;

    public Match(string code, GameMode mode, int mission, bool fillBots, int seed)
    {
        Code = code;
        Mode = mode;
        Mission = mode == GameMode.Campaign ? Missions.Campaign[mission] : Missions.Arena;
        FillBots = fillBots;
        random = new Random(seed);
    }

    public string Code { get; }
    public GameMode Mode { get; }
    public Mission Mission { get; }
    public bool FillBots { get; }
    public string State { get; private set; } = "Lobby";
    public long Tick { get; private set; }
    public float Distance { get; private set; }
    public int Humans => pilots.Count(pilot => pilot.Connection is not null);
    public int Leader => pilots.FirstOrDefault(pilot => pilot.Connection is not null)?.Slot ?? -1;
    public bool HasPilot(long accountId) => pilots.Any(pilot => pilot.AccountId == accountId);

    public int Join(long accountId, string name, string connection)
    {
        var pilot = pilots.FirstOrDefault(candidate => candidate.AccountId == accountId);
        if (State == "Finished" || (pilot is null && (State != "Lobby" || pilots.Count == 4)))
            throw new InvalidOperationException("Dieser Platz ist nicht verfügbar.");

        if (pilot is null)
        {
            var slot = Enumerable.Range(0, 4).First(index => pilots.All(candidate => candidate.Slot != index));
            pilot = new Pilot(slot, accountId, name);
            pilots.Add(pilot);
        }

        pilot.Connection = connection;
        pilot.Input = new(0, 0, false, false, false, false);
        return pilot.Slot;
    }

    public int Seat(string connection) => pilots.FirstOrDefault(pilot => pilot.Connection == connection)?.Slot ?? -1;

    public void Leave(string connection)
    {
        var pilot = pilots.FirstOrDefault(candidate => candidate.Connection == connection);
        if (pilot is null) return;
        pilot.Connection = null;
        if (State == "Lobby") pilots.Remove(pilot);
        if (Humans == 0 && State != "Finished") Finish(null);
    }

    public void RemoveAccount(long accountId)
    {
        var pilot = pilots.FirstOrDefault(candidate => candidate.AccountId == accountId);
        if (pilot is null) return;
        if (pilot.Connection is { } connection) Leave(connection);
        pilot.AccountId = null;
        pilot.Name = "Pilot";
        if (result is not null)
            result = result with { Players = result.Players.Where(standing => standing.AccountId != accountId).ToArray() };
    }

    public void Start(string connection)
    {
        if (State != "Lobby" || Seat(connection) < 0 || Seat(connection) != Leader)
            throw new InvalidOperationException("Nur der Staffelchef kann die Lobby starten.");
        if (Mode != GameMode.Campaign && Humans < 2 && !FillBots)
            throw new InvalidOperationException("Versus benötigt mindestens zwei Piloten.");

        if (FillBots)
        {
            for (var slot = 0; slot < 4; slot++)
                if (pilots.All(pilot => pilot.Slot != slot))
                    pilots.Add(new Pilot(slot, null, $"Drohne {slot + 1}"));
        }

        foreach (var pilot in pilots) Spawn(pilot);
        State = "Playing";
    }

    public void SetInput(string connection, PilotInput? input)
    {
        if (State != "Playing" || input is null || !float.IsFinite(input.X) || !float.IsFinite(input.Y)) return;
        var pilot = pilots.FirstOrDefault(candidate => candidate.Connection == connection);
        if (pilot is null) return;
        pilot.Input = input with { X = Math.Clamp(input.X, -1, 1), Y = Math.Clamp(input.Y, -1, 1) };
        pilot.InputTick = Tick;
    }

    public void Abort()
    {
        if (State != "Finished") Finish(null);
    }

    public void Step()
    {
        if (State != "Playing") return;
        Tick++;
        if (Mode == GameMode.Campaign) AdvanceCampaign();
        foreach (var pilot in pilots) Fly(pilot);
        AdvanceTargets();
        AdvanceShots();
        if (Mode == GameMode.Campaign)
        {
            if (pilots.All(pilot => !pilot.Alive) || escort == 0) Finish(false);
            else if (bossMaximum > 0 && bossHealth == 0) Finish(true);
        }
        else if (Mode == GameMode.Cores)
        {
            var survivors = pilots.Where(pilot => pilot.Alive).Select(pilot => pilot.Slot).ToArray();
            if (survivors.Length <= 1) Finish(true, survivors);
        }
        else if (Tick >= 180 * StepRate)
        {
            var best = pilots.Max(pilot => pilot.Points);
            Finish(true, pilots.Where(pilot => pilot.Points == best).Select(pilot => pilot.Slot).ToArray());
        }
    }

    public Frame Snapshot() => new(Tick, State, Mission, Mode.ToString(), Distance,
        Mode == GameMode.Timed ? Math.Max(0, 180 - (int)(Tick / StepRate)) : 0,
        bossMaximum == 0 ? null : new BossView(Mission.Boss, bossHealth, bossMaximum, BossPhase, BossExposed, BossX, BossY, 37),
        pilots.Select(p => new PilotView(p.Slot, p.Name, p.Connection is not null, p.AccountId is null,
            p.X, p.Y, p.Z, p.Yaw, p.Shield, p.Weapon, p.Points, p.Alive, Tick < p.RollUntil)).ToArray(),
        targets.Select(t => new TargetView(t.Id, t.Kind, t.X, t.Y, t.Z, t.Health)).ToArray(),
        shots.Select(s => new ShotView(s.Id, s.Owner is not null, s.X, s.Y, s.Z, s.Dx, s.Dz)).ToArray(),
        success, winners, escort, Humans, Code, Leader);

    public MatchResult? Result => result;

    private void Finish(bool? completed, int[]? winningSlots = null)
    {
        success = completed;
        winners = winningSlots ?? [];
        State = "Finished";
        result = new MatchResult(token, Mode, Mission.Id, success, winners,
            pilots.Where(pilot => pilot.AccountId.HasValue)
                .Select(pilot => new Standing(pilot.AccountId!.Value, pilot.Points)).ToArray());
    }

    private void Spawn(Pilot pilot)
    {
        pilot.Shield = Mode == GameMode.Campaign ? ShieldMaximum : 3;
        pilot.Alive = true;
        pilot.X = Mode == GameMode.Campaign ? (pilot.Slot - 1.5f) * 3 : MathF.Sin(pilot.Slot * MathF.PI / 2) * 28;
        pilot.Z = Mode == GameMode.Campaign ? 0 : MathF.Cos(pilot.Slot * MathF.PI / 2) * 28;
        pilot.Y = 5;
        pilot.Yaw = Mode == GameMode.Campaign ? 0 : MathF.Atan2(-pilot.X, -pilot.Z);
        pilot.InvulnerableUntil = Tick + StepRate;
    }

    private void Fly(Pilot pilot)
    {
        if (!pilot.Alive)
        {
            if (Mode == GameMode.Timed && Tick >= pilot.RespawnAt) Spawn(pilot);
            return;
        }

        var input = pilot.Connection is null ? BotInput(pilot)
            : Tick - pilot.InputTick < StepRate ? pilot.Input : new PilotInput(0, 0, false, false, false, false);
        if (input.Roll && Tick >= pilot.NextRoll)
        {
            pilot.RollUntil = Tick + 17;
            pilot.NextRoll = Tick + 60;
        }

        pilot.Y = Math.Clamp(pilot.Y + input.Y * 11 * StepSeconds, 1.5f, 15);
        var speed = input.Boost ? 22 : input.Brake ? 7 : 13;
        if (Mode == GameMode.Campaign)
        {
            pilot.X = Math.Clamp(pilot.X + input.X * speed * StepSeconds, -15, 15);
            pilot.Z = Math.Clamp(pilot.Z + (input.Boost ? 1 : input.Brake ? -1 : -pilot.Z * .25f) * 8 * StepSeconds, -5, 7);
        }
        else
        {
            pilot.Yaw += input.X * 2.5f * StepSeconds;
            pilot.X = Math.Clamp(pilot.X + MathF.Sin(pilot.Yaw) * speed * StepSeconds, -39, 39);
            pilot.Z = Math.Clamp(pilot.Z + MathF.Cos(pilot.Yaw) * speed * StepSeconds, -39, 39);
        }

        if (!input.Fire || Tick < pilot.NextFire) return;
        pilot.NextFire = Tick + (pilot.Weapon == 3 ? 5 : 8);
        var dx = MathF.Sin(pilot.Yaw);
        var dz = MathF.Cos(pilot.Yaw);
        AddShot(pilot, pilot.X, pilot.Y, pilot.Z, dx, 0, dz);
        if (pilot.Weapon > 1)
            AddShot(pilot, pilot.X + dz * .7f, pilot.Y, pilot.Z - dx * .7f, dx, 0, dz);
    }

    private PilotInput BotInput(Pilot pilot)
    {
        if (Mode == GameMode.Campaign)
        {
            var target = targets.Where(t => t.Kind is "drone" or "turret")
                .OrderBy(t => t.Z).FirstOrDefault(t => t.Z > pilot.Z + 4);
            var x = target?.X ?? (bossMaximum > 0 ? BossX : MathF.Sin(Tick * .016f + pilot.Slot) * 9);
            var y = target?.Y ?? (bossMaximum > 0 ? BossY : 5);
            return new(Math.Clamp((x - pilot.X) / 3, -1, 1), Math.Clamp((y - pilot.Y) / 2, -1, 1),
                true, false, false, Tick % 135 == pilot.Slot * 18);
        }

        var opponent = pilots.Where(other => other != pilot && other.Alive)
            .MinBy(other => VectorLength(other.X - pilot.X, 0, other.Z - pilot.Z));
        if (opponent is null) return new(1, 0, false, false, false, false);
        var angle = MathF.Atan2(opponent.X - pilot.X, opponent.Z - pilot.Z) - pilot.Yaw;
        angle = MathF.Atan2(MathF.Sin(angle), MathF.Cos(angle));
        return new(Math.Clamp(angle * 2, -1, 1), Math.Clamp((opponent.Y - pilot.Y) / 3, -1, 1),
            MathF.Abs(angle) < .2f, false, MathF.Abs(angle) > 1, false);
    }

    private int BossPhase => bossHealth * 3 > bossMaximum * 2 ? 1 : bossHealth * 3 > bossMaximum ? 2 : 3;
    private long BossTick => Tick - bossStart;
    private bool BossExposed => Mission.Id switch
    {
        0 => BossTick % 150 >= 55,
        1 => targets.All(t => t.Kind != "turret"),
        2 => (BossTick / 60) % 3 != 0,
        _ => BossTick % 125 >= 36
    };
    private float BossX => MathF.Sin(BossTick * (.018f + Mission.Id * .003f)) * (Mission.Id == 1 ? 5 : 9);
    private float BossY => Mission.Id == 3 ? 8 + MathF.Sin(BossTick * .04f) * 3 : 6;

    private void AdvanceCampaign()
    {
        if (bossMaximum > 0)
        {
            if (BossTick % (50 - BossPhase * 7) == 0)
            {
                foreach (var pilot in pilots.Where(pilot => pilot.Alive))
                {
                    EnemyShot(BossX, BossY, 37, pilot);
                    if (Mission.Id == 3 || BossPhase == 3) EnemyShot(BossX + 3, BossY + 2, 37, pilot);
                }
            }
            return;
        }

        Distance = Tick * StepSeconds * 12;
        if (Tick >= Mission.Approach * StepRate)
        {
            bossStart = Tick;
            bossHealth = bossMaximum = 65 + Mission.Id * 18 + pilots.Count * 12;
            targets.RemoveAll(target => target.Kind == "drone");
            if (Mission.Id == 1)
            {
                AddTarget("turret", -7, 6, 32, 14);
                AddTarget("turret", 7, 6, 32, 14);
            }
            return;
        }

        if (Tick % (85 - Mission.Id * 7) == 22)
        {
            var center = random.Next(-11, 12);
            AddTarget("drone", center, random.Next(3, 12), 55, 2 + Mission.Id / 2);
            if (Tick % 2 == 0) AddTarget("drone", -center, random.Next(3, 12), 62, 2);
        }
        if (Tick % 300 == 130) AddTarget("upgrade", MathF.Sin(Tick) * 6, 5, 32, 1);
        if (Tick % 360 == 180) AddTarget("obstacle", random.Next(-10, 11), 3, 44, 1);
        if (Tick % 510 == 240) AddTarget("repair", 0, 6, 36, 1);
    }

    private void AdvanceTargets()
    {
        for (var index = targets.Count - 1; index >= 0; index--)
        {
            var target = targets[index];
            if (target.Kind != "turret") target.Z -= (target.Kind == "drone" ? 17 : 12) * StepSeconds;
            if (target.Kind is "drone" or "turret")
            {
                if ((Tick + target.Id * 11) % 124 == 0 && target.Z > 7 &&
                    pilots.Where(pilot => pilot.Alive).MinBy(pilot => MathF.Abs(pilot.X - target.X)) is { } victim)
                    EnemyShot(target.X, target.Y, target.Z, victim);
                if (target.Z < -7 && Mission.Id is 1 or 3) escort = Math.Max(0, escort - 4);
            }

            foreach (var pilot in pilots.Where(p => p.Alive))
            {
                var radius = target.Kind == "obstacle" ? 2.1f : 1.7f;
                if (VectorLength(target.X - pilot.X, target.Y - pilot.Y, target.Z - pilot.Z) >= radius) continue;
                switch (target.Kind)
                {
                    case "upgrade":
                        pilot.Weapon = Math.Min(3, pilot.Weapon + 1);
                        target.Health = 0;
                        break;
                    case "repair":
                        pilot.Shield = Math.Min(ShieldMaximum, pilot.Shield + 35);
                        target.Health = 0;
                        break;
                    default:
                        HitPilot(pilot, null, 18);
                        break;
                }
                if (target.Health == 0) break;
            }

            if (target.Z < -9 || target.Health == 0) targets.RemoveAt(index);
        }
    }

    private void AdvanceShots()
    {
        for (var index = shots.Count - 1; index >= 0; index--)
        {
            var shot = shots[index];
            shot.X += shot.Dx * StepSeconds;
            shot.Y += shot.Dy * StepSeconds;
            shot.Z += shot.Dz * StepSeconds;
            if (--shot.Life == 0 || ShotHit(shot)) shots.RemoveAt(index);
        }
    }

    private bool ShotHit(Shot shot)
    {
        if (Mode != GameMode.Campaign || shot.Owner is null)
        {
            foreach (var pilot in pilots)
            {
                if (pilot == shot.Owner || !pilot.Alive) continue;
                if (VectorLength(shot.X - pilot.X, shot.Y - pilot.Y, shot.Z - pilot.Z) < 1.4f)
                    return HitPilot(pilot, shot.Owner, 11);
            }
            return false;
        }

        var owner = shot.Owner;
        var target = targets.FirstOrDefault(t => t.Health > 0 && t.Kind is ("drone" or "turret") &&
            VectorLength(shot.X - t.X, shot.Y - t.Y, shot.Z - t.Z) < 2);
        if (target is not null)
        {
            target.Health = Math.Max(0, target.Health - (owner.Weapon == 3 ? 2 : 1));
            if (target.Health == 0) owner.Points += 100;
            return true;
        }

        if (bossHealth == 0 || MathF.Abs(shot.Z - 37) > 2 || MathF.Abs(shot.X - BossX) > 4 ||
            MathF.Abs(shot.Y - BossY) > 2.5f) return false;
        if (BossExposed)
        {
            bossHealth = Math.Max(0, bossHealth - (owner.Weapon == 3 ? 2 : 1));
            owner.Points += bossHealth == 0 ? 1020 : 20;
        }
        return true;
    }

    private bool HitPilot(Pilot pilot, Pilot? attacker, int campaignDamage)
    {
        if (Tick < pilot.InvulnerableUntil || Tick < pilot.RollUntil) return false;
        pilot.Shield = Math.Max(0, pilot.Shield - (Mode == GameMode.Campaign ? campaignDamage : 1));
        pilot.InvulnerableUntil = Tick + 25;
        if (attacker is not null) attacker.Points++;
        if (pilot.Shield == 0)
        {
            pilot.Alive = false;
            pilot.RespawnAt = Tick + 2 * StepRate;
        }
        return true;
    }

    private void EnemyShot(float x, float y, float z, Pilot pilot)
    {
        var distance = VectorLength(pilot.X - x, pilot.Y - y, pilot.Z - z);
        if (distance > 0)
            AddShot(null, x, y, z, (pilot.X - x) / distance, (pilot.Y - y) / distance, (pilot.Z - z) / distance);
    }

    private void AddShot(Pilot? owner, float x, float y, float z, float dx, float dy, float dz)
    {
        var speed = owner is null ? 34 : 75;
        shots.Add(new Shot(++nextId, owner, x + dx * 1.6f, y, z + dz * 1.6f, dx * speed, dy * speed, dz * speed,
            Mode == GameMode.Campaign ? 37 : 24));
    }

    private void AddTarget(string kind, float x, float y, float z, int health) =>
        targets.Add(new Target(++nextId, kind, x, y, z, health));

    private static float VectorLength(float x, float y, float z) => MathF.Sqrt(x * x + y * y + z * z);

    private sealed class Pilot(int slot, long? accountId, string name)
    {
        public int Slot { get; } = slot;
        public long? AccountId { get; set; } = accountId;
        public string Name { get; set; } = name;
        public string? Connection;
        public bool Alive = true;
        public float X;
        public float Y;
        public float Z;
        public float Yaw;
        public int Shield = 100;
        public int Weapon = 1;
        public int Points;
        public long InvulnerableUntil;
        public long RespawnAt;
        public long NextFire;
        public long RollUntil;
        public long NextRoll;
        public long InputTick;
        public PilotInput Input = new(0, 0, false, false, false, false);
    }

    private sealed class Target(int id, string kind, float x, float y, float z, int health)
    {
        public int Id { get; } = id;
        public string Kind { get; } = kind;
        public float X { get; } = x;
        public float Y { get; } = y;
        public float Z = z;
        public int Health = health;
    }

    private sealed class Shot(int id, Pilot? owner, float x, float y, float z, float dx, float dy, float dz, int life)
    {
        public int Id { get; } = id;
        public Pilot? Owner { get; } = owner;
        public float X = x;
        public float Y = y;
        public float Z = z;
        public float Dx { get; } = dx;
        public float Dy { get; } = dy;
        public float Dz { get; } = dz;
        public int Life = life;
    }
}
