// Bot pilots: wingmen on the rail missions, opponents in the arena. They produce the same input as a human.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const FORMATION = [[0, 10, 0], [-11, 8, 8], [11, 7, 7], [5, 13, 18]];

export class Bot {
    constructor(slot) {
        this.slot = slot;
        this.target = null;
        this.retarget = 0;
        this.rollAt = 2 + slot;
        this.seed = slot * 977 + 13;
        this.burst = 0;
    }

    random() {
        this.seed = (this.seed * 16807) % 2147483647;
        return this.seed / 2147483647;
    }

    /** Rail wingman: keeps a formation lane and shoots what comes into it. */
    rail(dt, sim, ctx) {
        const [fx, fy, fd] = FORMATION[this.slot % 4];
        this.retarget -= dt;
        if (this.retarget <= 0) {
            this.retarget = .5 + this.random() * .4;
            let best = null, score = Infinity;
            for (const e of ctx.enemies) {
                if (e.d < 18 || e.d > 150) continue;
                const lane = Math.abs(e.x - fx) + Math.abs(e.y - fy) * .6;
                const value = lane + e.d * .15;
                if (lane < 16 && value < score) { score = value; best = e; }
            }
            this.target = best;
        }
        let tx = fx + Math.sin(ctx.t * .5 + this.slot) * 2, ty = fy + Math.cos(ctx.t * .4 + this.slot) * 1.5;
        const e = this.target && ctx.enemies.find(c => c.id === this.target.id);
        if (e) { tx = e.x; ty = e.y; }
        const input = { x: clamp((tx - sim.x) / 4, -1, 1), y: clamp((ty - sim.y) / 3, -1, 1), fire: false, charge: false, boost: sim.d < fd - 3,
            brake: sim.d > fd + 3, bomb: false, loop: false, tilt: 0, roll: 0 };
        if (e && Math.abs(e.x - sim.x) < 3 && Math.abs(e.y - sim.y) < 3) input.fire = true;
        if (ctx.boss && Math.abs((ctx.boss.x ?? 0) - sim.x) < 8) input.fire = this.random() < .7;
        if (ctx.threat && ctx.t > this.rollAt) { input.roll = this.random() < .5 ? -1 : 1; this.rollAt = ctx.t + 3 + this.random() * 4; }
        return input;
    }

    /** Arena opponent: hunts the nearest rival, leads the aim, rams from behind, keeps away from the ground. */
    arena(dt, sim, ctx) {
        let best = null, bestDistance = Infinity;
        for (const other of ctx.rivals) {
            const distance = Math.hypot(other.x - sim.px, other.y - sim.py, other.z - sim.pz);
            if (distance < bestDistance) { bestDistance = distance; best = other; }
        }
        const input = { x: 0, y: 0, fire: false, charge: false, boost: false, brake: false, bomb: false, loop: false, tilt: 0, roll: 0 };
        if (!best) { input.x = .3; return input; }
        const lead = bestDistance / 160;
        const ax = best.x + best.vx * lead - sim.px, ay = best.y + best.vy * lead - sim.py, az = best.z + best.vz * lead - sim.pz;
        let angle = Math.atan2(ax, az) - sim.heading;
        angle = Math.atan2(Math.sin(angle), Math.cos(angle));
        const flat = Math.hypot(ax, az);
        const pitch = Math.atan2(ay, flat);
        input.x = clamp(angle * 2.2, -1, 1);
        input.y = clamp((pitch - sim.climb) * 2.5, -1, 1);
        if (sim.py < 14) input.y = 1;
        if (Math.abs(angle) > 2.4 && bestDistance < 60 && this.random() < .02) input.loop = true;
        input.fire = Math.abs(angle) < .14 && Math.abs(pitch - sim.climb) < .2 && bestDistance < 150;
        input.boost = bestDistance > 90 || (bestDistance < 22 && Math.abs(angle) < .25);
        input.brake = bestDistance < 30 && Math.abs(angle) > .8;
        if (ctx.threatened && ctx.t > this.rollAt) { input.roll = this.random() < .5 ? -1 : 1; this.rollAt = ctx.t + 2 + this.random() * 3; }
        if (ctx.bombs > 0 && bestDistance < 70 && Math.abs(angle) < .2 && this.random() < .004) input.bomb = true;
        return input;
    }
}
