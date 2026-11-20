# VectorWings

Ein Low-Poly-Weltraumshooter im Stil der klassischen Schienen-Shooter: eine **Koop-Kampagne** mit vier Missionen und Bossen für ein bis vier Piloten,
dazu die Allrange-Arena mit **Kernjagd** (jedes Schiff trägt drei Schildkerne – wer zuletzt fliegt, gewinnt) und **Treffer auf Zeit**.
Freie Plätze fliegt die Crew: Mira, Brakk, Sola und Pip.

## Starten

| Betriebsart | Einstieg |
|---|---|
| Eigenständiger VectorWings-Stack | http://localhost:2776/vectorwings/ |
| Gemeinsamer MatGame-Stack | http://localhost:2770/vectorwings/ |
| Administration | `/Admin/VectorWings` im jeweiligen MatGame-Host |
| pgAdmin in Dev und Local | http://localhost:2778/ |
| Windows | VectorWings-App mit MatGame-Serverwahl und Offline-Spiel gegen die Crew |

```powershell
docker compose up -d                                  # Release
docker compose -f compose.dev.yml up -d               # Nightly
docker compose -f compose.local.yml up -d --build     # lokal gebaut (MatGame liegt nebenan)
```

## Spielen

- **Menüs** wie bei einer Konsole: Pfeiltasten/WASD, Gamepad oder Maus; Enter/A wählt, Esc/B geht zurück, T/Y ist die Zusatzaktion (unten stehen immer die passenden Tasten).
- **Kampagne:** Auf der **Sternenroute** (3D-Weltkarte mit vier Inseln) fliegt das eigene Schiff von Feld zu Feld. Jede Mission wird erst frei, wenn die vorige geschafft ist; geschaffte Felder tragen eine Fahne, Medaillen sind golden. Start eröffnet die Lobby, Raumcode teilen, starten. Laufenden Koop-Partien kann man über *Multiplayer* jederzeit beitreten und übernimmt dann einen Crew-Platz.
- **Kernjagd / Treffer auf Zeit:** direkt vom Titelbild, die Lobby füllt freie Plätze mit Bots.
- **Hangar:** drei Schiffe – *Lanze* (ausgewogen), *Sperber* (schnell, lädt schneller), *Bastion* (schwer gepanzert, Doppellaser ab Start).
- Ringe: Silber +30 Schild, Gold +30 und jeder dritte ein Extraleben, der grüne Leuchtring +50. Kapseln: rot = Smart-Bombe, blau = nächste Laserstufe.
- Eine **Medaille** gibt es, wenn die Staffel eine Mission mit genug Treffern abschließt.

| | Tastatur | Gamepad | Touch |
|---|---|---|---|
| Steuern | WASD / Pfeile | linker Stick | Stick |
| Laser (halten = Dauerfeuer) | Leertaste | A | Feuer |
| Zielsuchschuss (halten, loslassen) | F | X | Lock |
| Smart-Bombe (nochmal = zünden) | B | B | Bombe |
| Boost / Bremse | Umschalt / Strg | RB / LB | Boost / Bremse |
| Fassrolle antippen, Neigen halten | Q / E | LT / RT | Rolle |
| Looping (Arena: Wende) | R | Y | Looping |
| Kamera / Pause | C / Esc | Back / Start | II |

## Entwicklung

VectorWings und MatGame liegen als Nachbarverzeichnisse. Der Clientbuild kopiert das MatGame-SDK und bündelt Babylon.js und SignalR in das Spielmodul.

```powershell
npm ci
npm run build
node scripts/serve.mjs            # Vorschau ohne Server: http://localhost:2789/vectorwings/?preview=1&mission=0
dotnet test VectorWings.slnx
dotnet publish src/VectorWings.App -c Release -r win-x64
```

Protokoll und „wer entscheidet was“: [docs/PROTOCOL.md](docs/PROTOCOL.md). Hinweise für die Arbeit am Code: [CLAUDE.md](CLAUDE.md).

Der Workflow baut alle Branches. Aus `main` entstehen Release-Images und der Release-Kanal der Windows-App, aus `dev` Nightly-Images und der Nightly-Kanal.
Mit `MATGAME_DISPATCH_TOKEN` stößt der Workflow danach den Build des gemeinsamen MatGame-Images an.
