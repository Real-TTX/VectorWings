namespace VectorWings.Core;

public enum GameMode { Campaign, Cores, Timed }

public sealed record Mission(int Id, string Name, string Briefing, string Boss, string Theme, int Approach);

public static class Missions
{
    public static IReadOnlyList<Mission> Campaign { get; } = Array.AsReadOnly<Mission>(
    [
        new(0, "Flusshafen", "Mira: Die letzte Fähre verlässt den Kai. Haltet den Fluss frei!", "Belagerungsläufer", "river", 68),
        new(1, "Wüstenbahn", "Tavi: Der Personenzug erreicht den Canyon. Wir fliegen vor!", "Schienenkreuzer", "desert", 77),
        new(2, "Orbitalwerft", "Neri: Die Werft räumt ihre Docks. Fliegt durch die Lücke im Konvoi!", "Trägerfregatte", "orbit", 58),
        new(3, "Abendstadt", "Mira: Noch sind Zivilisten unterwegs. Haltet den Evakuierungskorridor offen!", "Fliegende Festung", "city", 83)
    ]);

    public static Mission Arena { get; } = new(-1, "Alter Frachthafen", "Das Hafenbecken ist frei. Position beziehen!", "", "arena", 0);
}

public sealed record PilotInput(float X, float Y, bool Fire, bool Boost, bool Brake, bool Roll);
public sealed record PilotView(int Slot, string Name, bool Connected, bool Bot, float X, float Y, float Z,
    float Yaw, int Shield, int Weapon, int Points, bool Alive, bool Rolling);
public sealed record TargetView(int Id, string Kind, float X, float Y, float Z, int Health);
public sealed record ShotView(int Id, bool Friendly, float X, float Y, float Z, float Dx, float Dz);
public sealed record BossView(string Name, int Health, int Maximum, int Phase, bool Exposed, float X, float Y, float Z);
public sealed record Frame(long Tick, string State, Mission Mission, string Mode, float Distance, int TimeLeft,
    BossView? Boss, PilotView[] Pilots, TargetView[] Targets, ShotView[] Shots, bool? Success, int[] Winners, int Escort,
    int Humans, string Code, int Leader);
public sealed record Standing(long AccountId, int Score);
public sealed record MatchResult(Guid Token, GameMode Mode, int Mission, bool? Success, int[] Winners, Standing[] Players);
