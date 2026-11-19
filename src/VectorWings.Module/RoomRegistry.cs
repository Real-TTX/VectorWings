using MatGame.Sdk;
using VectorWings.Core;

namespace VectorWings.Module;

public sealed record RoomListing(string Code, string Mode, string Mission, int Humans, bool Returning);
public sealed record SeatInfo(int Slot, Frame Frame);
internal sealed record Transmission(string Connection, int Slot, Frame Frame);

public sealed class RoomRegistry
{
    private readonly object gate = new();
    private readonly Dictionary<string, Match> rooms = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, Match> connections = new(StringComparer.Ordinal);
    private readonly Dictionary<Guid, MatchResult> pending = [];

    public RoomListing[] List(long accountId)
    {
        lock (gate)
            return rooms.Values.Where(room => room.State == "Lobby" || room.HasPilot(accountId))
                .Select(room => new RoomListing(room.Code, room.Mode.ToString(), room.Mission.Name,
                    room.Humans, room.State == "Playing")).ToArray();
    }

    public SeatInfo Create(GameAccount account, string connection, string mode, int mission, bool bots)
    {
        if (!Enum.TryParse<GameMode>(mode, out var selection) || selection.ToString() != mode ||
            (selection == GameMode.Campaign && (mission < 0 || mission >= Missions.Campaign.Count)))
            throw new InvalidOperationException("Dieser Spielmodus oder diese Mission ist unbekannt.");

        lock (gate)
        {
            if (rooms.Count >= 64) throw new InvalidOperationException("Alle Räume sind belegt.");
            string code;
            do code = Guid.NewGuid().ToString("N")[..6].ToUpperInvariant();
            while (rooms.ContainsKey(code));
            var room = new Match(code, selection, mission, bots, Random.Shared.Next());
            rooms.Add(code, room);
            return Bind(room, account, connection);
        }
    }

    public SeatInfo Join(GameAccount account, string connection, string? code)
    {
        lock (gate)
        {
            if (string.IsNullOrWhiteSpace(code) || !rooms.TryGetValue(code.Trim(), out var room))
                throw new InvalidOperationException("Diese Partie ist nicht verfügbar.");
            return Bind(room, account, connection);
        }
    }

    private SeatInfo Bind(Match room, GameAccount account, string connection)
    {
        var old = connections.GetValueOrDefault(connection);
        var slot = room.Join(account.Id, account.Name, connection);
        if (old is not null && old != room) Leave(connection);
        foreach (var stale in connections.Where(pair => pair.Value == room && room.Seat(pair.Key) < 0).ToArray())
            connections.Remove(stale.Key);
        connections[connection] = room;
        return new SeatInfo(slot, room.Snapshot());
    }

    public SeatInfo Start(string connection)
    {
        lock (gate)
        {
            if (!connections.TryGetValue(connection, out var room))
                throw new InvalidOperationException("Wähle zuerst eine Lobby.");
            room.Start(connection);
            return new SeatInfo(room.Seat(connection), room.Snapshot());
        }
    }

    public void Input(string connection, PilotInput? input)
    {
        lock (gate) connections.GetValueOrDefault(connection)?.SetInput(connection, input);
    }

    public void Leave(string connection)
    {
        lock (gate)
        {
            if (!connections.Remove(connection, out var room)) return;
            room.Leave(connection);
            RetireIfFinished(room);
        }
    }

    public void RemoveAccount(long accountId)
    {
        lock (gate)
        {
            foreach (var room in rooms.Values.ToArray())
            {
                room.RemoveAccount(accountId);
                RetireIfFinished(room);
            }
            foreach (var pair in connections.Where(pair => pair.Value.Seat(pair.Key) < 0).ToArray())
                connections.Remove(pair.Key);
            foreach (var pair in pending.ToArray())
                pending[pair.Key] = pair.Value with { Players = pair.Value.Players.Where(p => p.AccountId != accountId).ToArray() };
        }
    }

    internal void Abort(string code)
    {
        lock (gate)
        {
            if (rooms.TryGetValue(code, out var room)) room.Abort();
        }
    }

    internal RoomListing[] Inspect()
    {
        lock (gate)
            return rooms.Values.Select(room => new RoomListing(room.Code, room.Mode.ToString(), room.Mission.Name,
                room.Humans, room.State == "Playing")).ToArray();
    }

    public GameStats Stats()
    {
        lock (gate)
            return new(rooms.Values.Sum(room => room.Humans), rooms.Values.Count(room => room.State == "Playing"));
    }

    internal List<Transmission> Step(bool publish)
    {
        lock (gate)
        {
            var messages = new List<Transmission>();
            foreach (var room in rooms.Values.ToArray())
            {
                room.Step();
                if (publish || room.State == "Finished")
                {
                    var frame = room.Snapshot();
                    foreach (var (connection, _) in connections.Where(pair => pair.Value == room))
                        if (room.Seat(connection) is var slot && slot >= 0) messages.Add(new(connection, slot, frame));
                }
                if (room.State == "Finished") Retire(room);
            }
            return messages;
        }
    }

    private void RetireIfFinished(Match room)
    {
        if (room.State != "Finished" || (room.Humans > 0 && rooms.ContainsKey(room.Code))) return;
        Retire(room);
    }

    private void Retire(Match room)
    {
        rooms.Remove(room.Code);
        foreach (var pair in connections.Where(pair => pair.Value == room).ToArray()) connections.Remove(pair.Key);
        if (room.Result is { } result && result.Players.Length > 0 && room.Tick > 0) pending[result.Token] = result;
    }

    internal MatchResult[] Results()
    {
        lock (gate)
        {
            return pending.Values.ToArray();
        }
    }

    internal void Acknowledge(Guid token)
    {
        lock (gate) pending.Remove(token);
    }
}
