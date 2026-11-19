# VectorWings

Ein Low-Poly-Flugshooter mit vier Kampagnenmissionen für ein bis vier Piloten, Bossen, Laser-Upgrades und einer frei befliegbaren Arena. Im Versus stehen **Schildkerne** und **Treffer auf Zeit** zur Auswahl. Bots füllen freie Plätze. Eine laufende Partie bleibt für ihre ursprünglichen Piloten unter **Weiterspielen** verfügbar, solange ein Mensch verbunden ist.

## Starten

| Betriebsart | Einstieg |
|---|---|
| Eigenständiger VectorWings-Stack | http://localhost:2776/vectorwings/ |
| Gemeinsamer MatGame-Stack | http://localhost:2770/vectorwings/ |
| Administration | `/Admin/VectorWings` im jeweiligen MatGame-Host |
| pgAdmin in Dev und Local | http://localhost:2778/ |
| Windows | VectorWings-App mit MatGame-Serverwahl und lokalem Spiel gegen Bots |

```powershell
docker compose up -d
docker compose -f compose.dev.yml up -d
docker compose -f compose.local.yml up -d --build
```

Die drei Befehle wählen den Release-, Nightly- oder lokalen Stack. Der lokale Build erwartet das benachbarte MatGame-Repo mit registriertem VectorWings-Modul. Auf einem Rechner kann jeweils ein Stack Port 2776 belegen. Für pgAdmin verwendet man die im Compose-Stack angegebenen lokalen Zugangsdaten. Der DB-Dienst ist im Stack unter `db:5432` erreichbar.

## Steuerung

- WASD oder Pfeiltasten steuern quer zur Flugroute beziehungsweise drehen in der Arena.
- Leertaste feuert, Umschalt beschleunigt, Strg bremst und Q löst eine Fassrolle aus.
- C, die HUD-Schaltfläche oder Y auf dem Gamepad wechseln zwischen Verfolgerkamera und Cockpit.

## Entwicklung

VectorWings und MatGame liegen als Nachbarverzeichnisse. Der Clientbuild kopiert das MatGame-SDK und bündelt Babylon.js und SignalR in das Spielmodul. Die auslieferbaren Pakete enthalten alle Browserdateien.

```powershell
npm ci
npm run build
dotnet test VectorWings.slnx
dotnet publish src/VectorWings.App -c Release -r win-x64
```

Der Workflow baut alle Branches. Aus `main` entstehen Release-Images und der Release-Kanal der Windows-App. Aus `dev` entstehen Nightly-Images und der Nightly-Kanal. Mit `MATGAME_DISPATCH_TOKEN` stößt der Workflow danach den Build des gemeinsamen MatGame-Images an.
