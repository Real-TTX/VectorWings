// The flight model of one ship, simulated by the client that owns it (its human, or the bot driver for the bots).
// Rail missions: x/y across the rail, d ahead of the rail anchor. Arena: free flight in world space.
import { SHIPS } from '../render/models.js';

export const FLAG = { FIRE: 1, BOOST: 2, BRAKE: 4, ROLL: 8, LOOP: 16, CHARGE: 32, TILT: 64, HYPER: 128 };
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const ROLL_TIME = .55, LOOP_TIME = 1.75, UTURN_TIME = 1.5;

export class PilotSim {
    constructor(slot, design, { arena = false, bounds = [20, 2.6, 24], field } = {}) {
        this.slot = slot;
        this.design = design;
        this.spec = SHIPS[design] ?? SHIPS[0];
        this.arena = arena;
        this.bounds = bounds;
        this.field = field;
        this.x = [0, -10, 10, 0][slot % 4]; this.y = [10, 9, 8, 16][slot % 4]; this.d = [0, 6, 5, 10][slot % 4];
        this.vx = 0; this.vy = 0;
        this.yaw = 0; this.aimUp = 0; this.bank = 0; this.spin = 0; this.loopAngle = 0;
        this.rollT = -1; this.rollDir = 1; this.loopT = -1; this.tilt = 0;
        this.meter = 1; this.overheat = false; this.boosting = false; this.braking = false;
        this.fireCd = 0; this.charge = 0; this.charged = false; this.firing = false; this.muzzle = 0;
        // arena
        this.px = 0; this.py = 26; this.pz = 0; this.heading = 0; this.climb = 0; this.speed = 34; this.uturnT = -1; this.uturnFrom = 0; this.autoTurn = 0;
        this.controlled = true;
    }

    placeArena(x, y, z, heading) {
        this.px = x; this.py = y; this.pz = z; this.heading = heading; this.climb = 0; this.speed = 34;
    }

    get lateral() { return 18 + 12 * this.spec.agility; }
    get vertical() { return 14 + 9 * this.spec.agility; }
    get rolling() { return this.rollT >= 0; }
    get looping() { return this.loopT >= 0 || this.uturnT >= 0; }

    /** Advances the ship; returns the actions of this frame: { shots: n, charged: bool, bomb: bool }. */
    update(dt, input, { canFire = true } = {}) {
        const actions = { fire: false, chargedShot: false, bomb: false, rolled: false, looped: false };
        if (!this.controlled) input = { x: 0, y: 0, fire: false, charge: false, boost: false, brake: false, bomb: false, loop: false, tilt: 0, roll: 0 };
        // Boost and brake share one meter; emptying it overheats the engines for a moment.
        const wantBoost = input.boost && !this.overheat, wantBrake = input.brake && !input.boost && !this.overheat;
        this.boosting = wantBoost && this.meter > 0;
        this.braking = wantBrake && this.meter > 0;
        if (this.boosting || this.braking) this.meter -= dt * (this.boosting ? .5 : .42);
        else this.meter = Math.min(1, this.meter + dt * .28);
        if (this.meter <= 0) { this.meter = 0; this.overheat = true; }
        if (this.overheat && this.meter > .4) this.overheat = false;

        if (input.roll && this.rollT < 0 && !this.looping) { this.rollT = 0; this.rollDir = input.roll; actions.rolled = true; }
        if (this.rollT >= 0) {
            this.rollT += dt;
            this.spin = -this.rollDir * TAU * ease(this.rollT / ROLL_TIME);
            if (this.rollT >= ROLL_TIME) { this.rollT = -1; this.spin = 0; }
        }
        this.tilt += ((input.tilt || 0) - this.tilt) * Math.min(1, dt * 9);

        if (this.arena) this.flyArena(dt, input, actions);
        else this.flyRail(dt, input, actions);

        // Weapons
        this.fireCd -= dt;
        this.firing = false;
        if (canFire && input.fire && this.fireCd <= 0 && !this.charging) {
            this.fireCd = .13;
            this.firing = true;
            actions.fire = true;
            this.muzzle = 1 - this.muzzle;
        }
        if (canFire && input.charge) {
            this.charging = true;
            this.charge = Math.min(1, this.charge + dt / (.85 - this.spec.agility * .3));
            this.charged = this.charge >= 1;
        } else {
            if (this.charged && canFire) actions.chargedShot = true;
            this.charging = false;
            this.charge = 0;
            this.charged = false;
        }
        if (canFire && input.bomb) actions.bomb = true;
        return actions;
    }

    flyRail(dt, input, actions) {
        const [xMax, yMin, yMax] = this.bounds;
        const lat = this.lateral, vert = this.vertical;
        if (input.loop && this.loopT < 0 && this.rollT < 0 && this.meter > .35) {
            this.loopT = 0; this.loopY = this.y; this.loopD = this.d; this.meter -= .35; actions.looped = true;
        }
        let tx = input.x * lat;
        if (this.tilt && Math.sign(input.x) === Math.sign(this.tilt)) tx *= 1.55;
        if (this.rollT >= 0) tx += this.rollDir * 13;
        const ty = input.y * vert;
        this.vx += (tx - this.vx) * Math.min(1, dt * 5.5);
        this.vy += (ty - this.vy) * Math.min(1, dt * 5.5);
        this.x += this.vx * dt;
        if (Math.abs(this.x) > xMax) { this.x = Math.sign(this.x) * xMax; this.vx *= .3; }
        if (this.loopT >= 0) {
            this.loopT += dt;
            const theta = TAU * ease(this.loopT / LOOP_TIME);
            this.loopAngle = theta;
            this.d = this.loopD + 12 * Math.sin(theta);
            this.y = this.loopY + 12 * (1 - Math.cos(theta));
            if (this.loopT >= LOOP_TIME) { this.loopT = -1; this.loopAngle = 0; }
        } else {
            this.y += this.vy * dt;
            if (this.y > yMax) { this.y = Math.max(yMax, this.y - dt * 20); this.vy = Math.min(0, this.vy); }
            if (this.y < yMin) { this.y = yMin; this.vy = Math.max(0, this.vy); }
            const target = this.boosting ? 10 : this.braking ? -8 : 0;
            this.d += (target - this.d) * Math.min(1, dt * 1.9);
        }
        this.yaw = this.vx / lat * .42;
        this.aimUp = this.vy / vert * .3;
        const bank = -this.vx / lat * .85 + this.tilt * 1.35;
        this.bank += (bank - this.bank) * Math.min(1, dt * 8);
    }

    flyArena(dt, input, actions) {
        const field = this.field;
        const top = 34 + 16 * this.spec.speed;
        const target = this.boosting ? top * 1.65 : this.braking ? top * .5 : top;
        this.speed += (target - this.speed) * Math.min(1, dt * 2.4);
        const r = Math.hypot(this.px, this.pz);
        // Leaving the field turns the ship back in automatically (like a U-turn).
        if (this.uturnT < 0 && (r > field.radius - 12 && (this.px * Math.sin(this.heading) + this.pz * Math.cos(this.heading)) > 0)) {
            this.autoTurn = 1;
        }
        if ((input.loop || this.autoTurn) && this.uturnT < 0 && this.rollT < 0) {
            this.uturnT = 0;
            this.uturnFrom = this.heading;
            const inward = Math.atan2(-this.px, -this.pz);
            let delta = this.autoTurn ? inward - this.heading : Math.PI;
            delta = Math.atan2(Math.sin(delta), Math.cos(delta));
            if (!this.autoTurn) delta = Math.PI * (input.x < 0 ? -1 : 1);
            this.uturnDelta = delta;
            this.uturnY = this.py;
            this.autoTurn = 0;
            actions.looped = true;
        }
        if (this.uturnT >= 0) {
            this.uturnT += dt;
            const u = clamp(this.uturnT / UTURN_TIME, 0, 1);
            this.heading = this.uturnFrom + this.uturnDelta * ease(u);
            this.loopAngle = Math.sin(u * Math.PI) * 1.1;
            this.climb = Math.cos(u * Math.PI) * .25;
            const lift = this.uturnY > field.ceiling - 22 ? -1 : 1;
            this.py = this.uturnY + lift * Math.sin(u * Math.PI) * 9;
            this.speed = Math.min(this.speed, top * .8);
            if (u >= 1) { this.uturnT = -1; this.loopAngle = 0; }
        } else {
            const turn = 1.45 + .7 * this.spec.agility;
            const rate = input.x * turn * (this.tilt && Math.sign(input.x) === Math.sign(this.tilt) ? 1.6 : 1);
            this.heading += rate * dt;
            const climbTarget = input.y * .85;
            this.climb += (climbTarget - this.climb) * Math.min(1, dt * 3.2);
            this.py += Math.sin(this.climb) * this.speed * dt;
        }
        const strafe = this.rollT >= 0 ? this.rollDir * 14 : 0;
        const c = Math.cos(this.climb);
        this.px += (Math.sin(this.heading) * c * this.speed + Math.cos(this.heading) * strafe) * dt;
        this.pz += (Math.cos(this.heading) * c * this.speed - Math.sin(this.heading) * strafe) * dt;
        if (this.py > field.ceiling) { this.py = field.ceiling; this.climb = Math.min(0, this.climb); }
        this.yaw = 0;
        this.aimUp = this.climb;
        const bank = -input.x * .85 + this.tilt * 1.3;
        this.bank += (bank - this.bank) * Math.min(1, dt * 6);
    }

    /** Direction of the guns. Rail: { s, x, y } relative to the rail; arena: world { x, y, z }. */
    aim() {
        if (this.arena) {
            const c = Math.cos(this.climb);
            return { x: Math.sin(this.heading) * c, y: Math.sin(this.climb), z: Math.cos(this.heading) * c };
        }
        const p = this.aimUp + this.loopAngle;
        return { s: Math.cos(this.yaw) * Math.cos(p), x: Math.sin(this.yaw) * Math.cos(p), y: Math.sin(p) };
    }

    flags(laser = 1) {
        return (this.firing ? FLAG.FIRE : 0) | (this.boosting ? FLAG.BOOST : 0) | (this.braking ? FLAG.BRAKE : 0) |
            (this.rolling ? FLAG.ROLL : 0) | (this.looping ? FLAG.LOOP : 0) | (this.charging ? FLAG.CHARGE : 0) |
            (Math.abs(this.tilt) > .5 ? FLAG.TILT : 0) | (laser >= 3 ? FLAG.HYPER : 0);
    }

    /** The state sent to the room: [x, y, z|d, yaw, pitch, roll, flags, meter]. */
    state(laser) {
        const r = n => Math.round(n * 100) / 100;
        if (this.arena) return [r(this.px), r(this.py), r(this.pz), r(this.heading), r(-this.climb - this.loopAngle), r(this.bank + this.spin), this.flags(laser), r(this.speed)];
        return [r(this.x), r(this.y), r(this.d), r(this.yaw), r(-this.aimUp - this.loopAngle), r(this.bank + this.spin), this.flags(laser), r(this.meter)];
    }

    /** Respawn at a place (rail: formation; arena: spawn point). */
    reset(x, y, d = 0) {
        if (this.arena) { this.placeArena(x, y, d, Math.atan2(-x, -d)); }
        else { this.x = x; this.y = y; this.d = d; }
        this.vx = this.vy = 0; this.rollT = this.loopT = this.uturnT = -1; this.spin = 0; this.loopAngle = 0; this.meter = 1; this.overheat = false;
        this.charge = 0; this.charged = false;
    }
}
