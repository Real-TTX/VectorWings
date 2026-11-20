// The deterministic part of a mission: which enemy flies where at mission time t, when it fires, where the pickups lie.
// Every client computes the same poses from Levels.json; the room only decides hit points, kills and pickups.
// Enemy ids are the running number over all waves (the room numbers them the same way), pickups 5000+, drops 6000+id.
import data from '../VectorWings.Core/Levels.json';

export const LEVELS = data;
export const KINDS = data.kinds;
export const PICKUP_BASE = 5000, DROP_BASE = 6000, DRONE_BASE = 100000;

export const HIT_RADIUS = { fighter: 2.4, ace: 2.5, bomber: 3.6, turret: 2.3, tank: 2.5, walker: 2.6, mine: 1.5, rock: 2.6, carrier: 3.6, drone: 1.5 };
export const CENTER_Y = { walker: 3.2, turret: 1.4, tank: .9 };
const SHOT = { fighter: 36, ace: 44, bomber: 30, turret: 38, tank: 34, walker: 36, drone: 34 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const easeOut = t => { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t); };
export function hash(n) {
    n = Math.imul(n ^ 0x5bd1e995, 0x27d4eb2d);
    n ^= n >>> 15;
    n = Math.imul(n, 0x165667b1);
    return ((n ^ (n >>> 13)) >>> 0) / 4294967296;
}

/** pose(e, τ, out) writes d (ahead of the rail anchor) or s (world anchored), x, y, yaw, pitch, roll; returns false when gone. */
const PATTERNS = {
    line: {
        delay: e => e.i * .42,
        life: 3.6,
        fires: e => e.i % 2 === 0 ? [1.05] : [],
        pose(e, t, o) {
            o.d = 175 - 62 * t;
            o.x = e.x + Math.sin(t * 1.6 + e.i) * 2.2;
            o.y = e.y + Math.sin(t * 2 + e.i * .7) * 1.3;
            o.yaw = Math.PI + Math.cos(t * 1.6 + e.i) * .25;
            o.pitch = 0;
            o.roll = Math.cos(t * 1.6 + e.i) * .5;
            return o.d > -30;
        }
    },
    vee: {
        delay: () => 0,
        life: 6.2,
        fires: e => [2.0 + .18 * e.i],
        pose(e, t, o) {
            const k = e.i - (e.n - 1) / 2;
            o.d = 190 - 128 * easeOut(t / 1.6) + Math.abs(k) * 6;
            o.x = e.x + k * 4.4 + Math.sin(t * 1.3) * 2.5;
            o.y = e.y + Math.abs(k) * .8;
            o.yaw = Math.PI;
            o.pitch = 0;
            o.roll = Math.sin(t * 1.3) * .2;
            if (t > 3.4) {
                const b = t - 3.4, side = k === 0 ? (e.id % 2 ? 1 : -1) : Math.sign(k);
                o.x += side * b * b * 16;
                o.y += b * b * 7;
                o.d += b * 34;
                o.roll = -side * Math.min(1.2, b * 1.4);
                o.yaw = Math.PI - side * Math.min(.9, b * .8);
            }
            return t < 6.2;
        }
    },
    swoop: {
        delay: e => e.i * .35,
        life: 5.4,
        fires: e => e.i % 2 ? [] : [3.25],
        pose(e, t, o) {
            const side = e.id % 2 ? 1 : -1;
            if (t < 1.8) {
                o.d = -32 + 70 * t;
                o.x = e.x + side * 3 + Math.sin(t * 2) * 2;
                o.y = e.y + 9 - 7 * ease(t / 1.8);
                o.yaw = 0; o.pitch = .2 * (1 - t / 1.8); o.roll = 0;
            } else if (t < 2.8) {
                const u = (t - 1.8);
                o.d = 94 + Math.sin(u * Math.PI) * 14;
                o.x = e.x + side * (3 + u * 9);
                o.y = e.y + 2 - u * 2;
                o.yaw = u * Math.PI * side; o.pitch = 0; o.roll = side * Math.sin(u * Math.PI) * 1.2;
            } else {
                const u = t - 2.8;
                o.d = 94 - 64 * u;
                o.x = e.x + side * (12 - u * 4);
                o.y = e.y + Math.sin(u * 2) * 1.5;
                o.yaw = Math.PI; o.pitch = 0; o.roll = 0;
            }
            return o.d > -30;
        }
    },
    cross: {
        delay: e => e.i * .45,
        life: 3.3,
        fires: e => e.i % 2 ? [1.4] : [],
        pose(e, t, o) {
            const side = e.opt.side ?? 1;
            o.x = -side * 70 + side * 46 * t;
            o.d = 72 + Math.sin(t * 1.3) * 8 + e.i * 3;
            o.y = e.y + Math.sin(t * 2.2 + e.i) * 3;
            o.yaw = side * Math.PI / 2 + side * .35;
            o.pitch = 0;
            o.roll = -side * .6;
            return t < 3.3;
        }
    },
    circle: {
        delay: e => e.i * .1,
        life: 7.2,
        fires: e => e.i % 2 ? [] : [2.6 + e.i * .25],
        pose(e, t, o) {
            const angle = e.i / e.n * Math.PI * 2 + t * 1.7;
            const r = 9 + (t > 5.4 ? (t - 5.4) * 14 : 0);
            o.d = 200 - 132 * easeOut(t / 1.5) + (t > 5.4 ? (t - 5.4) * 46 : 0);
            o.x = e.x + Math.cos(angle) * r;
            o.y = e.y + Math.sin(angle) * r * .62;
            o.yaw = Math.PI;
            o.pitch = 0;
            o.roll = angle + Math.PI / 2;
            return t < 7.2;
        }
    },
    hover: {
        delay: e => e.i * .6,
        life: 8.6,
        fires: () => [1.6, 2.7, 3.8, 4.9, 6.0],
        pose(e, t, o) {
            const k = e.i - (e.n - 1) / 2;
            o.d = 56 + k * 4;
            o.x = e.x + k * 11 + Math.sin(t * 1.15 + e.i) * 7;
            o.y = e.y - 20 + 20 * easeOut(t / 1.2) + Math.sin(t * 1.9) * 1.2;
            o.yaw = Math.PI;
            o.pitch = 0;
            o.roll = Math.cos(t * 1.15 + e.i) * .5;
            if (t > 7) { const b = t - 7; o.y += b * b * 11; o.d += b * 40; o.pitch = -.5; }
            return t < 8.6;
        }
    },
    chase: {
        delay: e => e.i * .5,
        life: 6.4,
        fires: () => [3.6, 4.3, 5.0],
        pose(e, t, o) {
            const k = e.i - (e.n - 1) / 2;
            if (t < 2.2) {
                o.d = -30 + 56 * t;
                o.x = e.x + k * 7 + Math.sin(t * 2) * 3;
                o.y = e.y + 3 + Math.sin(t * 1.5) * 2;
                o.yaw = 0; o.pitch = 0; o.roll = Math.cos(t * 2) * .5;
            } else if (t < 3.2) {
                const u = t - 2.2;
                o.d = 93 + Math.sin(u * Math.PI) * 12;
                o.x = e.x + k * 7 - Math.sign(k || 1) * u * 6;
                o.y = e.y + 3 + u * 3;
                o.yaw = u * Math.PI; o.pitch = 0; o.roll = Math.sin(u * Math.PI) * 1.3;
            } else {
                const u = t - 3.2;
                o.d = 93 - 46 * u;
                o.x = e.x + k * 7 - Math.sign(k || 1) * 6 + Math.sin(u * 2.5) * 5;
                o.y = e.y + 6 - u * 2;
                o.yaw = Math.PI; o.pitch = 0; o.roll = Math.cos(u * 2.5) * .6;
            }
            return o.d > -30;
        }
    },
    carrier: {
        delay: () => 0,
        life: 6.5,
        fires: () => [],
        pose(e, t, o) {
            const side = e.opt.side ?? (e.id % 2 ? 1 : -1);
            o.x = -side * 62 + side * 19 * t;
            o.d = 96 + Math.sin(t * .8) * 6;
            o.y = e.y + Math.sin(t * 1.4) * 1.5;
            o.yaw = side * Math.PI / 2;
            o.pitch = 0;
            o.roll = -side * .15;
            return t < 6.5;
        }
    },
    bomber: {
        delay: e => e.i * 1.1,
        life: 9.5,
        fires: () => [1.6, 3.2, 4.8, 6.2],
        pose(e, t, o) {
            const k = e.i - (e.n - 1) / 2;
            o.d = Math.max(64, 195 - 24 * t);
            o.x = e.x + k * 14 + Math.sin(t * .7) * 3;
            o.y = e.y + Math.sin(t * 1.1) * 1;
            o.yaw = Math.PI; o.pitch = 0; o.roll = Math.sin(t * .7) * .15;
            if (t > 7) { const b = t - 7; o.y += b * b * 7; o.d += b * 30; o.pitch = -.35; }
            return t < 9.5;
        }
    },
    ground: {
        world: true,
        delay: () => 0,
        life: 9,
        fires: e => { const p = hash(e.id) * 1.8; return [1.2 + p, 3.0 + p, 4.8 + p, 6.6 + p]; },
        pose(e, t, o) {
            const spacing = e.opt.spacing ?? 12;
            o.s = e.s0 + e.i * spacing;
            o.x = e.x + (e.n > 1 ? Math.sin(e.i * 1.7) * 5 : 0) + (e.kind === 'tank' ? Math.sin(t * .6 + e.i) * 4 : 0);
            o.y = e.y;
            o.yaw = Math.PI + (e.kind === 'tank' ? Math.cos(t * .6 + e.i) * .5 : 0);
            o.pitch = 0; o.roll = 0;
            return true;
        }
    },
    field: {
        world: true,
        delay: () => 0,
        life: 10,
        fires: () => [],
        pose(e, t, o) {
            const spacing = e.opt.spacing ?? 10, spread = e.opt.spread ?? 16;
            o.s = e.s0 + e.i * spacing;
            o.x = e.x + (hash(e.id * 3 + 1) * 2 - 1) * spread + Math.sin(t * .4 + e.id) * 1.2;
            o.y = e.y + (hash(e.id * 5 + 2) * 2 - 1) * spread * .45 + Math.sin(t * .9 + e.id) * .6;
            o.yaw = t * (hash(e.id) - .5) * 1.5; o.pitch = t * (hash(e.id + 9) - .5); o.roll = 0;
            return true;
        }
    }
};

export class Level {
    constructor(mission) {
        this.def = mission;
        this.speed = mission.speed;
        this.enemies = [];
        this.byId = new Map();
        let id = 0;
        for (const [t, kind, pattern, count, x, y, opt = {}] of mission.waves) {
            const spec = PATTERNS[pattern];
            for (let i = 0; i < count; i++) {
                const e = { id, kind, pattern: spec, patternName: pattern, i, n: count, x, y, opt, hp: KINDS[kind].hp, score: KINDS[kind].score,
                    t0: t + spec.delay({ i, id, n: count, opt }), s0: mission.speed * (t + 3.4), radius: HIT_RADIUS[kind], centerY: CENTER_Y[kind] ?? 0 };
                e.end = e.t0 + spec.life;
                e.fireTimes = spec.fires(e).map(time => e.t0 + time);
                this.enemies.push(e);
                this.byId.set(id, e);
                id++;
            }
        }
        this.pickups = mission.pickups.map(([t, kind, x, y], index) => ({ id: PICKUP_BASE + index, kind, t, s: mission.speed * t, x, y }));
        this.props = mission.props.map(([t, kind, x, y]) => ({ t, kind, s: mission.speed * t, x, y }));
        this.grounds = this.enemies.filter(e => e.pattern.world && e.kind !== 'mine' && e.kind !== 'rock')
            .map(e => { const o = {}; e.pattern.pose(e, 0, o); return { s: o.s, x: e.x + (e.n > 1 ? Math.sin(e.i * 1.7) * 5 : 0), y: e.y, kind: e.kind, id: e.id }; });
    }

    /** Pose of an enemy at mission time t; null before its start or after its end. `sRail` is the rail anchor at t. */
    pose(e, t, sRail, out = {}) {
        if (e.pattern.world) {
            if (t < e.t0 - 4) return null;
            e.pattern.pose(e, t - e.t0, out);
            out.d = out.s - sRail;
            if (out.d < -35 || out.d > 300) return null;
            return out;
        }
        if (t < e.t0 || t > e.end) return null;
        if (!e.pattern.pose(e, t - e.t0, out)) return null;
        out.s = sRail + out.d;
        return out;
    }

    shotSpeed(kind) {
        return SHOT[kind] ?? 36;
    }
}

export const missionById = id => data.missions.find(m => m.id === id);
