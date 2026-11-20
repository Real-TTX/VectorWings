// A room inside the browser for the previews (?preview=...): the same rules as VectorWings.Core.Room on the server,
// so the game can be developed and shown without a MatGame host. Online and in the app the C# room decides.
import { LEVELS, KINDS, PICKUP_BASE, DROP_BASE, DRONE_BASE } from '../level.js';

export const INTRO = 6, BOSS_INTRO = 7, OUTRO = 9, COUNTDOWN = 4, BATTLE_TIME = 180;
const SHIELD = [100, 85, 130], BOMBS = [3, 2, 3];
const CREW = ['Mira', 'Brakk', 'Sola', 'Pip'];

export class LoopbackRoom {
    constructor({ mode = 'Campaign', mission = 0, name = 'Pilot', ship = 0, bots = true, slot = 0, avatar = 'mira' }) {
        this.avatar = avatar;
        this.mode = mode;
        this.def = mode === 'Campaign' ? LEVELS.missions[mission] : null;
        this.time = 0;
        this.state = 'Playing';
        this.events = [];
        this.eventSeq = 0;
        this.kills = [];
        this.dead = new Set();
        this.hp = new Map();
        this.taken = new Map();
        this.drops = new Set();
        this.boss = null;
        this.pilots = [];
        for (let s = 0; s < 4; s++) {
            if (s === slot) this.pilots.push(this.pilot(s, name, false, ship));
            else if (bots) this.pilots.push(this.pilot(s, CREW[s], true, s % 3));
        }
        if (this.def) {
            this.waves = [];
            let id = 0;
            for (const [t, kind, , count] of this.def.waves) for (let i = 0; i < count; i++) this.waves[id++] = { t, kind };
        }
        this.listeners = [];
        this.timer = setInterval(() => this.step(1 / 20), 50);
    }

    pilot(slot, name, bot, ship) {
        const battle = this.mode !== 'Campaign';
        return { slot, name, bot, avatar: bot ? ['mira', 'brakk', 'sola', 'pip'][slot] : this.avatar, connected: !bot, ship, st: [0, 0, 0, 0, 0, 0, 0, 0], shield: battle && this.mode === 'Battle' ? 100 : SHIELD[ship],
            maxShield: battle ? 100 : SHIELD[ship], lives: 3, bombs: battle ? 1 : BOMBS[ship], laser: ship === 2 ? 2 : 1, cores: this.mode === 'Battle' ? 3 : 0,
            score: 0, hits: 0, alive: true, out: false, invulnUntil: 2, respawnAt: 0, gold: 0 };
    }

    on(fn) { this.listeners.push(fn); }

    dispose() { clearInterval(this.timer); }

    get phase() {
        if (this.mode !== 'Campaign') return this.time < COUNTDOWN ? 'countdown' : this.state === 'Finished' ? 'done' : 'battle';
        if (this.boss?.down >= 0) return 'outro';
        if (this.time < INTRO) return 'intro';
        if (this.time < this.def.bossAt) return 'stage';
        if (this.time < this.def.bossAt + BOSS_INTRO) return 'bossIntro';
        return 'boss';
    }

    event(k, s, a = []) {
        this.events.push({ n: ++this.eventSeq, t: this.time, k, s, a });
    }

    report(r) {
        if (this.state !== 'Playing') return;
        const pilotOf = slot => this.pilots.find(p => p.slot === slot);
        for (const [slot, ...st] of r.s ?? []) { const p = pilotOf(slot); if (p) p.st = st; }
        for (const [slot, id, dmg] of r.h ?? []) this.hit(pilotOf(slot), id, dmg);
        for (const [slot, amount] of r.d ?? []) this.damage(pilotOf(slot), amount);
        for (const [slot, id] of r.p ?? []) this.pickup(pilotOf(slot), id);
        for (const [slot, ...a] of r.b ?? []) {
            const p = pilotOf(slot);
            if (p?.alive && p.bombs > 0) { p.bombs--; this.event('bomb', slot, a); }
        }
        for (const [slot, victim, kind] of r.v ?? []) this.versus(pilotOf(slot), pilotOf(victim), kind);
    }

    hit(p, id, dmg) {
        if (!p || this.mode !== 'Campaign') return;
        dmg = Math.max(0, Math.min(12, dmg | 0));
        if (id < 0) return this.bossHit(p, -1 - id, dmg);
        if (id >= DRONE_BASE) {
            if (this.phase !== 'boss' || this.dead.has(id)) return;
            this.kill(p, id, 50);
            return;
        }
        const wave = this.waves[id];
        if (!wave || this.dead.has(id) || this.time < wave.t - 6 || this.time > wave.t + 40) return;
        const hp = (this.hp.get(id) ?? KINDS[wave.kind].hp) - dmg;
        this.hp.set(id, hp);
        if (hp <= 0) {
            this.kill(p, id, KINDS[wave.kind].score);
            if (wave.kind === 'carrier') this.drops.add(DROP_BASE + id);
        }
    }

    kill(p, id, score) {
        this.dead.add(id);
        this.hp.delete(id);
        this.kills.push([id, this.time, p.slot]);
        p.score += score;
        p.hits += 1;
    }

    bossHit(p, part, dmg) {
        const b = this.boss;
        if (!b || this.phase !== 'boss' || b.down >= 0) return;
        const needs = this.def.bossDef.phases[b.phase];
        if (!needs?.includes(part) || b.hp[part] <= 0) return;
        b.hp[part] = Math.max(0, b.hp[part] - dmg);
        p.score += 10 * dmg;
        if (b.hp[part] > 0) return;
        p.score += 500;
        p.hits += 1;
        this.event('part', p.slot, [part]);
        if (needs.every(i => b.hp[i] <= 0)) {
            if (b.phase + 1 >= this.def.bossDef.phases.length) {
                b.down = this.time;
                for (const q of this.pilots) if (q.alive) q.score += 2000;
                p.score += 3000;
                p.hits += 5;
                this.event('bossdown', p.slot);
            } else {
                b.phase++;
                b.start = this.time + 1.5;
                this.event('phase', p.slot, [b.phase]);
            }
        }
    }

    damage(p, amount) {
        if (this.mode === 'Battle' || !p?.alive || this.time < p.invulnUntil || this.phase === 'intro' || this.phase === 'bossIntro' || this.phase === 'outro') return;
        amount = Math.max(0, Math.min(40, amount | 0));
        p.shield = Math.max(0, p.shield - amount);
        p.invulnUntil = this.time + .45;
        if (p.shield === 0) this.down(p, null);
    }

    down(p, by) {
        p.alive = false;
        this.event('down', p.slot, by ? [by.slot] : []);
        if (this.mode === 'Campaign') {
            if (p.bot) { p.respawnAt = this.time + 12; return; }
            p.lives--;
            if (p.lives > 0) p.respawnAt = this.time + 3;
            else p.out = true;
        } else if (this.mode === 'Battle') {
            p.out = true;
        } else {
            p.respawnAt = this.time + 2.5;
        }
    }

    pickup(p, id) {
        if (!p?.alive) return;
        let kind;
        if (this.mode === 'Campaign') {
            if (id >= DROP_BASE && id < DRONE_BASE) {
                if (!this.drops.has(id) || this.taken.has(id)) return;
                const wave = this.def.waves.flatMap(w => Array(w[3]).fill(w))[id - DROP_BASE];
                kind = wave?.[6]?.drop;
            } else {
                const def = this.def.pickups[id - PICKUP_BASE];
                if (!def || this.taken.has(id) || Math.abs(this.time - def[0]) > 8) return;
                kind = def[1];
            }
            if (kind !== 'gate') this.taken.set(id, this.time);
        } else {
            const def = LEVELS.arena.pickups[id - PICKUP_BASE];
            const at = this.taken.get(id);
            if (!def || (at !== undefined && this.time < at + LEVELS.arena.respawn)) return;
            kind = def[0];
            this.taken.set(id, this.time);
        }
        if (!kind) return;
        if (kind === 'ring') p.shield = Math.min(p.maxShield, p.shield + 30);
        else if (kind === 'gold') { p.shield = Math.min(p.maxShield, p.shield + 30); if (++p.gold % 3 === 0) p.lives = Math.min(9, p.lives + 1); }
        else if (kind === 'gate') { if (p.gate) return; p.gate = true; p.shield = Math.min(p.maxShield, p.shield + 50); }
        else if (kind === 'bomb') p.bombs = Math.min(9, p.bombs + 1);
        else if (kind === 'laser') p.laser = Math.min(3, p.laser + 1);
        this.event('pickup', p.slot, [id]);
    }

    versus(a, v, kind) {
        if (!a?.alive || !v?.alive || a === v || this.mode === 'Campaign' || this.phase !== 'battle' || this.time < v.invulnUntil) return;
        const dx = a.st[0] - v.st[0], dy = a.st[1] - v.st[1], dz = a.st[2] - v.st[2];
        const distance = Math.hypot(dx, dy, dz);
        if (distance > (kind === 3 ? 10 : 170)) return;
        if (kind === 0 && (v.st[6] & 8)) return;
        if (this.mode === 'Battle') {
            v.cores--;
            v.invulnUntil = this.time + 1.4;
            a.score += 100;
            a.hits++;
            if (kind === 3) a.cores = Math.min(5, a.cores + 1);
            this.event('pop', v.slot, [a.slot, kind]);
            if (v.cores <= 0) { a.score += 300; this.down(v, a); }
        } else {
            v.shield = Math.max(0, v.shield - [25, 60, 50, 30][kind]);
            v.invulnUntil = this.time + .35;
            a.score += 10;
            this.event('pop', v.slot, [a.slot, kind]);
            if (v.shield === 0) { a.score += 100; a.hits++; this.down(v, a); }
        }
    }

    step(dt) {
        if (this.state !== 'Playing') return;
        this.time += dt;
        for (const p of this.pilots) {
            if (!p.alive && !p.out && p.respawnAt && this.time >= p.respawnAt) {
                p.alive = true;
                p.shield = p.maxShield;
                p.invulnUntil = this.time + 2.5;
                if (this.mode === 'Campaign') p.laser = Math.max(p.ship === 2 ? 2 : 1, p.laser - 1);
                p.respawnAt = 0;
                this.event('respawn', p.slot);
            }
        }
        if (this.mode === 'Campaign') {
            if (!this.boss && this.time >= this.def.bossAt) {
                const humans = this.pilots.filter(p => !p.bot).length, bots = this.pilots.length - humans;
                const factor = 1 + .45 * (humans - 1) + .15 * bots;
                const max = this.def.bossDef.parts.map(([, hp]) => Math.max(1, Math.round(hp * factor * (this.weak ? .08 : 1))));
                this.boss = { phase: 0, start: this.def.bossAt + BOSS_INTRO, hp: [...max], max, down: -1 };
            }
            const humans = this.pilots.filter(p => !p.bot);
            if (humans.every(p => p.out)) {
                this.failAt ??= this.time;
                if (this.time > this.failAt + 3.5) this.finish(false);
            }
            if (this.boss?.down >= 0 && this.time > this.boss.down + OUTRO) this.finish(true);
        } else if (this.time >= COUNTDOWN) {
            const standing = this.pilots.filter(p => !p.out);
            if ((this.mode === 'Battle' && standing.length <= 1) || this.time >= COUNTDOWN + BATTLE_TIME) this.finish(true);
        }
        this.kills = this.kills.filter(k => this.time - k[1] < 3);
        this.events = this.events.filter(e => this.time - e.t < 2);
        const frame = this.frame();
        for (const fn of this.listeners) fn(frame);
    }

    finish(success) {
        this.state = 'Finished';
        this.success = success;
        if (this.mode === 'Battle') {
            const best = Math.max(...this.pilots.map(p => p.cores));
            this.winners = this.pilots.filter(p => p.cores === best && !p.out).map(p => p.slot);
            if (!this.winners.length) this.winners = this.pilots.filter(p => p.cores === best).map(p => p.slot);
        } else if (this.mode === 'Timed') {
            const best = Math.max(...this.pilots.map(p => p.score));
            this.winners = this.pilots.filter(p => p.score === best).map(p => p.slot);
        } else this.winners = [];
        const frame = this.frame();
        for (const fn of this.listeners) fn(frame);
        this.dispose();
    }

    frame() {
        this.frameCount = (this.frameCount ?? 0) + 1;
        return {
            code: 'LOKAL', state: this.state, mode: this.mode, mission: this.def?.id ?? -1, phase: this.phase, time: this.time,
            leader: 0, driver: 0, humans: 1,
            pilots: this.pilots.map(p => ({ slot: p.slot, name: p.name, bot: p.bot, ai: p.bot, connected: p.connected, ship: p.ship, st: p.st,
                shield: p.shield, maxShield: p.maxShield, lives: p.lives, bombs: p.bombs, laser: p.laser, cores: p.cores, score: p.score,
                hits: p.hits, alive: p.alive, out: p.out, invuln: this.time < p.invulnUntil, avatar: p.avatar })),
            kills: this.kills,
            dead: this.frameCount % 20 === 0 ? [...this.dead] : null,
            hurt: [...this.hp.entries()],
            taken: [...this.taken.entries()].filter(([, at]) => this.mode === 'Campaign' || this.time < at + LEVELS.arena.respawn).map(([id]) => id),
            boss: this.boss ? { ...this.boss, hp: [...this.boss.hp] } : null,
            events: this.events,
            success: this.success ?? null,
            winners: this.winners ?? []
        };
    }
}
