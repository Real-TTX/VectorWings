# VectorWings – Protokoll

Hub `/vectorwings/hub` (SignalR, JSON, camelCase), API `/vectorwings/api`. Offline in der App beantwortet `VectorWings.Local` dieselben Aufrufe
mit denselben Formen (`LocalTransport` des MatGame-SDK). Spielprotokoll **3** (`VectorWingsModule.Protocol`), Mindestversion der Apps `0.3.0`.

## API

| Methode | Pfad | Antwort |
|---|---|---|
| GET | `/progress` | `{ matches, missions, bestScore, cleared: int[], best: { "<mission>": score }, medals: int[], pilot: { callsign, avatar, ship } | null, granted: int[], unlocked: int[] }` |
| PUT | `/profile` | Body `{ callsign, avatar, ship }` (Rufname bis 20 Zeichen, Avatar aus `PilotProfile.Avatars`, Schiff 0–2) → wie `/progress` |

## Hub

| Methode | Argumente | Antwort |
|---|---|---|
| `List` | – | `RoomListing[]` `{ code, mode, mission, humans, returning, running }` – Lobbys, eigene laufende Partien, laufende Koop-/Zeitpartien mit Bot-Platz (Drop-in) |
| `Create` | `mode` (`Campaign`·`Battle`·`Timed`), `mission` (0–3), `bots`, `ship` (0–2), `avatar`, `callsign` | `SeatInfo { slot, frame }` – eine Kampagnenmission nur, wenn sie in `unlocked` steht |
| `Join` | `code`, `ship`, `avatar`, `callsign` | `SeatInfo` – in der Lobby ein neuer Platz, in einer laufenden Kampagne/Zeitpartie übernimmt man einen Bot |
| `Ship` | `ship` | `SeatInfo` (nur in der Lobby) |
| `Start` | – | `SeatInfo` (nur der Staffelführer = kleinster verbundener Slot) |
| `Report` | `Report` | – (ohne Antwort, ~20×/s) |
| `Leave` | – | – |

Der Server schickt `Frame` (`SeatInfo`) 20×/s an alle Piloten laufender Partien und sofort an die Lobby, wenn sich dort etwas ändert.

### Report (Client → Raum)

Alle Einträge beginnen mit dem Slot des Schiffs. Ein Client darf sein eigenes Schiff melden und – wenn er der **Fahrer** ist (`frame.driver`) –
alle KI-Schiffe (`pilot.ai`: Bots und getrennte Menschen).

| Feld | Eintrag | Bedeutung |
|---|---|---|
| `s` | `[slot, x, y, z, yaw, pitch, roll, flags, aux]` | Zustand. Kampagne: x/y quer zur Schiene, z = Abstand vor dem Schienenanker, yaw/pitch relativ zur Schiene, aux = Boostanzeige. Arena: Weltkoordinaten, aux = Tempo |
| `h` | `[slot, id, schaden]` | Treffer: Gegner-id, Drohne/Rakete (≥ 100000) oder Bossteil (`-1 - index`) |
| `d` | `[slot, menge]` | erlittener Schaden (Schüsse, Kollisionen) |
| `p` | `[slot, id]` | Pickup berührt (5000+ Level, 6000+id Abwurf eines Frachters) |
| `b` | `[slot, x, y, z, dx, dy, dz]` | Bombe gestartet |
| `v` | `[slot, opfer, art]` | Arena-Treffer: 0 Laser, 1 Bombe, 2 Zielsuchschuss, 3 Rammstoß |

Flags: `1` Feuer · `2` Boost · `4` Bremse · `8` Fassrolle · `16` Looping/Wende · `32` lädt · `64` Neigung · `128` Hyperlaser.

### Frame (Raum → Client)

`{ code, state (Lobby·Playing·Finished), mode, mission, phase, time, leader, driver, humans, pilots[], kills[], dead?, hurt[], taken[], boss?, events[], success?, winners[] }`

- `phase`: Kampagne `intro` (0–6 s) · `stage` · `bossIntro` (7 s ab `bossAt`) · `boss` · `outro` (9 s nach dem Fall); Arena `countdown` (4 s) · `battle` · `done`.
- `pilots[]`: `{ slot, name, bot, ai, connected, ship, st, shield, maxShield, lives, bombs, laser, cores, score, hits, alive, out, invuln, avatar }` (name = Rufname).
- `kills`: `[id, zeit, slot]` der letzten 3 s; `dead`: alle toten ids (jeder 20. Frame und beim Beitritt); `hurt`: `[id, hp]` angeschlagener Gegner.
- `taken`: genommene Pickups (Arena: nur die noch nicht wieder erschienenen).
- `boss`: `{ phase, start, hp[], max[], down }` (`down` = Zeitpunkt des Falls, sonst −1).
- `events` (letzte 2 s, fortlaufendes `n`): `bomb` (a = Start), `pickup`, `part`, `phase`, `bossdown`, `down`, `respawn`, `pop` (a = [Angreifer, art]), `join`.

## Wer entscheidet was

- **Jeder Browser fliegt sein eigenes Schiff** (der Fahrer auch die Bots) und zeigt die anderen 110 ms verzögert interpoliert.
- **Gegner, ihre Bahnen und Feuerzeiten sind deterministisch** (`Levels.json` + `src/client/level.js`): alle Clients berechnen dieselben Posen aus der Raumzeit.
  Ids sind die laufende Nummer über alle Wellen – der Raum nummeriert genauso (`Levels.cs`). Ziel eines gegnerischen Schusses ist ein Slot, den alle gleich wählen;
  ob er trifft, entscheidet der Client, der dieses Schiff fliegt (Fassrolle lenkt ab).
- **Der Raum entscheidet** Lebenspunkte der Gegner (Treffer nur im Zeitfenster der Welle, Schadensbudget ~60/s je Pilot), Abschüsse, Abwürfe, Pickups
  (je Pickup einmal, Leuchtring einmal je Pilot), Schilde, Leben (Mensch 3, Bots reparieren 12 s), Bomben, Laserstufe, Bossphasen (nur die Teile der aktuellen
  Phase sind verwundbar; HP wachsen mit der Staffel), Kerne und Punkte, Ende und Ergebnis.
- Arena: Laser (nicht gegen eine Fassrolle), Bombe, Zielsuchschuss nehmen einen Kern (Kernjagd) bzw. Schild (Treffer auf Zeit); ein Boost-Rammstoß von hinten klaut
  einen Kern (max. 5). Abstandsprüfung über die gemeldeten Zustände. In der Kernjagd kosten Kollisionen nichts.
- Ergebnis: Kampagne erfolgreich 9 s nach dem Fall des Bosses, gescheitert 3,5 s nachdem alle Menschen raus sind; Medaille ab `medal` Treffern der Staffel.
  Kernjagd endet, wenn höchstens einer fliegt (oder kein Mensch mehr) oder nach 180 s; Treffer auf Zeit nach 180 s.

## Offline

`VectorWings.Local` hostet denselben `Room` (Gast + Crew als Bots) und speichert `flight-progress.json` (`matches, cleared, bestScore, best: [[mission, score]], medals`).

## Kampagnenwege

`routes` in Levels.json: `[von, nach, bedingung]` (−1 = Heimatstation). `start` immer offen, `clear` wenn `von` geschafft ist, `medal` (geheimer Weg) mit der Medaille von `von`. Frei sind die Ziele offener Wege plus die vom Administrator freigeschalteten Missionen (`Pilot.Granted`, Admin → VectorWings → Spieler → Bearbeiten). `Levels.Unlocked` rechnet das auf dem Server, der Browser genauso.
