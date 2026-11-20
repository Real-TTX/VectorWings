// One match on the client: own ship (and the bots when this client drives them), the others as reported by the room,
// the deterministic enemies of the mission, every projectile, the boss, the camera direction and the reports to the room.
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Rail } from '../rail.js';
import { Level, LEVELS, PICKUP_BASE, DROP_BASE, DRONE_BASE, KINDS, hash } from '../level.js';
import { THEMES } from '../worlds/themes.js';
import { createWorld } from '../worlds/index.js';
import { createBoss } from '../bosses/index.js';
import { EnemyViews, PickupViews, ShipView, bombMesh } from '../render/actors.js';
import { TEAM } from '../render/models.js';
import { PilotSim, FLAG } from './pilot.js';
import { Cockpit } from '../render/cockpit.js';
import { Bot } from './bots.js';
import { SLOT_CREW, avatarOf } from '../hud.js';
import { INTRO, BOSS_INTRO, OUTRO, COUNTDOWN, BATTLE_TIME } from '../net/loopback.js';

const BOLT_SPEED = 180, BOLT_LIFE = 1.05, SHOT_LIFE = 6, BOMB_SPEED = 90, BOMB_RADIUS = 24, ARENA_BOMB_RADIUS = 20;
const v1 = new Vector3(), v2 = new Vector3(), v3 = new Vector3();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

/** Shortest distance² from segment ab to point p (all {x,y,z}-like arrays [x,y,z]). */
function segmentDistance2(ax, ay, az, bx, by, bz, px, py, pz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const length = dx * dx + dy * dy + dz * dz;
    let t = length ? ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / length : 0;
    t = clamp(t, 0, 1);
    const x = ax + dx * t - px, y = ay + dy * t - py, z = az + dz * t - pz;
    return x * x + y * y + z * z;
}

export class Game {
    constructor(app, { frame, slot, send }) {
        this.app = app;
        this.stage = app.stage;
        this.hud = app.hud;
        this.audio = app.audio;
        this.input = app.input;
        this.fx = app.fx;
        this.send = send;
        this.slot = slot;
        this.mode = frame.mode;
        this.arena = this.mode !== 'Campaign';
        this.def = this.arena ? null : LEVELS.missions.find(m => m.id === frame.mission);
        this.field = LEVELS.arena;
        const key = this.arena ? 'arena' : this.def.key;
        this.stage.setTheme(THEMES[key]);
        this.rail = new Rail(this.def?.curve ?? [], this.def?.speed ?? 0);
        this.level = this.def ? new Level(this.def) : null;
        this.world = createWorld(key, this.stage, { rail: this.rail, level: this.level, field: this.field });
        this.boss = this.def ? createBoss(key, this.stage, this.def) : null;
        this.enemyViews = new EnemyViews(this.stage);
        this.cockpit = new Cockpit(this.stage, slot);
        this.pickupViews = new PickupViews(this.stage);
        this.pilots = new Map();
        this.bolts = [];
        this.shots = [];
        this.missiles = [];
        this.bombs = [];
        this.dead = new Set();
        this.predicted = new Map();
        this.predictedDead = new Set();
        this.roomHp = new Map();
        this.taken = new Set();
        this.predictedTaken = new Map();
        this.drops = [];
        this.eventSeq = 0;
        this.t = frame.time;
        this.tPrev = frame.time;
        this.serverT = frame.time;
        this.serverAt = performance.now();
        this.report = this.emptyReport();
        this.reportAt = 0;
        this.cameraMode = localStorage.getItem('vectorwings.camera') === 'cockpit' ? 'cockpit' : 'chase';
        this.cam = { eye: new Vector3(), look: new Vector3(), roll: 0, init: false };
        this.radioDone = new Set();
        this.shake = 0;
        this.ramCooldown = 0;
        this.lastPhase = '';
        this.lockTarget = null;
        this.finished = false;
        this.bombMeshes = [];
        this.time0 = performance.now();
        if (this.world.prewarm) this.world.prewarm(this.anchor(this.t));
        else for (let i = 0; i < 40; i++) this.world.update(this.anchor(this.t) - 20);
        this.applyFrame(frame);
        this.hud.show(true, this.mode);
        if (this.def && this.t < INTRO) {
            this.hud.card('MISSION ' + (this.def.id + 1), this.def.name.toUpperCase() + ' · ' + this.def.subtitle, 'mission', 4.5);
            for (const [speaker, text] of this.def.intro) this.hud.comm(speaker, text);
        }
        this.audio.music(this.arena ? 'arena' : 'stage', key);
    }

    emptyReport() { return { s: [], h: [], d: [], p: [], b: [], v: [] }; }

    /** Rail anchor at time t (the point the formation flies over). */
    anchor(t) { return this.rail.speed * t; }

    // ─── Room frames ────────────────────────────────────────────────────────────────

    applyFrame(frame) {
        this.frame = frame;
        this.serverT = frame.time;
        this.serverAt = performance.now();
        this.driver = frame.driver === this.slot;
        for (const info of frame.pilots) {
            let p = this.pilots.get(info.slot);
            if (!p) {
                p = { slot: info.slot, info, view: new ShipView(this.stage, info.ship, info.slot, { shadow: !this.def || this.def.key !== 'orbit' }),
                    sim: null, bot: null, buffer: [], cur: null, alive: info.alive, fireCd: 0, lastSt: null, invulnUntil: 0 };
                this.pilots.set(info.slot, p);
                if (this.mode === 'Battle') p.view.setCores(info.cores);
            }
            p.info = info;
            const local = info.slot === this.slot || ((info.ai ?? info.bot) && this.driver);
            if (local && !p.sim) {
                p.sim = new PilotSim(info.slot, info.ship, { arena: this.arena, bounds: this.def?.bounds, field: this.field });
                if (this.arena) {
                    const [x, y, z] = this.field.spawns[info.slot % 4];
                    p.sim.placeArena(x, y, z, Math.atan2(-x, -z));
                }
                const known = p.cur ?? (info.st?.some(v => v !== 0) ? info.st : null);
                if (known && this.phase !== 'intro' && this.t > 1) this.adoptState(p.sim, known);
                if (info.slot !== this.slot) p.bot = new Bot(info.slot);
            } else if (!local && p.sim) {
                p.sim = null; p.bot = null;
            }
            if (!local) {
                const st = info.st;
                if (st && (!p.lastSt || st.some((v, i) => v !== p.lastSt[i]))) {
                    p.buffer.push({ at: performance.now(), st: [...st] });
                    if (p.buffer.length > 12) p.buffer.shift();
                    p.lastSt = st;
                }
            }
            if (this.mode === 'Battle' && p.view.cores.length !== Math.max(0, info.cores)) {
                if (p.view.cores.length > info.cores && p.cur) this.fx.burst(this.worldOf(p.cur), 18, TEAM[p.slot], 22);
                p.view.setCores(Math.max(0, info.cores));
            }
            if (p.alive && !info.alive) this.pilotDown(p);
            if (!p.alive && info.alive) this.pilotRespawn(p);
            p.alive = info.alive;
        }
        for (const [id, t, slot] of frame.kills ?? []) this.confirmKill(id, t, slot);
        if (frame.dead) for (const id of frame.dead) if (!this.dead.has(id)) this.confirmKill(id, null, -1);
        this.roomHp = new Map(frame.hurt ?? []);
        this.taken = new Set(frame.taken ?? []);
        for (const event of frame.events ?? []) if (event.n > this.eventSeq) { this.eventSeq = event.n; this.onEvent(event); }
        if (frame.state === 'Finished' && !this.finished) this.finish(frame);
    }

    adoptState(sim, st) {
        if (this.arena) sim.placeArena(st[0], st[1], st[2], st[3]);
        else { sim.x = st[0]; sim.y = st[1]; sim.d = st[2]; }
    }

    confirmKill(id, t, slot) {
        if (this.dead.has(id)) return;
        this.dead.add(id);
        const missile = this.missiles.find(m => m.id === id);
        if (missile) { if (!missile.exploded) this.fx.explode(this.railWorld(missile.d, missile.x, missile.y, v1).clone(), .5); this.missiles.splice(this.missiles.indexOf(missile), 1); return; }
        const e = this.level?.byId.get(id);
        if (!e) return;
        if (!this.predictedDead.has(id)) {
            const pose = this.level.pose(e, this.t, this.anchor(this.t));
            if (pose) this.explodeEnemy(e, pose, false);
        }
        if (e.opt?.drop && t !== null) {
            const pose = this.level.pose(e, t, this.anchor(t)) ?? { s: this.anchor(t) + 60, x: e.x, y: e.y };
            this.drops.push({ id: DROP_BASE + id, kind: e.opt.drop, s: pose.s, x: pose.x, y: Math.max(4, pose.y) });
        }
        void slot;
    }

    onEvent(event) {
        const p = this.pilots.get(event.s);
        switch (event.k) {
            case 'bomb':
                if (event.s !== this.slot && !(p?.sim)) this.launchBomb(event.s, event.a, false);
                break;
            case 'pickup':
                if (event.s === this.slot) this.audio.play('pickup');
                break;
            case 'part': {
                const part = this.boss?.parts[event.a[0]];
                if (part) {
                    this.fx.explode(part.pos.clone(), 2.4, Vector3.ZeroReadOnly, '#444a56');
                    this.audio.play('explodeBig');
                    this.stage.shake = Math.max(this.stage.shake, 1.2);
                    this.hud.comm(['brakk', 'sola', 'pip'][event.a[0] % 3], ['Treffer! Ein Teil ist weg!', 'Das hat gesessen!', 'Weiter so, er wird schwächer!'][event.a[0] % 3]);
                }
                break;
            }
            case 'phase':
                this.audio.play('warning');
                this.hud.comm('pip', this.phaseLine(event.a[0]), true);
                break;
            case 'bossdown':
                this.bossDown();
                break;
            case 'pop':
                if (event.s === this.slot) { this.hud.damage(1); this.audio.play('pop'); this.stage.shake = Math.max(this.stage.shake, .8); }
                if (event.a[0] === this.slot) { this.audio.play('kill'); const victim = this.pilots.get(event.s); if (victim?.cur) this.popupAt(this.worldOf(victim.cur), this.mode === 'Battle' ? 'KERN!' : 'TREFFER', '#7dffb0'); }
                break;
            default:
        }
    }

    phaseLine(phase) {
        const lines = {
            river: ['', 'Die Bugkanonen sind hin – jetzt öffnet er den Raketenschacht!', 'Der Reaktor liegt frei! Alles drauf!'],
            desert: ['', 'Panzerung durchbrochen! Zielt auf den Bohrkopf!', 'Der Glutkern! Jetzt oder nie!'],
            orbit: ['', 'Geschütze aus! Das Hangartor öffnet sich!', 'Der Brückenkern ist offen – Feuer frei!'],
            city: ['', 'Arme ab! Das Augenschild glüht – zerschießt es!', 'Das Kernauge! Zielt genau in die Mitte!']
        };
        return lines[this.def?.key]?.[phase] ?? 'Nächste Phase!';
    }

    pilotDown(p) {
        const position = p.cur ? this.worldOf(p.cur) : null;
        if (position) {
            this.fx.explode(position, 1.6, Vector3.ZeroReadOnly, TEAM[p.slot]);
            this.audio.play('explodeBig');
        }
        p.view.setVisible(false);
        if (p.slot === this.slot) {
            this.stage.shake = 2;
            this.stage.flash = .4;
            if (!this.arena && p.info.lives <= 1 && !p.info.bot) this.hud.comm('mira', 'Wir haben dich verloren! Halt durch, wir schaffen das!', true);
        } else if (!this.arena && p.info.bot) {
            this.hud.comm(SLOT_CREW[p.slot], 'Ich bin getroffen! Muss zur Reparatur!', true);
        }
    }

    pilotRespawn(p) {
        p.view.setVisible(true);
        p.invulnUntil = this.t + 2.5;
        if (p.sim) {
            if (this.arena) {
                const [x, y, z] = this.field.spawns[p.slot % 4];
                p.sim.reset(x, y, z);
            } else p.sim.reset([0, -10, 10, 0][p.slot % 4], [10, 9, 8, 16][p.slot % 4], p.slot === this.slot ? 0 : 5);
        }
        if (p.slot === this.slot) this.audio.play('respawn');
    }

    // ─── Main loop ──────────────────────────────────────────────────────────────────

    tick(dt) {
        if (this.disposed) return;
        dt = Math.min(dt, .05);
        const now = performance.now();
        if (!this.finished) {
            const estimate = this.serverT + Math.min(.35, (now - this.serverAt) / 1000);
            this.t += dt;
            const error = estimate - this.t;
            if (Math.abs(error) > .75) this.t = estimate;
            else this.t += error * Math.min(1, dt * 3);
        }
        const t = this.t;
        this.phase = this.computePhase(t);
        if (this.phase !== this.lastPhase) this.enterPhase(this.phase, this.lastPhase);
        this.lastPhase = this.phase;
        const sRail = this.anchor(t);
        this.fx.beginProjectiles();
        const own = this.pilots.get(this.slot);
        const input = this.input.sample(dt);
        if (input.camera) this.toggleCamera();
        if (input.pause) this.app.pause?.(true);
        this.updateEnemies(t, sRail);
        this.updatePilots(dt, t, sRail, input);
        if (this.boss) this.updateBoss(t, sRail, dt);
        this.updateMissiles(dt, t, sRail);
        this.updateShots(dt, t, sRail);
        this.updateBolts(dt, t, sRail);
        this.updateBombs(dt, t, sRail);
        this.updatePickups(t, sRail);
        if (!this.arena) this.radio(t);
        this.updateCamera(dt, t, sRail, own);
        this.world.update(this.arena ? 0 : this.cam.eye.z, t);
        this.fx.endProjectiles();
        this.updateHud(t, own);
        this.flushReport(now);
        this.tPrev = t;
    }

    computePhase(t) {
        const f = this.frame;
        if (this.arena) return f.state === 'Finished' ? 'done' : t < COUNTDOWN ? 'countdown' : 'battle';
        if (f.boss?.down >= 0) return 'outro';
        if (t < INTRO) return 'intro';
        if (t < this.def.bossAt) return 'stage';
        if (t < this.def.bossAt + BOSS_INTRO) return 'bossIntro';
        return 'boss';
    }

    enterPhase(phase, previous) {
        if (phase === 'bossIntro') {
            this.hud.letterbox(true);
            this.hud.card('WARNUNG', 'Großes Ziel nähert sich', 'warning', 2.6);
            this.audio.play('alarm');
            this.audio.music('boss', this.def.key);
            setTimeout(() => !this.disposed && this.hud.card(this.def.boss.toUpperCase(), 'Boss · ' + this.def.name, 'boss', 3.2), 2900);
            this.shots.length = 0;
            this.enemyViews.hideAll();
        } else if (phase === 'boss' && previous === 'bossIntro') {
            this.hud.letterbox(false);
            this.hud.comm('mira', 'Alle Staffeln: Angriff! Zielt auf die leuchtenden Teile!', true);
        } else if (phase === 'stage' && previous === 'intro') {
            this.hud.comm('mira', 'Waffen frei!');
            if (!localStorage.getItem('vectorwings.cockpitHint')) { localStorage.setItem('vectorwings.cockpitHint', '1'); this.hud.comm('pip', 'Tipp: Mit C oder der Back-Taste wechselst du ins Cockpit.'); }
        } else if (phase === 'countdown') {
            this.hud.card('KERNJAGD', this.mode === 'Battle' ? 'Drei Kerne. Wer zuletzt fliegt, gewinnt.' : 'Drei Minuten. Jeder Treffer zählt.', 'mission', 3);
        } else if (phase === 'battle' && previous === 'countdown') {
            this.hud.card('LOS!', '', 'count', 1);
            this.audio.play('go');
        }
    }

    toggleCamera() {
        this.cameraMode = this.cameraMode === 'chase' ? 'cockpit' : 'chase';
        localStorage.setItem('vectorwings.camera', this.cameraMode);
    }

    // ─── Pilots ─────────────────────────────────────────────────────────────────────

    controllable() {
        return this.arena ? this.phase === 'battle' : this.phase === 'stage' || this.phase === 'boss';
    }

    updatePilots(dt, t, sRail, input) {
        const canControl = this.controllable();
        const enemyList = this.activeEnemies;
        for (const p of this.pilots.values()) {
            if (p.sim) {
                const sim = p.sim;
                let control;
                if (p.slot === this.slot) control = input;
                else control = this.arena
                    ? p.bot.arena(dt, sim, { rivals: this.rivalsOf(p), t, threatened: false, bombs: p.info.bombs })
                    : p.bot.rail(dt, sim, { enemies: enemyList, t, boss: this.phase === 'boss' ? this.boss?.rail : null, threat: this.shots.some(s => s.target === p.slot && s.d < 30) });
                sim.controlled = canControl && p.alive;
                if (!this.arena && !canControl) this.autopilot(sim, p, t, dt);
                const frozen = this.arena && this.phase === 'countdown';
                const actions = frozen ? {} : sim.update(dt, control, { canFire: canControl && p.alive });
                if (p.alive) this.pilotActions(p, actions, t, sRail);
                p.cur = sim.state(p.info.laser);
                if (p.slot === this.slot && actions.rolled) this.audio.play('roll');
                if (p.slot === this.slot && actions.looped) this.audio.play('loop');
                if (p.alive && canControl) this.collidePilot(p, t, sRail, dt);
                this.report.s.push([p.slot, ...p.cur]);
            } else {
                p.cur = this.interpolate(p);
                if (p.cur && p.alive && (p.cur[6] & FLAG.FIRE)) {
                    p.fireCd -= dt;
                    if (p.fireCd <= 0) { p.fireCd = .13; this.cosmeticBolt(p, sRail); }
                }
            }
            if (!p.cur) continue;
            this.placeView(p, t, sRail);
        }
    }

    autopilot(sim, p, t, dt) {
        // Intro / boss intro / outro: the formation flies itself.
        const formation = [[0, 10, 0], [-11, 8, 8], [11, 7, 7], [5, 13, 18]][p.slot % 4];
        if (this.phase === 'outro') {
            const since = t - (this.frame.boss?.down ?? t);
            const away = since > 5 ? (since - 5) * 22 : 0;
            sim.d += ((formation[2] + away) - sim.d) * Math.min(1, dt * 2);
        } else sim.d += (formation[2] - sim.d) * Math.min(1, dt * 1.5);
        sim.x += (formation[0] - sim.x) * Math.min(1, dt * 1.2);
        sim.y += (formation[1] - sim.y) * Math.min(1, dt * 1.2);
        sim.vx = sim.vy = 0;
    }

    rivalsOf(p) {
        const list = [];
        for (const other of this.pilots.values()) {
            if (other === p || !other.alive || !other.cur) continue;
            const prev = other.prevCur ?? other.cur;
            list.push({ slot: other.slot, x: other.cur[0], y: other.cur[1], z: other.cur[2], vx: (other.cur[0] - prev[0]) * 60, vy: (other.cur[1] - prev[1]) * 60, vz: (other.cur[2] - prev[2]) * 60 });
        }
        return list;
    }

    interpolate(p) {
        const buffer = p.buffer;
        if (!buffer.length) return p.info.st?.length ? p.info.st : null;
        const renderAt = performance.now() - 110;
        let a = buffer[0], b = buffer[buffer.length - 1];
        for (let i = 0; i < buffer.length - 1; i++) {
            if (buffer[i].at <= renderAt && buffer[i + 1].at >= renderAt) { a = buffer[i]; b = buffer[i + 1]; break; }
        }
        if (renderAt >= b.at) return b.st;
        const u = clamp((renderAt - a.at) / Math.max(1, b.at - a.at), 0, 1);
        const out = a.st.map((v, i) => i >= 3 && i <= 5 ? lerpAngle(v, b.st[i], u) : v + (b.st[i] - v) * u);
        out[6] = b.st[6];
        return out;
    }

    /** World position of a state array. */
    worldOf(st, out = new Vector3()) {
        if (this.arena) return out.set(st[0], st[1], st[2]);
        return this.rail.toWorld(this.anchor(this.t) + st[2], st[0], st[1], out);
    }

    railWorld(d, x, y, out = new Vector3()) {
        return this.rail.toWorld(this.anchor(this.t) + d, x, y, out);
    }

    placeView(p, t, sRail) {
        const st = p.cur;
        p.prevCur = p.lastCur;
        p.lastCur = st;
        const position = this.worldOf(st, v1);
        let yaw = st[3];
        if (!this.arena) yaw += this.rail.heading(sRail + st[2]);
        const ground = this.world.groundY ? this.world.groundY(position) : (this.def?.key === 'orbit' ? null : 0);
        p.view.place(position, yaw, st[4], st[5], ground, st[6] & FLAG.BOOST ? 1 : 0);
        const invuln = (p.info.invuln || t < p.invulnUntil) && p.alive;
        p.view.blink(!invuln || Math.floor(t * 14) % 2 === 0);
        if (p.slot === this.slot) p.view.setVisible(p.alive && this.cameraMode !== 'cockpit' || (p.alive && !this.controllable()));
    }

    pilotActions(p, actions, t, sRail) {
        const sim = p.sim;
        const own = p.slot === this.slot;
        if (actions.fire) this.fireLaser(p, sRail, own);
        if (actions.chargedShot) this.fireCharged(p, sRail, own);
        const flying = actions.bomb && this.bombs.find(b => b.slot === p.slot && b.local && b.age > .2);
        if (flying) flying.detonateNow = true;
        else if (actions.bomb) {
            const aim = sim.aim();
            const a = this.arena ? [sim.px, sim.py, sim.pz, aim.x, aim.y, aim.z] : [sim.x, sim.y - .4, sim.d + 2, aim.s, aim.x, aim.y];
            if (p.info.bombs - (p.pendingBombs ?? 0) > 0) {
                p.pendingBombs = (p.pendingBombs ?? 0) + 1;
                setTimeout(() => { p.pendingBombs = Math.max(0, (p.pendingBombs ?? 1) - 1); }, 600);
                this.report.b.push([p.slot, ...a.map(n => Math.round(n * 100) / 100)]);
                this.launchBomb(p.slot, a, true);
            } else if (own) this.audio.play('empty');
        }
        if (own && sim.charged && !this.arena) this.lockTarget = this.findLock(sim, sRail);
        else if (own && sim.charged && this.arena) this.lockTarget = this.findArenaLock(sim);
        else if (own) this.lockTarget = null;
        if (own && sim.charging && !p.wasCharging) this.audio.play('charge');
        if (own && sim.charged && !p.wasCharged) this.audio.play('charged');
        p.wasCharging = sim.charging;
        p.wasCharged = sim.charged;
    }

    fireLaser(p, sRail, own) {
        const sim = p.sim, laser = p.info.laser;
        const aim = sim.aim();
        const color = laser >= 3 ? '#7fd8ff' : TEAM[p.slot];
        const twin = laser >= 2;
        const offsets = twin ? [-.7, .7] : [sim.muzzle ? .7 : -.7];
        for (const offset of offsets) {
            if (this.arena) {
                const c = Math.cos(sim.heading), s = Math.sin(sim.heading);
                this.bolts.push({ arena: true, x: sim.px + c * offset + aim.x * 2.5, y: sim.py - .2 + aim.y * 2.5, z: sim.pz - s * offset + aim.z * 2.5,
                    vx: aim.x * BOLT_SPEED + Math.sin(sim.heading) * sim.speed, vy: aim.y * BOLT_SPEED, vz: aim.z * BOLT_SPEED + Math.cos(sim.heading) * sim.speed,
                    life: BOLT_LIFE * .9, owner: p.slot, local: true, dmg: laser >= 3 ? 2 : 1, color, width: laser >= 3 ? 1.6 : 1 });
            } else {
                this.bolts.push({ d: sim.d + 2.4, x: sim.x + offset, y: sim.y - .15, vd: aim.s * BOLT_SPEED, vx: aim.x * BOLT_SPEED, vy: aim.y * BOLT_SPEED,
                    life: BOLT_LIFE, owner: p.slot, local: true, dmg: laser >= 3 ? 2 : 1, color, width: laser >= 3 ? 1.6 : 1 });
            }
        }
        if (own) this.audio.play(laser >= 3 ? 'hyper' : twin ? 'twin' : 'laser');
    }

    cosmeticBolt(p, sRail) {
        const st = p.cur;
        const color = (st[6] & FLAG.HYPER) ? '#7fd8ff' : TEAM[p.slot];
        if (this.arena) {
            const heading = st[3], pitch = -st[4];
            const dir = { x: Math.sin(heading) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(heading) * Math.cos(pitch) };
            this.bolts.push({ arena: true, x: st[0] + dir.x * 2.5, y: st[1] + dir.y * 2.5, z: st[2] + dir.z * 2.5, vx: dir.x * (BOLT_SPEED + st[7]), vy: dir.y * BOLT_SPEED, vz: dir.z * (BOLT_SPEED + st[7]),
                life: BOLT_LIFE * .9, owner: p.slot, local: false, dmg: 0, color, width: 1 });
        } else {
            const yaw = st[3], up = -st[4];
            this.bolts.push({ d: st[2] + 2.4, x: st[0], y: st[1], vd: Math.cos(yaw) * Math.cos(up) * BOLT_SPEED, vx: Math.sin(yaw) * BOLT_SPEED, vy: Math.sin(up) * BOLT_SPEED,
                life: BOLT_LIFE, owner: p.slot, local: false, dmg: 0, color, width: 1 });
        }
        void sRail;
    }

    fireCharged(p, sRail, own) {
        const sim = p.sim;
        const aim = sim.aim();
        const lock = own ? this.lockTarget : (this.arena ? this.findArenaLock(sim, p) : this.findLock(sim, sRail));
        if (this.arena) {
            this.bolts.push({ arena: true, charged: true, x: sim.px + aim.x * 3, y: sim.py + aim.y * 3, z: sim.pz + aim.z * 3, vx: aim.x * 120, vy: aim.y * 120, vz: aim.z * 120,
                life: 2.2, owner: p.slot, local: true, dmg: 0, color: '#9dff6a', width: 1, lock });
        } else {
            this.bolts.push({ charged: true, d: sim.d + 3, x: sim.x, y: sim.y, vd: aim.s * 125, vx: aim.x * 125, vy: aim.y * 125,
                life: 2.2, owner: p.slot, local: true, dmg: 4, color: '#9dff6a', width: 1, lock });
        }
        if (own) this.audio.play('chargeShot');
    }

    findLock(sim, sRail) {
        const aim = sim.aim();
        let best = null, bestAngle = .16;
        for (const e of this.activeEnemies) {
            const dd = e.d - sim.d, dx = e.x - sim.x, dy = e.y + e.e.centerY - sim.y;
            if (dd < 10 || dd > 230) continue;
            const length = Math.hypot(dd, dx, dy);
            const angle = Math.acos(clamp((dd * aim.s + dx * aim.x + dy * aim.y) / length, -1, 1));
            if (angle < bestAngle) { bestAngle = angle; best = { type: 'enemy', id: e.id }; }
        }
        if (!best && this.boss && this.phase === 'boss') {
            for (const part of this.boss.parts) {
                if (!part?.active) continue;
                const r = this.rail.fromWorld(part.pos);
                const dd = r.s - sRail - sim.d, dx = r.x - sim.x, dy = r.y - sim.y;
                const length = Math.hypot(dd, dx, dy);
                const angle = Math.acos(clamp((dd * aim.s + dx * aim.x + dy * aim.y) / length, -1, 1));
                if (angle < .45) { best = { type: 'part', index: part.index }; break; }
            }
        }
        return best;
    }

    findArenaLock(sim, self) {
        const aim = sim.aim();
        let best = null, bestAngle = .22;
        for (const other of this.pilots.values()) {
            if (other.slot === (self?.slot ?? this.slot) || !other.alive || !other.cur) continue;
            const dx = other.cur[0] - sim.px, dy = other.cur[1] - sim.py, dz = other.cur[2] - sim.pz;
            const length = Math.hypot(dx, dy, dz);
            if (length > 220) continue;
            const angle = Math.acos(clamp((dx * aim.x + dy * aim.y + dz * aim.z) / length, -1, 1));
            if (angle < bestAngle) { bestAngle = angle; best = { type: 'pilot', slot: other.slot }; }
        }
        return best;
    }

    collidePilot(p, t, sRail, dt) {
        const sim = p.sim;
        if (t < p.invulnUntil || p.info.invuln) return;
        if (this.arena) {
            const hit = this.world.collide?.(sim.px, sim.py, sim.pz);
            const ground = this.world.groundY?.(v1.set(sim.px, 0, sim.pz)) ?? 0;
            if (hit || sim.py < ground + 2.2) {
                sim.py = Math.max(sim.py, ground + 2.4) + 2;
                sim.climb = Math.max(.4, sim.climb);
                if (hit) { sim.heading += Math.PI * .6; }
                this.damagePilot(p, 10, v1.set(sim.px, sim.py, sim.pz));
            }
            // Boost ram: from behind into a rival steals a core.
            this.ramCooldown -= dt;
            if (sim.boosting && this.ramCooldown <= 0) {
                for (const other of this.pilots.values()) {
                    if (other === p || !other.alive || !other.cur) continue;
                    const dx = other.cur[0] - sim.px, dy = other.cur[1] - sim.py, dz = other.cur[2] - sim.pz;
                    const distance = Math.hypot(dx, dy, dz);
                    if (distance > 6.5) continue;
                    const fx = Math.sin(other.cur[3]), fz = Math.cos(other.cur[3]);
                    if ((dx * fx + dz * fz) / (distance || 1) > .3) {
                        this.report.v.push([p.slot, other.slot, 3]);
                        this.ramCooldown = 1.5;
                        this.fx.burst(v1.set(other.cur[0], other.cur[1], other.cur[2]), 24, '#ffffff', 30);
                        if (p.slot === this.slot) this.audio.play('ram');
                    }
                }
            }
            return;
        }
        // Scenery
        const solid = this.world.collide?.(sRail + sim.d, sim.x, sim.y);
        if (solid) {
            sim.y += solid.y * 2.5;
            sim.x += solid.x * 2.5;
            sim.vy = solid.y * 10;
            this.damagePilot(p, 10, this.railWorld(sim.d + 1, sim.x, sim.y + 1, v1).clone(), 'scrape');
            return;
        }
        // Enemies
        for (const e of this.activeEnemies) {
            const dd = e.d - sim.d, dx = e.x - sim.x, dy = e.y + e.e.centerY - sim.y;
            const r = e.e.radius + 1.1;
            if (dd * dd + dx * dx + dy * dy < r * r) {
                this.hitEnemy(p, e.id, 3);
                this.damagePilot(p, 12, this.railWorld(sim.d, sim.x, sim.y, v1).clone());
                return;
            }
        }
        // Boss hull
        if (this.boss && (this.phase === 'boss')) {
            const position = this.railWorld(sim.d, sim.x, sim.y, v2);
            for (const h of this.boss.hull) {
                if (Vector3.DistanceSquared(h.pos, position) < (h.radius + 1) ** 2) {
                    sim.d -= 6;
                    this.damagePilot(p, 20, position.clone());
                    return;
                }
            }
        }
    }

    damagePilot(p, amount, position, kind = 'hit') {
        if (this.t < p.invulnUntil || p.info.invuln) return;
        p.invulnUntil = this.t + .5;
        this.report.d.push([p.slot, amount]);
        this.fx.burst(position, 14, kind === 'scrape' ? '#ffd08a' : '#ff9a6a', 18);
        if (p.slot === this.slot) {
            this.hud.damage(amount / 15);
            this.stage.shake = Math.max(this.stage.shake, .5 + amount / 20);
            this.audio.play(kind === 'scrape' ? 'scrape' : 'damage');
        }
    }

    // ─── Enemies ────────────────────────────────────────────────────────────────────

    hp(e) {
        const room = this.roomHp.get(e.id) ?? e.hp;
        const local = this.predicted.get(e.id);
        return local === undefined ? room : Math.min(room, local);
    }

    updateEnemies(t, sRail) {
        const list = [];
        const visible = new Set();
        if (this.level && this.phase !== 'bossIntro' && this.phase !== 'boss' && this.phase !== 'outro') {
            for (const e of this.level.enemies) {
                if (e.t0 - 4 > t || this.dead.has(e.id) || this.predictedDead.has(e.id)) continue;
                const pose = this.level.pose(e, t, sRail, {});
                if (!pose) continue;
                list.push({ id: e.id, e, d: pose.d, x: pose.x, y: pose.y, pose });
                visible.add(e.id);
                const view = this.enemyViews.show(e.id, e.kind);
                this.rail.toWorld(pose.s, pose.x, pose.y, view.root.position);
                const heading = this.rail.heading(pose.s);
                view.root.rotationQuaternion.copyFrom(QuaternionYPR(heading + pose.yaw, pose.pitch, pose.roll));
                if (view.head) {
                    const target = this.pilots.get(this.slot)?.cur;
                    if (target) {
                        const dx = target[0] - pose.x, dd = target[2] - pose.d;
                        view.head.rotationQuaternion.copyFrom(QuaternionYPR(Math.atan2(dx, dd) - pose.yaw + Math.PI, 0, 0));
                    }
                }
                if (view.flash > 0) {
                    view.flash -= .016;
                    view.root.scaling.setAll(1 + view.flash * .6);
                } else view.root.scaling.setAll(1);
                // Fire
                for (const time of e.fireTimes) {
                    if (time > this.tPrev && time <= t && pose.d > 14 && pose.d < 170 && this.phase === 'stage') this.enemyFire(e, pose, time);
                }
            }
        }
        this.enemyViews.hideAll(visible);
        this.activeEnemies = list;
    }

    targetSlot(k) {
        const alive = [...this.pilots.values()].filter(p => p.alive && p.cur).map(p => p.slot).sort();
        if (!alive.length) return null;
        return alive[((k % alive.length) + alive.length) % alive.length];
    }

    targetPos(slot) {
        const p = this.pilots.get(slot);
        if (!p?.cur) return null;
        return { d: p.cur[2], x: p.cur[0], y: p.cur[1] };
    }

    enemyFire(e, pose, time) {
        const k = e.id + Math.round(time * 10);
        const target = this.targetSlot(k);
        if (target === null) return;
        const aim = this.targetPos(target);
        const origin = { d: pose.d - 1.5, x: pose.x, y: pose.y + e.centerY };
        const speed = this.level.shotSpeed(e.kind);
        const spreads = e.kind === 'bomber' ? [-.18, 0, .18] : [0];
        for (const spread of spreads) this.spawnShot(origin, aim, target, speed, spread, 0);
    }

    spawnShot(origin, aim, target, speed, spreadX = 0, spreadY = 0, kind = 'orb') {
        let dd = aim.d - origin.d, dx = aim.x - origin.x, dy = aim.y - origin.y;
        const length = Math.hypot(dd, dx, dy) || 1;
        dd /= length; dx /= length; dy /= length;
        dx += spreadX; dy += spreadY;
        const l2 = Math.hypot(dd, dx, dy) || 1;
        this.shots.push({ d: origin.d, x: origin.x, y: origin.y, vd: dd / l2 * speed, vx: dx / l2 * speed, vy: dy / l2 * speed, life: SHOT_LIFE, target, kind });
        if (origin.d < 120) this.audio.play('enemy', .5);
    }

    explodeEnemy(e, pose, mine) {
        const position = this.rail.toWorld(pose.s, pose.x, pose.y + e.centerY, new Vector3());
        const size = { bomber: 2.4, carrier: 2.6, walker: 1.8, tank: 1.6, turret: 1.6, rock: 1.4 }[e.kind] ?? 1;
        const velocity = e.pattern.world ? Vector3.Zero() : new Vector3(0, 0, this.rail.speed);
        this.fx.explode(position, size, velocity, e.kind === 'rock' ? '#8a7f76' : '#4a4f5c');
        this.audio.play(size > 1.5 ? 'explodeBig' : 'explode', Math.max(.3, 1 - Math.max(0, pose.d) / 260));
        this.enemyViews.hide(e.id);
        if (mine) {
            const screen = this.stage.project(position);
            if (screen.visible) this.hud.popup(screen.x, screen.y, '+' + e.score);
        }
    }

    hitEnemy(p, id, dmg) {
        const e = this.level?.byId.get(id);
        if (!e || this.dead.has(id) || this.predictedDead.has(id)) return false;
        this.report.h.push([p.slot, id, dmg]);
        const hp = this.hp(e) - dmg;
        this.predicted.set(id, hp);
        const view = this.enemyViews.views.get(id);
        if (view) view.flash = .12;
        if (hp <= 0) {
            this.predictedDead.add(id);
            const pose = this.level.pose(e, this.t, this.anchor(this.t));
            if (pose) this.explodeEnemy(e, pose, p.slot === this.slot);
            if (p.slot === this.slot) this.hud.feedback('kill');
        } else if (p.slot === this.slot) {
            this.audio.play('hit', .7);
            this.hud.feedback('hit');
        }
        return true;
    }

    // ─── Boss ───────────────────────────────────────────────────────────────────────

    bossInfo(t, sRail) {
        const b = this.frame.boss;
        const introStart = this.def.bossAt;
        const fightStart = introStart + BOSS_INTRO;
        const intro = t < fightStart ? clamp((t - introStart) / BOSS_INTRO, 0, 1) : null;
        const phase = b?.phase ?? 0;
        const phaseStart = b?.start ?? fightStart;
        const hp = b?.hp ?? this.def.bossDef.parts.map(([, h]) => h);
        return {
            rail: this.rail, sRail, t, introU: intro, fightT: Math.max(0, t - fightStart), phase, phaseStart, phaseT: Math.max(0, t - phaseStart),
            hp, max: b?.max ?? hp, downT: b?.down >= 0 ? t - b.down : -1
        };
    }

    updateBoss(t, sRail, dt) {
        const boss = this.boss;
        const active = t >= this.def.bossAt;
        const info = this.bossInfo(t, sRail);
        const hidden = info.downT > 4.2;
        boss.setVisible(active && !hidden);
        if (!active || hidden) return;
        boss.pose(info);
        boss.tick(dt, info, this.fx);
        if (this.phase === 'boss' && info.downT < 0 && this.tPrev >= this.def.bossAt + BOSS_INTRO - .05) {
            boss.attacks(this.tPrev, t, info, shot => {
                const origin = this.rail.fromWorld(shot.origin);
                const o = { d: origin.s - sRail, x: origin.x, y: origin.y };
                const target = this.targetSlot(shot.target ?? 0);
                if (target === null) return;
                const aim = this.targetPos(target);
                if (shot.kind === 'missile') {
                    if (this.dead.has(shot.id)) return;
                    this.missiles.push({ id: shot.id, d: o.d, x: o.x, y: o.y, start: { ...o }, aim: { ...aim }, side: shot.side ?? 1, age: 0, target,
                        duration: Math.max(1.2, Math.hypot(aim.d - o.d, aim.x - o.x, aim.y - o.y) / (shot.speed ?? 30)) });
                    this.audio.play('missile', .6);
                } else this.spawnShot(o, aim, target, shot.speed ?? 38, shot.spreadX ?? 0, shot.spreadY ?? 0, shot.kind ?? 'orb');
            });
        }
        // Outro: chain explosions
        if (info.downT >= 0 && info.downT < 3.4) {
            this.chainTimer = (this.chainTimer ?? 0) - dt;
            if (this.chainTimer <= 0) {
                this.chainTimer = .16;
                const points = boss.explosionPoints();
                const point = points[Math.floor(Math.random() * points.length)];
                if (point) {
                    this.fx.explode(point.add(new Vector3((Math.random() - .5) * 6, (Math.random() - .5) * 4, (Math.random() - .5) * 6)), 1.8, Vector3.ZeroReadOnly, '#3d4350');
                    this.audio.play('explode', .8);
                    this.stage.shake = Math.max(this.stage.shake, .6);
                }
            }
        }
        if (info.downT >= 3.4 && !this.finalBlast) {
            this.finalBlast = true;
            const center = boss.root.getAbsolutePosition().clone();
            this.fx.explode(center, 3, Vector3.ZeroReadOnly, '#3d4350');
            this.fx.blast(center, 15);
            this.stage.flash = 1;
            this.stage.shake = 3;
            this.audio.play('blast');
        }
    }

    bossDown() {
        this.hud.comms.length = 0;
        this.hud.comm('mira', 'Er geht unter! Gute Arbeit, Staffel!', true);
        this.audio.music('clear', this.def.key);
        setTimeout(() => !this.disposed && this.hud.card('MISSION ERFÜLLT', this.def.name, 'clear', 4.5), 4200);
        setTimeout(() => !this.disposed && this.hud.letterbox(true), 3600);
        this.shots.length = 0;
        this.missiles.length = 0;
    }

    updateMissiles(dt, t, sRail) {
        for (let i = this.missiles.length - 1; i >= 0; i--) {
            const m = this.missiles[i];
            if (this.dead.has(m.id)) { this.missiles.splice(i, 1); continue; }
            m.age += dt;
            const u = m.age / m.duration;
            const prev = { d: m.d, x: m.x, y: m.y };
            if (u < 1) {
                // Quadratic curve: up and out first, then down onto the aim point.
                const c = { d: (m.start.d + m.aim.d) / 2 + 10, x: m.start.x + m.side * 14, y: Math.max(m.start.y, m.aim.y) + 12 };
                const a = 1 - u;
                m.d = a * a * m.start.d + 2 * a * u * c.d + u * u * m.aim.d;
                m.x = a * a * m.start.x + 2 * a * u * c.x + u * u * m.aim.x;
                m.y = a * a * m.start.y + 2 * a * u * c.y + u * u * m.aim.y;
                m.vel = { d: (m.d - prev.d) / dt, x: (m.x - prev.x) / dt, y: (m.y - prev.y) / dt };
            } else {
                m.d += m.vel.d * dt; m.x += m.vel.x * dt; m.y += m.vel.y * dt;
            }
            if (u > 2.5 || m.d < -40) { this.missiles.splice(i, 1); continue; }
            const view = this.enemyViews.show(m.id, 'missile');
            this.railWorld(m.d, m.x, m.y, view.root.position);
            const heading = this.rail.heading(sRail + m.d);
            const vd = m.d - prev.d, vx = m.x - prev.x, vy = m.y - prev.y;
            view.root.rotationQuaternion.copyFrom(QuaternionYPR(heading + Math.atan2(vx, vd), -Math.atan2(vy, Math.hypot(vx, vd)), t * 6));
            // Hits the pilot it chases (decided by whoever simulates that pilot)
            const p = this.pilots.get(m.target);
            if (p?.sim && p.alive && p.cur) {
                const dd = m.d - p.sim.d, dx = m.x - p.sim.x, dy = m.y - p.sim.y;
                if (dd * dd + dx * dx + dy * dy < 4.4) {
                    m.exploded = true;
                    this.fx.explode(view.root.position.clone(), .8);
                    this.damagePilot(p, 14, view.root.position.clone());
                    this.report.h.push([p.slot, m.id, 1]);
                    this.dead.add(m.id);
                    this.enemyViews.hide(m.id);
                    this.missiles.splice(i, 1);
                    continue;
                }
            }
        }
        // hide missile views that are gone
        for (const id of [...this.enemyViews.views.keys()]) if (id >= DRONE_BASE && !this.missiles.some(m => m.id === id)) this.enemyViews.hide(id);
    }

    // ─── Projectiles ────────────────────────────────────────────────────────────────

    updateShots(dt, t, sRail) {
        for (let i = this.shots.length - 1; i >= 0; i--) {
            const s = this.shots[i];
            const pd = s.d, px = s.x, py = s.y;
            s.d += s.vd * dt; s.x += s.vx * dt; s.y += s.vy * dt;
            s.life -= dt;
            if (s.life <= 0 || s.d < -45 || s.d > 400) { this.shots.splice(i, 1); continue; }
            const p = this.pilots.get(s.target);
            if (p?.sim && p.alive && this.controllable()) {
                const sim = p.sim;
                const rolling = sim.rolling;
                const r = rolling ? 3.2 : 1.45;
                if (segmentDistance2(pd, px, py, s.d, s.x, s.y, sim.d, sim.x, sim.y) < r * r) {
                    const position = this.railWorld(s.d, s.x, s.y, new Vector3());
                    if (rolling) {
                        this.bolts.push({ d: s.d, x: s.x, y: s.y, vd: -s.vd * 2.4, vx: -s.vx * 2.4, vy: -s.vy * 2.4, life: 1.6, owner: p.slot, local: true, dmg: 2, color: '#ffe36a', width: 1.4 });
                        this.fx.burst(position, 10, '#fff3b0', 20);
                        if (p.slot === this.slot) this.audio.play('reflect');
                    } else if (!(t < p.invulnUntil || p.info.invuln)) {
                        this.damagePilot(p, 10, position);
                    }
                    this.shots.splice(i, 1);
                    continue;
                }
            }
            this.fx.orb(this.railWorld(s.d, s.x, s.y, v1), s.kind === 'big' ? '#ff5020' : '#ff2a18', s.kind === 'big' ? 1.6 : 1.1);
        }
    }

    updateBolts(dt, t, sRail) {
        for (let i = this.bolts.length - 1; i >= 0; i--) {
            const b = this.bolts[i];
            if (b.arena) { if (!this.updateArenaBolt(b, dt)) this.bolts.splice(i, 1); continue; }
            if (b.lock) this.steerBolt(b, dt, sRail);
            const pd = b.d, px = b.x, py = b.y;
            b.d += b.vd * dt; b.x += b.vx * dt; b.y += b.vy * dt;
            b.life -= dt;
            if (b.life <= 0) { if (b.charged) this.chargedBlast(b, sRail); this.bolts.splice(i, 1); continue; }
            let consumed = false;
            if (b.local) {
                const owner = this.pilots.get(b.owner);
                for (const e of this.activeEnemies) {
                    const r = e.e.radius + (b.charged ? 1.5 : .3);
                    if (segmentDistance2(pd, px, py, b.d, b.x, b.y, e.d, e.x, e.y + e.e.centerY) < r * r) {
                        if (b.charged) this.chargedBlast(b, sRail);
                        else {
                            this.hitEnemy(owner, e.id, b.dmg);
                            this.fx.burst(this.railWorld(b.d, b.x, b.y, v1), 5, '#ffe08a', 14);
                        }
                        consumed = true;
                        break;
                    }
                }
                if (!consumed) for (const m of this.missiles) {
                    if (segmentDistance2(pd, px, py, b.d, b.x, b.y, m.d, m.x, m.y) < 2.6) {
                        this.report.h.push([b.owner, m.id, 1]);
                        this.dead.add(m.id);
                        this.fx.explode(this.railWorld(m.d, m.x, m.y, new Vector3()), .6);
                        this.audio.play('explode', .7);
                        consumed = true;
                        break;
                    }
                }
                if (!consumed && this.boss && this.phase === 'boss') consumed = this.boltBoss(b, pd, px, py, sRail, owner);
                if (!consumed && this.world.collide?.(sRail + b.d, b.x, b.y)) {
                    this.fx.burst(this.railWorld(b.d, b.x, b.y, v1), 4, '#ffd8a0', 10);
                    consumed = true;
                }
            }
            if (consumed) { this.bolts.splice(i, 1); continue; }
            this.railWorld(b.d, b.x, b.y, v1);
            if (b.charged) this.fx.orb(v1, b.color, 1.5 + Math.sin(t * 30) * .2);
            else {
                this.rail.direction(sRail + b.d, b.vd, b.vx, b.vy, v2).normalize();
                this.fx.bolt(v1, v2, b.color, 1, b.width);
            }
        }
    }

    steerBolt(b, dt, sRail) {
        let target = null;
        if (b.lock.type === 'enemy') {
            const e = this.activeEnemies.find(c => c.id === b.lock.id);
            if (e) target = { d: e.d, x: e.x, y: e.y + e.e.centerY };
        } else if (b.lock.type === 'part' && this.boss) {
            const part = this.boss.parts[b.lock.index];
            if (part?.active) { const r = this.rail.fromWorld(part.pos); target = { d: r.s - sRail, x: r.x, y: r.y }; }
        }
        if (!target) return;
        const speed = Math.hypot(b.vd, b.vx, b.vy);
        let dd = target.d - b.d, dx = target.x - b.x, dy = target.y - b.y;
        const l = Math.hypot(dd, dx, dy) || 1;
        const k = Math.min(1, dt * 7);
        b.vd += (dd / l * speed - b.vd) * k; b.vx += (dx / l * speed - b.vx) * k; b.vy += (dy / l * speed - b.vy) * k;
    }

    chargedBlast(b, sRail) {
        const position = this.railWorld(b.d, b.x, b.y, new Vector3());
        this.fx.explode(position, 1.6, Vector3.ZeroReadOnly, '#7dff6a');
        this.fx.shockwave(position, 9, '#9dff6a', .4);
        this.audio.play('explodeBig', .8);
        const owner = this.pilots.get(b.owner);
        let kills = 0;
        for (const e of this.activeEnemies) {
            const dd = e.d - b.d, dx = e.x - b.x, dy = e.y + e.e.centerY - b.y;
            if (dd * dd + dx * dx + dy * dy < 81) {
                const before = this.hp(e);
                this.hitEnemy(owner, e.id, Math.hypot(dd, dx, dy) < e.e.radius + 2 ? 4 : 2);
                if (before > 0 && this.predictedDead.has(e.id)) kills++;
            }
        }
        if (this.boss && this.phase === 'boss') for (const part of this.boss.parts) {
            if (part?.active && Vector3.DistanceSquared(part.pos, position) < (part.radius + 6) ** 2) this.report.h.push([b.owner, -1 - part.index, 4]);
        }
        if (kills > 1 && b.owner === this.slot) {
            const screen = this.stage.project(position);
            if (screen.visible) this.hud.popup(screen.x, screen.y - 30, '+' + kills + ' KETTE', '#9dff6a');
        }
        void sRail;
    }

    boltBoss(b, pd, px, py, sRail, owner) {
        const a = this.railWorld(pd, px, py, new Vector3());
        const c = this.railWorld(b.d, b.x, b.y, new Vector3());
        for (const part of this.boss.parts) {
            if (!part?.alive) continue;
            const r = part.radius + (b.charged ? 1 : .2);
            if (segmentDistance2(a.x, a.y, a.z, c.x, c.y, c.z, part.pos.x, part.pos.y, part.pos.z) < r * r) {
                if (part.active) {
                    if (b.charged) this.chargedBlast(b, sRail);
                    else this.report.h.push([owner.slot, -1 - part.index, b.dmg]);
                    this.fx.burst(c, 8, '#ffe08a', 16);
                    part.hit = .15;
                    if (owner.slot === this.slot) { this.audio.play('hit', .8); this.hud.feedback('hit'); }
                } else {
                    this.fx.burst(c, 6, '#bcd8ff', 12);
                    if (owner.slot === this.slot) { this.audio.play('armor', .6); this.hud.feedback('armor'); }
                }
                return true;
            }
        }
        // Armour and hull stop a shot only when it is not headed for a part that can be hit right now
        // (parts may sit inside the hull spheres that exist for ramming).
        const dx = c.x - a.x, dy = c.y - a.y, dz = c.z - a.z, length = Math.hypot(dx, dy, dz) || 1;
        for (const part of this.boss.parts) {
            if (!part?.active) continue;
            const px = part.pos.x - a.x, py = part.pos.y - a.y, pz = part.pos.z - a.z;
            const along = (px * dx + py * dy + pz * dz) / length;
            if (along < 0) continue;
            const miss = px * px + py * py + pz * pz - along * along;
            if (miss < (part.radius * 1.05) ** 2) return false;
        }
        for (const s of [...this.boss.armor, ...this.boss.hull]) {
            if (!s.radius) continue;
            if (segmentDistance2(a.x, a.y, a.z, c.x, c.y, c.z, s.pos.x, s.pos.y, s.pos.z) < s.radius * s.radius) {
                this.fx.burst(c, 5, '#bcd8ff', 12);
                if (owner.slot === this.slot) { this.audio.play('armor', .5); this.hud.feedback('armor'); }
                return true;
            }
        }
        return false;
    }

    updateArenaBolt(b, dt) {
        if (b.lock?.type === 'pilot') {
            const target = this.pilots.get(b.lock.slot)?.cur;
            if (target) {
                const speed = Math.hypot(b.vx, b.vy, b.vz);
                const dx = target[0] - b.x, dy = target[1] - b.y, dz = target[2] - b.z, l = Math.hypot(dx, dy, dz) || 1;
                const k = Math.min(1, dt * 4);
                b.vx += (dx / l * speed - b.vx) * k; b.vy += (dy / l * speed - b.vy) * k; b.vz += (dz / l * speed - b.vz) * k;
            }
        }
        const ax = b.x, ay = b.y, az = b.z;
        b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
        b.life -= dt;
        if (b.life <= 0) return false;
        if (b.local && this.phase === 'battle') {
            for (const p of this.pilots.values()) {
                if (p.slot === b.owner || !p.alive || !p.cur) continue;
                const r = b.charged ? 3.6 : 2.3;
                if (segmentDistance2(ax, ay, az, b.x, b.y, b.z, p.cur[0], p.cur[1], p.cur[2]) < r * r) {
                    const rolling = p.cur[6] & FLAG.ROLL;
                    const position = new Vector3(b.x, b.y, b.z);
                    if (rolling && !b.charged) { this.fx.burst(position, 8, '#fff3b0', 16); return false; }
                    this.report.v.push([b.owner, p.slot, b.charged ? 2 : 0]);
                    this.fx.burst(position, 12, TEAM[p.slot], 20);
                    if (b.charged) this.fx.explode(position, 1.2, Vector3.ZeroReadOnly, '#7dff6a');
                    if (b.owner === this.slot) { this.audio.play('hit'); this.hud.feedback('hit'); }
                    return false;
                }
            }
        }
        if (this.world.collide?.(b.x, b.y, b.z) || b.y < (this.world.groundY?.(v1.set(b.x, 0, b.z)) ?? 0)) {
            this.fx.burst(v1.set(b.x, b.y, b.z), 4, '#ffd8a0', 10);
            return false;
        }
        v1.set(b.x, b.y, b.z);
        if (b.charged) this.fx.orb(v1, b.color, 1.5);
        else { v2.set(b.vx, b.vy, b.vz).normalize(); this.fx.bolt(v1, v2, b.color, 1, b.width); }
        return true;
    }

    launchBomb(slot, a, local) {
        const mesh = this.bombMeshes.pop() ?? bombMesh(this.stage);
        mesh.setEnabled(true);
        if (this.arena) this.bombs.push({ arena: true, slot, local, x: a[0], y: a[1], z: a[2], vx: a[3] * BOMB_SPEED, vy: a[4] * BOMB_SPEED, vz: a[5] * BOMB_SPEED, age: 0, mesh });
        else this.bombs.push({ slot, local, d: a[2], x: a[0], y: a[1], vd: a[3] * BOMB_SPEED, vx: a[4] * BOMB_SPEED, vy: a[5] * BOMB_SPEED, age: 0, mesh });
        this.audio.play('bombLaunch');
        if (slot === this.slot) this.bombArmedAt = this.t;
    }

    updateBombs(dt, t, sRail) {
        for (let i = this.bombs.length - 1; i >= 0; i--) {
            const b = this.bombs[i];
            b.age += dt;
            let detonate = b.age > 1.15;
            if (b.arena) {
                b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
                b.mesh.position.set(b.x, b.y, b.z);
                if (b.local) for (const p of this.pilots.values()) {
                    if (p.slot === b.slot || !p.alive || !p.cur) continue;
                    if ((p.cur[0] - b.x) ** 2 + (p.cur[1] - b.y) ** 2 + (p.cur[2] - b.z) ** 2 < 16) detonate = true;
                }
            } else {
                b.d += b.vd * dt; b.x += b.vx * dt; b.y += b.vy * dt;
                this.railWorld(b.d, b.x, b.y, b.mesh.position);
                if (b.local) for (const e of this.activeEnemies) {
                    if ((e.d - b.d) ** 2 + (e.x - b.x) ** 2 + (e.y + e.e.centerY - b.y) ** 2 < (e.e.radius + 1.5) ** 2) detonate = true;
                }
                if (b.local && this.boss && this.phase === 'boss') for (const part of this.boss.parts) {
                    if (part?.alive && Vector3.DistanceSquared(part.pos, b.mesh.position) < (part.radius + 2) ** 2) detonate = true;
                }
            }
            if (b.detonateNow) detonate = true;
            b.mesh.scaling.setAll(1 + Math.sin(t * 40) * .15);
            if (!detonate) continue;
            this.bombs.splice(i, 1);
            b.mesh.setEnabled(false);
            this.bombMeshes.push(b.mesh);
            this.detonate(b, sRail);
        }
    }

    detonate(b, sRail) {
        const position = b.mesh.position.clone();
        const radius = b.arena ? ARENA_BOMB_RADIUS : BOMB_RADIUS;
        this.fx.blast(position, radius * .8);
        this.stage.flash = Math.max(this.stage.flash, .55);
        this.stage.shake = Math.max(this.stage.shake, 1.4);
        this.audio.play('blast');
        if (!b.local) return;
        const owner = this.pilots.get(b.slot);
        if (b.arena) {
            for (const p of this.pilots.values()) {
                if (p.slot === b.slot || !p.alive || !p.cur) continue;
                if ((p.cur[0] - b.x) ** 2 + (p.cur[1] - b.y) ** 2 + (p.cur[2] - b.z) ** 2 < radius * radius) this.report.v.push([b.slot, p.slot, 1]);
            }
            return;
        }
        let kills = 0;
        for (const e of this.activeEnemies) {
            if ((e.d - b.d) ** 2 + (e.x - b.x) ** 2 + (e.y + e.e.centerY - b.y) ** 2 < radius * radius) {
                this.hitEnemy(owner, e.id, 10);
                if (this.predictedDead.has(e.id)) kills++;
            }
        }
        for (const m of this.missiles) {
            if ((m.d - b.d) ** 2 + (m.x - b.x) ** 2 + (m.y - b.y) ** 2 < radius * radius) { this.report.h.push([b.slot, m.id, 1]); this.dead.add(m.id); }
        }
        this.shots = this.shots.filter(s => (s.d - b.d) ** 2 + (s.x - b.x) ** 2 + (s.y - b.y) ** 2 > radius * radius);
        if (this.boss && this.phase === 'boss') for (const part of this.boss.parts) {
            if (part?.active && Vector3.DistanceSquared(part.pos, position) < (radius + part.radius) ** 2) this.report.h.push([b.slot, -1 - part.index, 8]);
        }
        if (kills > 1 && b.slot === this.slot) {
            const screen = this.stage.project(position);
            if (screen.visible) this.hud.popup(screen.x, screen.y - 40, '+' + kills + ' TREFFER', '#ffd34a');
        }
    }

    // ─── Pickups ────────────────────────────────────────────────────────────────────

    updatePickups(t, sRail) {
        const keep = new Set();
        const locals = [...this.pilots.values()].filter(p => p.sim && p.alive);
        const consider = (id, kind, position, radius, railPos) => {
            if (this.taken.has(id) || (this.predictedTaken.get(id) ?? -99) > t - 1.5) return;
            keep.add(id);
            const view = this.pickupViews.show(id, kind);
            view.root.position.copyFrom(position);
            view.root.rotation.y = t * 2 + id;
            if (kind === 'gate') view.root.rotation.set(Math.PI / 2, this.arena ? 0 : this.rail.heading(railPos?.s ?? 0), 0);
            for (const p of locals) {
                let hit;
                if (this.arena) hit = (p.sim.px - position.x) ** 2 + (p.sim.py - position.y) ** 2 + (p.sim.pz - position.z) ** 2 < (radius + 1.4) ** 2;
                else hit = (railPos.s - sRail - p.sim.d) ** 2 + (railPos.x - p.sim.x) ** 2 + (railPos.y - p.sim.y) ** 2 < (radius + 1.4) ** 2;
                if (hit) {
                    if (kind === 'gate') { if (p.gate) continue; p.gate = true; }
                    this.report.p.push([p.slot, id]);
                    if (kind !== 'gate') this.predictedTaken.set(id, t);
                    this.fx.burst(position, 16, kind === 'gold' ? '#ffd34a' : '#e9f1ff', 18);
                    if (p.slot === this.slot) {
                        this.audio.play(kind === 'ring' || kind === 'gold' || kind === 'gate' ? 'ring' : 'pickup');
                        const screen = this.stage.project(position);
                        const label = { ring: 'SCHILD +30', gold: 'GOLDRING', bomb: 'BOMBE +1', laser: 'LASER ↑', gate: 'SCHILD +50' }[kind];
                        if (screen.visible) this.hud.popup(screen.x, screen.y, label, '#bfe9ff');
                    }
                    if (kind !== 'gate') break;
                }
            }
        };
        if (this.arena) {
            LEVELS.arena.pickups.forEach(([kind, x, y, z], i) => {
                consider(PICKUP_BASE + i, kind, v3.set(x, y + Math.sin(t * 2 + i) * .6, z), kind === 'ring' ? 2.4 : 1.8);
            });
        } else {
            for (const pk of [...this.level.pickups, ...this.drops]) {
                const d = pk.s - sRail;
                if (d < -30 || d > 420) continue;
                const radius = pk.kind === 'gate' ? 7 : pk.kind === 'ring' || pk.kind === 'gold' ? 2.4 : 1.8;
                consider(pk.id, pk.kind, this.rail.toWorld(pk.s, pk.x, pk.y + Math.sin(t * 2 + pk.id) * .3, v3), radius, pk);
            }
        }
        this.pickupViews.hideAll(keep);
    }

    // ─── Radio, camera, HUD ─────────────────────────────────────────────────────────

    radio(t) {
        for (const [time, speaker, text] of this.def.radio) {
            if (t >= time && t < time + 4 && !this.radioDone.has(time)) { this.radioDone.add(time); this.hud.comm(speaker, text); }
        }
    }

    updateCamera(dt, t, sRail, own) {
        const cam = this.cam;
        const st = own?.cur;
        let eye = v1, look = v2, roll = 0, fov = 1;
        const boosting = st && (st[6] & FLAG.BOOST), braking = st && (st[6] & FLAG.BRAKE);
        if (this.arena) {
            const target = st && own.alive ? st : this.spectateState();
            if (target) {
                const h = target[3], p = -target[4];
                const fx = Math.sin(h) * Math.cos(p), fy = Math.sin(p), fz = Math.cos(h) * Math.cos(p);
                if (this.cameraMode === 'cockpit' && own.alive) {
                    eye.set(target[0] + fx * 2, target[1] + .7, target[2] + fz * 2);
                    look.set(target[0] + fx * 40, target[1] + fy * 40 + .5, target[2] + fz * 40);
                    roll = target[5] * .6;
                } else {
                    eye.set(target[0] - fx * 13, target[1] - fy * 8 + 4, target[2] - fz * 13);
                    look.set(target[0] + fx * 18, target[1] + fy * 18 + 1.5, target[2] + fz * 18);
                    roll = target[5] * .12;
                }
            } else { eye.set(0, 60, -200); look.set(0, 20, 0); }
            if (this.phase === 'countdown' && st) {
                const u = t / COUNTDOWN;
                const a = (1 - ease(u)) * Math.PI;
                const h = st[3];
                eye.set(st[0] + Math.sin(h + a) * -14, st[1] + 3 + (1 - u) * 6, st[2] + Math.cos(h + a) * -14);
                look.set(st[0], st[1] + 1, st[2]);
            }
        } else {
            const target = st && own.alive ? st : this.spectateState() ?? [0, 10, 0, 0, 0, 0, 0, 1];
            const [x, y, d] = target;
            if (this.cameraMode === 'cockpit' && own?.alive && this.controllable()) {
                this.railWorld(d + 1.4, x, y + .55, eye);
                const aim = own.sim?.aim() ?? { s: 1, x: 0, y: 0 };
                this.railWorld(d + 1.4 + aim.s * 40, x + aim.x * 40, y + .55 + aim.y * 40, look);
                roll = target[5] * .5;
            } else {
                this.railWorld(d * .55 - 11.5, x * .62, y * .6 + 6.2, eye);
                this.railWorld(d + 30, x * .8, y * .82 + 4.2, look);
                roll = target[5] * .1;
            }
            fov = 1 + (boosting ? .14 : 0) - (braking ? .06 : 0);
            if (this.phase === 'intro') {
                const u = clamp(t / INTRO, 0, 1);
                const a = Math.PI * (1 - ease(u * 1.15));
                const r = 24;
                const blend = ease((u - .8) / .2);
                const ex = Math.sin(a) * r * .7, ed = Math.cos(a) * r + d, ey = y + 3 + Math.sin(u * Math.PI) * 5;
                v3.copyFrom(eye);
                this.railWorld(ed, x + ex, ey, eye);
                Vector3.LerpToRef(eye, v3, blend, eye);
                const lookIntro = this.railWorld(d, x, y + 1, new Vector3());
                Vector3.LerpToRef(lookIntro, look, blend, look);
                roll *= blend;
            } else if (this.phase === 'bossIntro') {
                const u = clamp((t - this.def.bossAt) / BOSS_INTRO, 0, 1);
                const shot = this.boss.introShot(u);
                const blend = ease((u - .88) / .12);
                v3.copyFrom(eye);
                this.railWorld(shot.eye.d, shot.eye.x, shot.eye.y, eye);
                Vector3.LerpToRef(eye, v3, blend, eye);
                const lookShot = this.railWorld(shot.look.d, shot.look.x, shot.look.y, new Vector3());
                Vector3.LerpToRef(lookShot, look, blend, look);
                roll *= blend;
            } else if (this.phase === 'outro') {
                const since = t - this.frame.boss.down;
                void OUTRO;
                const ship = this.railWorld(d, x, y, new Vector3());
                if (since < 3.9 && this.boss?.root) {
                    // Watch the boss break apart over the shoulder of the own ship.
                    this.railWorld(d - 10 + since, x + 5, y + 3.5, eye);
                    Vector3.LerpToRef(this.boss.root.getAbsolutePosition(), ship, .25, look);
                    look.y = Math.max(look.y, ship.y + 1);
                } else if (since < 6) {
                    const v = (since - 3.9) / 2.1, b = -1.2 + v * 2.2;
                    eye.copyFrom(ship).addInPlace(new Vector3(Math.sin(b) * 11, 2.5 + v * 3, Math.cos(b) * 11 + 4));
                    look.copyFrom(ship).addInPlace(new Vector3(0, 1, 10));
                } else {
                    this.railWorld(-10, 0, 8, eye);
                    look.copyFrom(ship);
                }
                roll = 0;
            }
        }
        // Smooth the chase camera a little; cuts (intro/outro) follow exactly.
        if (!cam.init || this.phase === 'bossIntro' || this.phase === 'intro' || this.phase === 'outro' || this.cameraMode === 'cockpit') {
            cam.eye.copyFrom(eye); cam.look.copyFrom(look); cam.init = true;
        } else {
            const k = this.arena ? Math.min(1, dt * 9) : Math.min(1, dt * 14);
            Vector3.LerpToRef(cam.eye, eye, k, cam.eye);
            Vector3.LerpToRef(cam.look, look, Math.min(1, dt * 18), cam.look);
        }
        cam.roll += (roll - cam.roll) * Math.min(1, dt * 6);
        this.fov = (this.fov ?? 1) + (fov - (this.fov ?? 1)) * Math.min(1, dt * 4);
        this.stage.view(cam.eye, cam.look, cam.roll, this.fov);
        const inside = this.cameraMode === 'cockpit' && !!own?.alive && this.controllable();
        this.cockpit.setVisible(inside);
        if (inside && st) this.cockpit.update(st[5], st[4], t);
        this.stage.setAberration(boosting ? 18 : 0);
    }

    spectateState() {
        for (const p of this.pilots.values()) if (p.alive && p.cur && p.slot !== this.slot && !p.info.bot) return p.cur;
        for (const p of this.pilots.values()) if (p.alive && p.cur && p.slot !== this.slot) return p.cur;
        return null;
    }

    popupAt(position, text, color) {
        const screen = this.stage.project(position);
        if (screen.visible) this.hud.popup(screen.x, screen.y, text, color);
    }

    updateHud(t, own) {
        if (!own) return;
        const info = own.info, sim = own.sim;
        const crew = avatarOf(info, this.slot);
        this.hud.pilot({ crew, lives: info.lives, shield: info.shield, max: info.maxShield, bombs: info.bombs, laser: info.laser, score: info.score, hits: info.hits,
            meter: sim?.meter ?? 1, overheat: sim?.overheat, boosting: sim?.boosting, charge: sim?.charge ?? 0, arena: this.arena, mode: this.mode, cores: info.cores });
        this.hud.wing([...this.pilots.values()].filter(p => p.slot !== this.slot).map(p => ({ slot: p.slot, crew: avatarOf(p.info, p.slot), name: p.info.name,
            ratio: this.mode === 'Battle' ? p.info.cores / 3 : p.info.shield / p.info.maxShield, alive: p.alive, out: p.info.out })));
        // Boss bar
        if (this.boss && this.frame.boss && (this.phase === 'boss' || this.phase === 'bossIntro')) {
            const b = this.frame.boss;
            const total = b.max.reduce((a, c) => a + c, 0), left = b.hp.reduce((a, c) => a + c, 0);
            this.hud.boss(this.def.boss, left / total, true, 'Phase ' + (b.phase + 1) + ' / ' + this.def.bossDef.phases.length);
        } else this.hud.boss('', 0, false);
        if (this.arena) {
            const left = Math.max(0, COUNTDOWN + BATTLE_TIME - t);
            this.hud.timer(this.phase === 'countdown' ? String(Math.ceil(COUNTDOWN - t)) : Math.floor(left / 60) + ':' + String(Math.floor(left % 60)).padStart(2, '0'));
            const me = own.cur;
            if (me) {
                const h = me[3], c = Math.cos(h), s = Math.sin(h);
                this.hud.radar([...this.pilots.values()].filter(p => p !== own && p.alive && p.cur).map(p => {
                    const dx = p.cur[0] - me[0], dz = p.cur[2] - me[2], scale = Math.max(160, Math.hypot(dx, dz));
                    return { id: p.slot, x: (dx * c - dz * s) / scale, y: (dx * s + dz * c) / scale, color: TEAM[p.slot] };
                }), true);
            }
            if (Math.floor(t * 10) !== this.tagTick) {
                this.tagTick = Math.floor(t * 10);
                const tags = [];
                for (const p of this.pilots.values()) {
                    if (p === own || !p.alive || !p.cur) continue;
                    const screen = this.stage.project(v1.set(p.cur[0], p.cur[1] + 3, p.cur[2]));
                    if (screen.visible) tags.push({ x: screen.x, y: screen.y, text: p.info.name + (this.mode === 'Battle' ? ' ' + '●'.repeat(Math.max(0, p.info.cores)) : ''), color: TEAM[p.slot] });
                }
                this.hud.tags(tags);
            }
        } else this.hud.timer('');
        // Reticles
        const visible = own.alive && sim && this.controllable() && this.cameraMode !== 'cockpit' || (own.alive && this.cameraMode === 'cockpit' && this.controllable());
        if (sim && own.cur) {
            const aim = sim.aim();
            let near, far;
            if (this.arena) {
                near = this.stage.project(v1.set(sim.px + aim.x * 20, sim.py + aim.y * 20, sim.pz + aim.z * 20));
                far = this.stage.project(v1.set(sim.px + aim.x * 55, sim.py + aim.y * 55, sim.pz + aim.z * 55));
            } else {
                near = this.stage.project(this.railWorld(sim.d + aim.s * 22, sim.x + aim.x * 22, sim.y + aim.y * 22, v1));
                far = this.stage.project(this.railWorld(sim.d + aim.s * 58, sim.x + aim.x * 58, sim.y + aim.y * 58, v1));
            }
            let lock = null;
            if (this.lockTarget) {
                let position = null;
                if (this.lockTarget.type === 'enemy') {
                    const e = this.activeEnemies.find(c => c.id === this.lockTarget.id);
                    if (e) position = this.railWorld(e.d, e.x, e.y + e.e.centerY, v2);
                } else if (this.lockTarget.type === 'part') position = this.boss?.parts[this.lockTarget.index]?.pos;
                else if (this.lockTarget.type === 'pilot') { const c = this.pilots.get(this.lockTarget.slot)?.cur; if (c) position = v2.set(c[0], c[1], c[2]); }
                if (position) { const s = this.stage.project(position); if (s.visible) lock = s; }
            }
            this.hud.reticles(near, far, lock, visible);
        } else this.hud.reticles({ visible: false }, {}, null, false);
        this.hud.updateComm(t);
        this.audio.engine(own.alive && own.cur ? ((own.cur[6] & FLAG.BOOST) ? 1 : (own.cur[6] & FLAG.BRAKE) ? -1 : 0) : null);
    }

    flushReport(now) {
        if (now - this.reportAt < 50) { this.report.s.length = 0; return; }
        this.reportAt = now;
        const r = this.report;
        if (r.s.length || r.h.length || r.d.length || r.p.length || r.b.length || r.v.length) this.send(r);
        this.report = this.emptyReport();
    }

    finish(frame) {
        this.finished = true;
        this.input.enabled = false;
        this.app.finished?.(frame, this);
    }

    dispose() {
        this.disposed = true;
        this.hud.show(false);
        this.hud.tags([]);
        this.world.dispose();
        this.boss?.dispose();
        this.cockpit.dispose();
        for (const p of this.pilots.values()) p.view.dispose();
        this.enemyViews.hideAll();
        for (const t of this.enemyViews.templates.values()) { t.body.dispose(); t.glow?.dispose(); t.head?.dispose(); }
        this.pickupViews.hideAll();
        for (const t of this.pickupViews.templates.values()) { t.body?.dispose(); t.glow.dispose(); }
        for (const b of this.bombs) b.mesh.dispose();
        for (const m of this.bombMeshes) m.dispose();
        this.fx.clear();
        this.fx.beginProjectiles();
        this.fx.endProjectiles();
    }
}

const qTmp = new Quaternion();
function QuaternionYPR(yaw, pitch, roll) {
    return Quaternion.RotationYawPitchRollToRef(yaw, pitch, roll, qTmp);
}

void KINDS; void hash; void v3;
