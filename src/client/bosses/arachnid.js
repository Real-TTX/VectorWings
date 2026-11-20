// Boss 4 · Arachnida: a four-legged siege walker striding through the ruins of Altglanz.
// Phase 1 its two grabber arms with cannons, phase 2 the glowing eye shield, phase 3 the red core eye behind it.
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Geo } from '../render/kit.js';
import { DRONE_BASE } from '../level.js';
import { BossBase, ease, every } from './base.js';

const STEEL = '#3a3d4a', STEEL_UP = '#565b6c', DARK = '#202128', RED = '#b8262f', RED_DARK = '#6e1622', BRASS = '#9a7a4a';
const HEIGHT = 14;
const LEGS = [
    { x: 6, z: 5, out: [1, .9], phase: 0 }, { x: -6, z: 5, out: [-1, .9], phase: Math.PI },
    { x: 6, z: -6, out: [1, -.8], phase: Math.PI }, { x: -6, z: -6, out: [-1, -.8], phase: 0 }
];

/** A segment along +x, built as a loft (geometry along z turned by yaw π/2). */
function limb(geo, length, w0, w1, color, colors) {
    geo.at({ yaw: Math.PI / 2 }, g => g.loft([
        { z: 0, w: w0 * .8, h: w0 * .8 }, { z: length * .15, w: w0, h: w0 }, { z: length * .85, w: w1, h: w1 }, { z: length, w: w1 * .7, h: w1 * .7 }
    ], 6, color, { colors }));
}

export class Arachnid extends BossBase {
    constructor(stage, def) {
        super(stage, def);
        const root = this.root;
        this.body = this.node('body', root, new Vector3(0, HEIGHT, 0));

        // Thorax, abdomen and the head with its eye socket
        const hull = new Geo({ vary: .05, seed: 71 });
        hull.loft([
            { z: 12, w: 5, h: 3.4, y: .6 }, { z: 9, w: 10, h: 6, y: .4 }, { z: 2, w: 13, h: 7.5 }, { z: -5, w: 12, h: 7, y: .3 }, { z: -8, w: 7, h: 4.6, y: .8 }
        ], 8, STEEL, { colors: (r, f) => f === 1 || f === 2 ? STEEL_UP : f >= 5 && f <= 6 ? DARK : r === 1 && (f === 0 || f === 3) ? RED : STEEL });
        hull.loft([
            { z: -7, w: 6, h: 5, y: 1.4 }, { z: -11, w: 12, h: 9, y: 2.6 }, { z: -18, w: 13, h: 9.5, y: 3 }, { z: -24, w: 8, h: 6, y: 2.4 }, { z: -27, w: 0, h: 0, y: 2 }
        ], 8, '#2c2e38', { colors: (r, f) => (f === 1 || f === 2) ? (r % 2 ? RED_DARK : '#3c3f4c') : '#2c2e38' });
        // Spines along the back and armour plates
        for (let i = 0; i < 5; i++) hull.at({ x: 0, y: 4.2 + (i > 1 ? 2 : 0), z: 4 - i * 6, pitch: -.4 }, g => g.cone(0, 1.6, 0, 1, 3.6, 4, DARK));
        hull.mirror(g => {
            g.box(6.6, .6, 2, 1, 4.2, 9, STEEL_UP, { top: STEEL });
            g.box(5.4, 3.6, -1, 3, 1, 8, RED_DARK);
            g.at({ x: 3, y: -3.2, z: 6, pitch: .3 }, m => m.cone(0, -1.4, 0, .8, 3, 4, BRASS));
        });
        this.mesh(hull, 'arachnid-hull', this.body, stage.flatShiny);
        const lights = new Geo({ vary: 0 });
        lights.mirror(g => { g.box(6.3, 1.6, 6.4, .3, .4, 3, '#ff4030'); g.box(5.8, 2.6, -14, .4, .4, 6, '#ff5a30'); });
        lights.box(0, 7.2, -16, .6, .6, 8, '#ff5a30');
        this.lights = this.glowMesh(lights, 'arachnid-lights', this.body, '#d8281c', .75);

        // Legs: hip (turned outward) → swing → thigh (lift) → knee → shin down to the street
        this.legs = LEGS.map((spec, i) => {
            const hip = this.node('hip' + i, this.body, new Vector3(spec.x, -1, spec.z));
            hip.rotation.y = Math.atan2(-spec.out[1], spec.out[0]);
            const swing = this.node('swing' + i, hip);
            const thigh = this.node('thigh' + i, swing);
            const t = new Geo({ vary: .05, seed: 80 + i });
            limb(t, 12, 2.6, 1.9, STEEL, (r, f) => f < 2 ? STEEL_UP : STEEL);
            t.ico(0, 0, 0, 2.1, DARK);
            this.mesh(t, 'thigh', thigh);
            const knee = this.node('knee' + i, thigh, new Vector3(12, 0, 0));
            const k = new Geo({ vary: .05, seed: 90 + i });
            k.ico(0, 0, 0, 1.9, RED_DARK);
            limb(k, 22, 2, 1, '#2e3038', (r, f) => r === 1 && f < 2 ? RED : f < 2 ? STEEL_UP : '#2e3038');
            k.at({ x: 22 }, f => f.cone(0, -.6, 0, 1.4, 2.4, 4, BRASS));
            this.mesh(k, 'shin', knee);
            return { spec, swing, thigh, knee };
        });

        // Parts 0/1: grabber arms with cannons
        this.arms = [-1, 1].map((side, i) => {
            const shoulder = this.node('shoulder' + i, this.body, new Vector3(5 * side, -2.4, 9.5));
            const a = new Geo({ vary: .05, seed: 100 + i });
            a.ico(0, 0, 0, 2, DARK);
            a.at({ pitch: .5 }, u => u.loft([{ z: 0, w: 2.4, h: 2.4 }, { z: 7, w: 1.8, h: 1.8 }, { z: 8, w: 1.4, h: 1.4 }], 6, STEEL, { colors: (r, f) => f < 2 ? STEEL_UP : STEEL }));
            this.mesh(a, 'upper-arm', shoulder);
            const fore = this.node('fore' + i, shoulder, new Vector3(0, -3.8, 7));
            const f = new Geo({ vary: .05, seed: 110 + i });
            f.ico(0, 0, 0, 1.6, RED_DARK);
            f.loft([{ z: 0, w: 2.2, h: 2.2 }, { z: 6, w: 2.8, h: 2.6 }, { z: 8, w: 2, h: 2 }], 6, RED_DARK, { colors: (r, ff) => ff < 2 ? RED : RED_DARK });
            for (const x of [-.6, .6]) f.at({ x, y: .4, z: 8, pitch: Math.PI / 2 }, b => b.cylinder(0, 1.6, 0, .3, 3.2, 6, DARK));
            // Claws
            for (const s of [-1, 1]) f.at({ x: s * 1.2, y: -1, z: 7.5, yaw: s * .5 }, c => c.at({ pitch: Math.PI / 2 }, cc => cc.cone(0, 1.4, 0, .5, 3, 4, BRASS)));
            this.mesh(f, 'fore-arm', fore);
            const glow = new Geo({ vary: 0 });
            glow.box(0, 1.35, 4, 1.8, .2, 3.2, '#ff4030');
            this.glowMesh(glow, 'arm-light', fore, '#d8281c', .8);
            this.part(i, fore, 3.2, new Vector3(0, 0, 4));
            return { shoulder, fore, side };
        });

        // Part 3: the core eye, part 2: the faceted eye shield in front of it
        this.core = this.node('core', this.body, new Vector3(0, .8, 11.6));
        const eye = new Geo({ vary: 0 });
        eye.ico(0, 0, 0, 2.3, '#ff2a20', { detail: 1 });
        this.eye = this.glowMesh(eye, 'core-eye', this.core, '#ff3420', 1.7);
        this.visor = this.node('visor', this.body, new Vector3(0, .8, 12.4));
        const v = new Geo({ vary: .06, seed: 120 });
        v.ico(0, 0, 0, 3.4, STEEL_UP, { sy: .8, sz: .55, colorOf: y => y > 1 ? '#6a7080' : STEEL });
        this.mesh(v, 'visor', this.visor, stage.flatShiny);
        const cracks = new Geo({ vary: 0 });
        cracks.ico(0, 0, .2, 3.5, '#ff8a3a', { sy: .82, sz: .5 });
        this.visorGlow = this.glowMesh(cracks, 'visor-glow', this.visor, '#e8501c', .55);
        this.part(2, this.visor, 3.6, new Vector3(0, 0, .6));
        this.part(3, this.core, 2.8);

        // Armour against lasers and the hull the ships crash into
        this.shield(this.node('thorax', this.body, new Vector3(0, .5, 2)), 6.5);
        this.shield(this.node('abdomen', this.body, new Vector3(0, 2.8, -17)), 7);
        this.shield(this.body, 7, new Vector3(0, 0, 2), this.hull);
        this.shield(this.body, 7.5, new Vector3(0, 2.8, -17), this.hull);
        this.applyScale(1.45);
    }

    pose(info) {
        const { rail, sRail, introU, fightT, phase, phaseT, hp, downT } = info;
        const time = this.stage.time;
        let d = 70, x = 0, y = 0, yaw = 0, pitch = 0, roll = 0, gait = time * 5.5, crouch = 0, rear = 0;
        if (introU !== null) {
            // Rises out of the ruins: legs unfold, the body lifts, then it rears up and roars.
            const rise = ease(introU / .55);
            y = -30 + 30 * rise;
            crouch = 1 - rise;
            rear = Math.sin(Math.max(0, introU - .55) / .45 * Math.PI) * .45;
            gait = introU * 6;
        } else {
            d = 68 + Math.sin(fightT * .3) * 6;
            x = Math.sin(fightT * .36) * 7;
            yaw = Math.cos(fightT * .36) * .12;
            if (phase >= 2) {
                d -= 6;
                gait = time * 7.5;
                const c = (phaseT - 2) % 7.5;
                if (phaseT > 2) {
                    if (c < .8) { crouch = ease(c / .8) * .6; rear = ease(c / .8) * .35; }
                    else if (c < 1.8) { d -= 30 * ease((c - .8) / 1); crouch = .6 - ease((c - .8) / 1) * .6; }
                    else if (c < 2.4) d -= 30;
                    else if (c < 4) d -= 30 * (1 - ease((c - 2.4) / 1.6));
                }
            }
        }
        if (downT >= 0) {
            crouch = Math.min(1.4, downT * .6);
            roll = downT * .18;
            pitch = downT * .08;
            y = -downT * downT * 1.6;
            gait = 0;
        }
        this.placeOnRail(rail, sRail, d, x, y, yaw, 0, roll);
        // Body bob and the rearing pose
        this.body.position.y = HEIGHT - crouch * 7 + Math.abs(Math.sin(gait)) * .7;
        this.body.rotation.x = -rear + pitch;
        for (const leg of this.legs) {
            const p = gait + leg.spec.phase;
            const lift = Math.max(0, Math.sin(p)) * .45;
            leg.swing.rotation.y = Math.cos(p) * .38 * (leg.spec.z > 0 ? 1 : -1);
            leg.thigh.rotation.z = .6 + lift + crouch * .45;
            leg.knee.rotation.z = -1.85 - lift * .4 - crouch * .5;
        }
        // Arms reach towards the squadron and recoil when they fire
        for (const [i, arm] of this.arms.entries()) {
            arm.shoulder.setEnabled(hp[i] > 0);
            arm.shoulder.rotation.x = .2 + Math.sin(time * 1.6 + i * 2) * .18 + (introU !== null ? (1 - introU) * .9 : 0);
            arm.shoulder.rotation.y = arm.side * (.15 + Math.sin(time * 1.1 + i) * .12);
            arm.fore.rotation.x = -.5 + Math.sin(time * 2.1 + i) * .15;
        }
        this.visor.setEnabled(hp[2] > 0);
        this.visorGlow.setEnabled(phase === 1);
        this.visorGlow.scaling.setAll(1 + Math.sin(time * 9) * .04);
        this.eye.scaling.setAll(1.1 + Math.sin(time * 10) * .12);
        // The glow layer ignores occlusion: the eye only shines once the shield is gone.
        this.eye.setEnabled(hp[2] <= 0);
        this.core.setEnabled(hp[3] > 0 || downT < 0);
        this.lights.setEnabled(downT < 0 || Math.sin(time * 30) > 0);
        this.refresh(this.def.bossDef.phases, phase, hp);
    }

    attacks(t0, t1, info, emit) {
        const { phase, phaseStart, hp } = info;
        if (info.downT >= 0) return;
        const stomp = k => {
            const origin = this.worldPoint(this.body, new Vector3(0, -6, 6));
            for (let j = 0; j < 14; j++) {
                const a = j / 14 * Math.PI * 2 + k * .4;
                emit({ origin, target: k, speed: 26, spreadX: Math.cos(a) * .42, spreadY: Math.sin(a) * .12 + .02 });
            }
        };
        if (phase === 0) {
            for (const [i, arm] of this.arms.entries()) {
                if (hp[i] <= 0) continue;
                for (let j = 0; j < 4; j++) every(t0, t1, phaseStart, 2.4, i * 1.2 + j * .12, k =>
                    emit({ origin: this.worldPoint(arm.fore, new Vector3(0, .4, 9.8)), target: k + i, speed: 42, spreadX: (j - 1.5) * .03 }));
            }
            every(t0, t1, phaseStart, 5.2, 2.6, stomp);
        } else if (phase === 1) {
            // Eye laser sweep: a dense line of shots swept across the avenue
            every(t0 - .8, t1, phaseStart, 3.8, 1, (k, start) => {
                const dir = k % 2 ? 1 : -1;
                for (let j = 0; j < 12; j++) every(t0, t1, start, 1000, j * .06, () =>
                    emit({ origin: this.worldPoint(this.visor, new Vector3(0, 0, 3.4)), target: k, speed: 52, spreadX: dir * (-.55 + j * .1), spreadY: -.04 }));
            });
            every(t0, t1, phaseStart, 5.6, 3.2, stomp);
        } else if (phase === 2) {
            every(t0, t1, phaseStart, 2.6, 1, k => {
                const origin = this.worldPoint(this.core, new Vector3(0, 0, 2.6));
                for (let j = 0; j < 10; j++) {
                    const a = j / 10 * Math.PI * 2 + k * .31;
                    emit({ origin, target: k, speed: 30, spreadX: Math.cos(a) * .34, spreadY: Math.sin(a) * .22 });
                }
            });
            every(t0, t1, phaseStart, 3.4, 2.2, k => {
                for (let j = 0; j < 2; j++)
                    emit({ kind: 'missile', id: DRONE_BASE + 40000 + k * 4 + j, origin: this.worldPoint(this.body, new Vector3(j ? 5 : -5, 5, -10)), target: k + j, speed: 30, side: j ? 1 : -1 });
            });
            every(t0, t1, phaseStart, 1.05, .5, k => emit({ origin: this.worldPoint(this.core, new Vector3(0, 0, 2.6)), target: k + 1, speed: 46 }));
        }
    }

    tick(dt, info, fx) {
        const random = Math.random;
        if (info.introU !== null && info.introU < .6 && random() < dt * 26)
            fx.burst(this.worldPoint(this.root, new Vector3((random() - .5) * 40, 1, (random() - .5) * 30)), 4, '#c9a48a', 18);
        // Dust where a foot touches the street
        if (info.introU === null && info.downT < 0) {
            for (const leg of this.legs) {
                const p = (this.stage.time * (info.phase >= 2 ? 7.5 : 5.5) + leg.spec.phase) % (Math.PI * 2);
                if (p > Math.PI * 1.9 && random() < dt * 40) fx.burst(this.worldPoint(leg.knee, new Vector3(22, 0, 0)), 3, '#b8957c', 12);
            }
        }
        for (const part of this.parts) if (part && !part.alive && info.downT < 0 && random() < dt * 5)
            fx.burst(part.pos, 2, '#ff9a4a', 8);
    }

    /** Boss intro camera: low on the street watching it rise, then a sweep round its front. */
    introShot(u) {
        if (u < .5) return { eye: { d: 20, x: -10, y: 3 }, look: { d: 70, x: 0, y: 6 + u * 44 } };
        const a = -.75 + (u - .5) * 2.4;
        return { eye: { d: 70 - 64 * Math.cos(a), x: 64 * Math.sin(a), y: 12 + (u - .5) * 22 }, look: { d: 70, x: 0, y: 17 } };
    }

    explosionPoints() {
        return [...this.parts.map(p => p.pos), ...this.hull.map(h => h.pos), ...this.legs.map(l => this.worldPoint(l.knee, new Vector3(6, 0, 0)))];
    }
}
