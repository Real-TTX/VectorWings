using MatGame.Sdk;
using VectorWings.Core;

namespace VectorWings.Module;

public sealed record RoomListing(string Code, string Mode, string Mission, int Humans, bool Returning, bool Running);
public sealed record SeatInfo(int Slot, Frame Frame);
public sealed record Transmission(string Connection, int Slot, Frame Frame);

/// <summary>The running rooms of this server and which connection sits where.</summary>
public sealed class RoomRegistry
{
    private readonly object gate = new();
    private readonly Dictionary<string, Room> rooms = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, Room> connections = new(StringComparer.Ordinal);
    private readonly Dictionary<Guid, MatchResult> pending = [];

    public RoomListing[] List(long accountId)
    {
        lock (gate)
            return rooms.Values.Where(room => room.State != "Finished" && (room.Open || room.HasPilot(accountId)))
                .Select(room => Listing(room, accountId)).ToArray();
    }

    private static RoomListing Listing(Room room, long accountId) =>
        new(room.Code, room.Mode.ToString(), room.Mission?.Name ?? Levels.Arena.Name, room.Humans, room.HasPilot(accountId) && room.State == "Playing", room.State == "Playing");

    public SeatInfo Create(GameAccount account, string connection, string mode, int mission, bool bots, int ship)
    {
        if (!Enum.TryParse<GameMode>(mode, out var selection) || selection.ToString() != mode ||
            (selection == GameMode.Campaign && (mission < 0 || mission >= Levels.Missions.Count)))
            throw new InvalidOperationException("Dieser Spielmodus oder diese Mission ist unbekannt.");
        lock (gate)
        {
            if (rooms.Count >= 64) throw new InvalidOperationException("Alle Räume sind belegt.");
            string code;
            do code = Guid.NewGuid().ToString("N")[..6].ToUpperInvariant();
            while (rooms.ContainsKey(code));
            var room = new Room(code, selection, mission, bots, Random.Shared.Next());
            rooms.Add(code, room);
            return Bind(room, account, connection, ship);
        }
    }

    public SeatInfo Join(GameAccount account, string connection, string? code, int ship)
    {
        lock (gate)
        {
            if (string.IsNullOrWhiteSpace(code) || !rooms.TryGetValue(code.Trim(), out var room))
                throw new InvalidOperationException("Diese Partie ist nicht verfügbar.");
            return Bind(room, account, connection, ship);
        }
    }

    private SeatInfo Bind(Room room, GameAccount account, string connection, int ship)
    {
        var old = connections.GetValueOrDefault(connection);
        var slot = room.Join(account.Id, account.Name, connection, ship);
        if (old is not null && old != room) LeaveLocked(connection);
        foreach (var stale in connections.Where(pair => pair.Value == room && room.Seat(pair.Key) < 0).ToArray())
            connections.Remove(stale.Key);
        connections[connection] = room;
        return new SeatInfo(slot, room.Snapshot(true));
    }

    public SeatInfo Ship(string connection, int ship)
    {
        lock (gate)
        {
            var room = connections.GetValueOrDefault(connection) ?? throw new InvalidOperationException("Wähle zuerst eine Lobby.");
            room.ChooseShip(connection, ship);
            return new SeatInfo(room.Seat(connection), room.Snapshot(true));
        }
    }

    public SeatInfo Start(string connection)
    {
        lock (gate)
        {
            var room = connections.GetValueOrDefault(connection) ?? throw new InvalidOperationException("Wähle zuerst eine Lobby.");
            room.Start(connection);
            return new SeatInfo(room.Seat(connection), room.Snapshot(true));
        }
    }

    public void Report(string connection, Report? report)
    {
        lock (gate) connections.GetValueOrDefault(connection)?.Report(connection, report);
    }

    /// <summary>Leaves the room; returns the lobby as it is now for the pilots still waiting in it.</summary>
    public List<Transmission> Leave(string connection)
    {
        lock (gate)
        {
            var room = connections.GetValueOrDefault(connection);
            LeaveLocked(connection);
            if (room is null || room.State != "Lobby" || !rooms.ContainsKey(room.Code)) return [];
            var frame = room.Snapshot(true);
            return connections.Where(pair => pair.Value == room)
                .Select(pair => new Transmission(pair.Key, room.Seat(pair.Key), frame)).Where(t => t.Slot >= 0).ToList();
        }
    }

    private void LeaveLocked(string connection)
    {
        if (!connections.Remove(connection, out var room)) return;
        room.Leave(connection);
        RetireIfFinished(room);
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
            if (rooms.TryGetValue(code, out var room)) room.Abort();
    }

    internal RoomListing[] Inspect()
    {
        lock (gate) return rooms.Values.Select(room => Listing(room, 0)).ToArray();
    }

    public GameStats Stats()
    {
        lock (gate) return new(rooms.Values.Sum(room => room.Humans), rooms.Values.Count(room => room.State == "Playing"));
    }

    /// <summary>Advances every room by one tick and returns the frames to send.</summary>
    internal List<Transmission> Advance()
    {
        lock (gate)
        {
            var messages = new List<Transmission>();
            foreach (var room in rooms.Values.ToArray())
            {
                room.Advance();
                if (room.State != "Lobby")
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

    /// <summary>Lobby changes are pushed right away to everybody in the lobby.</summary>
    internal List<Transmission> Lobby(string connection)
    {
        lock (gate)
        {
            var room = connections.GetValueOrDefault(connection);
            if (room is null || room.State != "Lobby") return [];
            var frame = room.Snapshot(true);
            return connections.Where(pair => pair.Value == room && pair.Key != connection)
                .Select(pair => new Transmission(pair.Key, room.Seat(pair.Key), frame)).Where(t => t.Slot >= 0).ToList();
        }
    }

    private void RetireIfFinished(Room room)
    {
        if (room.State == "Lobby" && room.Humans == 0) { rooms.Remove(room.Code); return; }
        if (room.State != "Finished" || (room.Humans > 0 && rooms.ContainsKey(room.Code))) return;
        Retire(room);
    }

    private void Retire(Room room)
    {
        rooms.Remove(room.Code);
        foreach (var pair in connections.Where(pair => pair.Value == room).ToArray()) connections.Remove(pair.Key);
        if (room.Result is { } result && result.Players.Length > 0 && room.Time > 0) pending[result.Token] = result;
    }

    internal MatchResult[] Results()
    {
        lock (gate) return pending.Values.ToArray();
    }

    internal void Acknowledge(Guid token)
    {
        lock (gate) pending.Remove(token);
    }
}
