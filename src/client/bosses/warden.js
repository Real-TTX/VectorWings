// Boss 1 · Flusswächter: an armoured river gunboat. Phase 1 two bow cannons, phase 2 the missile bay, phase 3 the reactor
// behind its armour shells – then it rises on its hover jets and rams.
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Geo } from '../render/kit.js';
import { DRONE_BASE } from '../level.js';
import { BossBase, clamp, ease, every } from './base.js';

const STEEL = '#3e4452', STEEL_UP = '#5a6272', BELLY = '#1e222b', RED = '#b8262f', RED_DARK = '#741722', BLACK = '#24262e';

export class Warden extends BossBase {
    constructor(stage, def) {
        super(stage, def);
        const root = this.root;
        const hull = new Geo({ vary: .05, seed: 31 });
        hull.loft([
            { z: 15, w: 2, h: 1.2, y: 1.6 }, { z: 11, w: 9, h: 3.4, y: 1.6 }, { z: 2, w: 13.5, h: 4.4, y: 1.8 },
            { z: -8, w: 13.5, h: 4.4, y: 2 }, { z: -13.5, w: 10, h: 3.6, y: 2.2 }
        ], 6, STEEL, { colors: (r, f) => f === 3 || f === 4 ? BELLY : r === 1 && (f === 2 || f === 5) ? RED : f < 2 ? STEEL_UP : STEEL });
        hull.box(0, 4.4, -6.5, 10, 1.4, 11, '#4c5361', { top: STEEL_UP, tx: .9 });
        hull.box(0, 7.6, -10, 5.4, 5, 3.6, STEEL, { tx: .75, tz: .8, top: STEEL_UP });
        hull.box(0, 10.8, -10, 3.4, 1.4, 2.6, BLACK);
        hull.at({ x: 1.2, y: 13, z: -10.5 }, g => g.box(0, 0, 0, .25, 4, .25, BLACK));
        hull.at({ x: -1.2, y: 12.4, z: -10.5 }, g => g.box(0, 0, 0, .25, 2.8, .25, BLACK));
        hull.mirror(g => {
            g.loft([{ z: 11, w: 0, h: 0, x: 7.6, y: .9 }, { z: 8, w: 2.6, h: 2.2, x: 7.6, y: .9 }, { z: -10, w: 2.8, h: 2.4, x: 7.6, y: .9 }, { z: -12, w: 2, h: 1.6, x: 7.6, y: .9 }],
                6, BLACK, { colors: (r, f) => f < 2 ? '#3a3e48' : BLACK });
            g.box(5.4, 2.4, 3, 3, .8, 5, STEEL_UP);
            g.box(5.2, 3.6, -3.5, .9, 2.2, .9, RED_DARK);
        });
        this.mesh(hull, 'warden-hull', root, stage.flatShiny);
        const lights = new Geo({ vary: 0 });
        lights.box(0, 8.6, -8.15, 4.6, .5, .1, '#ffb347');
        lights.mirror(g => { g.box(7.6, .1, 0, .5, .3, 18, '#ff8a3a'); g.box(5.2, 4.8, -3.5, .5, .4, .5, '#ff3b3b'); });
        this.glowMesh(lights, 'warden-lights', root, '#ffffff', 1.0);

        // Parts 0/1: bow cannons
        this.cannons = [-1, 1].map((side, i) => {
            const node = this.node('cannon' + i, root, new Vector3(4.3 * side, 4.4, 7.6));
            const base = new Geo({ vary: .05, seed: 40 + i });
            base.cylinder(0, 0, 0, 1.7, 1.3, 8, BLACK, { radiusTop: 1.4 });
            this.mesh(base, 'cannon-base', node);
            const head = this.node('cannon-head' + i, node, new Vector3(0, 1.4, 0));
            const g = new Geo({ vary: .05, seed: 44 + i });
            g.box(0, 0, 0, 2.6, 1.7, 2.8, RED_DARK, { top: RED, tx: .8, tz: .85 });
            for (const x of [-.55, .55]) g.at({ x, z: 1.2, pitch: Math.PI / 2 }, b => b.cylinder(0, 1.6, 0, .26, 3.4, 6, BLACK));
            this.mesh(g, 'cannon-head', head);
            const glow = new Geo({ vary: 0 });
            glow.box(0, .3, 1.42, 1.6, .3, .1, '#ff3b3b');
            this.glowMesh(glow, 'cannon-eye', head, '#ff4040');
            this.part(i, node, 2.4, new Vector3(0, 1.4, 0));
            return { node, head, side };
        });

        // Part 2: missile bay with sliding lids
        this.bay = this.node('bay', root, new Vector3(0, 4.5, 1.5));
        const bay = new Geo({ vary: .05, seed: 51 });
        bay.box(0, 0, 0, 5.2, 1.2, 5.2, BLACK, { top: '#2f333d' });
        this.mesh(bay, 'bay', this.bay);
        const tubes = new Geo({ vary: 0 });
        for (const [x, z] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) tubes.cylinder(x, .55, z, .7, .1, 8, '#ff5a2a');
        this.bayGlow = this.glowMesh(tubes, 'bay-glow', this.bay, '#ff6a3a', 1.4);
        this.lids = [-1, 1].map(side => {
            const lid = this.node('lid', this.bay, new Vector3(side * 1.3, .75, 0));
            const g = new Geo({ vary: .05, seed: 52 });
            g.box(0, 0, 0, 2.6, .35, 5.2, STEEL_UP, { top: '#6a7282' });
            this.mesh(g, 'lid', lid);
            return { lid, side };
        });
        this.part(2, this.bay, 3.0, new Vector3(0, .6, 0));

        // Part 3: reactor core behind two armour shells
        this.coreNode = this.node('core', root, new Vector3(0, 6.6, -3.2));
        const core = new Geo({ vary: 0 });
        core.ico(0, 0, 0, 2.2, '#ff5530', { detail: 1 });
        this.coreMesh = this.glowMesh(core, 'core', this.coreNode, '#ff6a3a', 1.6);
        this.shells = [-1, 1].map(side => {
            const hinge = this.node('shell', root, new Vector3(side * 2.9, 5.2, -3.2));
            const g = new Geo({ vary: .05, seed: 60 });
            g.box(-side * 1.5, 1.6, 0, 3, 3.6, 5, STEEL, { top: STEEL_UP });
            g.box(-side * 1.5, 1.6, 2.55, 2.4, 2.6, .1, RED);
            this.mesh(g, 'shell', hinge, this.stage.flatShiny);
            return { hinge, side };
        });
        this.part(3, this.coreNode, 2.7);
        this.coreArmor = this.shield(this.coreNode, 3.4);
        this.shield(this.node('hull-a', root, new Vector3(0, 2.6, 9)), 5.2, Vector3.Zero(), this.hull);
        this.shield(this.node('hull-b', root, new Vector3(0, 3.2, 0)), 6.8, Vector3.Zero(), this.hull);
        this.shield(this.node('hull-c', root, new Vector3(0, 4.6, -9)), 6.4, Vector3.Zero(), this.hull);
        this.shield(this.node('bridge', root, new Vector3(0, 8, -10)), 3.6);
        this.y = -10;
        this.applyScale(1.55);
    }

    pose(info) {
        const { rail, sRail, introU, fightT, phase, phaseT, hp, downT } = info;
        let d = 66, x = 0, y = 1.4, roll = 0, pitch = 0, yaw = 0;
        if (introU !== null) {
            y = -10 + 11.4 * ease(introU / .55);
            roll = Math.sin(introU * 9) * .04 * (1 - introU);
            pitch = (1 - ease(introU / .55)) * -.25;
        } else {
            d = 64 + Math.sin(fightT * .33) * 6;
            x = Math.sin(fightT * .42) * 9;
            y = 1.4 + Math.sin(fightT * 1.6) * .3;
            roll = Math.sin(fightT * .42 + 1) * .05;
            if (phase >= 2) {
                y += 5 * ease(phaseT / 1.5);
                x = Math.sin(fightT * .6) * 11;
                const c = (phaseT - 2) % 7;
                if (phaseT > 2) {
                    if (c < .7) roll += Math.sin(c * 60) * .03;
                    else if (c < 1.6) d = 64 - 26 * ease((c - .7) / .9);
                    else if (c < 2.2) d = 38;
                    else if (c < 3.7) d = 38 + 26 * ease((c - 2.2) / 1.5);
                    yaw = c > .7 && c < 2.2 ? Math.sin(fightT * 3) * .05 : 0;
                }
            }
        }
        if (downT >= 0) {
            y -= downT * downT * 2.2;
            roll += downT * .22;
            pitch -= downT * .1;
        }
        this.placeOnRail(rail, sRail, d, x, y, yaw, pitch, roll);
        // Cannons track their target, the bay lids open in phase 2, the shells in phase 3.
        for (const [i, c] of this.cannons.entries()) {
            c.node.setEnabled(hp[i] > 0);
            c.head.rotation.y = Math.sin((fightT ?? 0) * 1.3 + i * 2) * .4;
        }
        const bayOpen = phase === 1 ? ease(phaseT / .8) : 0;
        for (const { lid, side } of this.lids) lid.position.x = side * (1.3 + bayOpen * 2.4);
        this.bayGlow.setEnabled(phase === 1);
        this.bay.setEnabled(hp[2] > 0 || phase < 1);
        const shellOpen = phase >= 2 ? ease(phaseT / 1.2) : 0;
        for (const { hinge, side } of this.shells) hinge.rotation.z = side * shellOpen * 1.35;
        this.coreArmor.radius = phase >= 2 ? 0 : this.coreArmor.baseRadius;
        this.coreMesh.scaling.setAll(1 + Math.sin(this.stage.time * 8) * .06 * (phase >= 2 ? 1 : .3));
        this.coreNode.setEnabled(hp[3] > 0 || downT < 0);
        this.refresh(this.def.bossDef.phases, phase, hp);
    }

    /** Deterministic attacks in (t0, t1]; `emit` takes { origin, target, speed, spreadX, spreadY, kind, id }. */
    attacks(t0, t1, info, emit) {
        const { phase, phaseStart, hp } = info;
        if (info.downT >= 0) return;
        if (phase === 0) {
            for (const [i, c] of this.cannons.entries()) {
                if (hp[i] <= 0) continue;
                for (let j = 0; j < 3; j++) every(t0, t1, phaseStart, 2.6, i * 1.3 + j * .16, k =>
                    emit({ origin: this.worldPoint(c.head, new Vector3(0, .3, 3.2)), target: k + i, speed: 42 }));
            }
            every(t0, t1, phaseStart, 6.5, 3, k => {
                const origin = this.worldPoint(this.root, new Vector3(0, 3, 14));
                for (let j = -3; j <= 3; j++) emit({ origin, target: k, speed: 34, spreadX: j * .14 });
            });
        } else if (phase === 1) {
            every(t0, t1, phaseStart, 3.2, 1, k => {
                for (let j = 0; j < 2; j++)
                    emit({ kind: 'missile', id: DRONE_BASE + 10000 + k * 4 + j, origin: this.worldPoint(this.bay, new Vector3(j ? 1.2 : -1.2, 1, 0)), target: k + j, speed: 30, side: j ? 1 : -1 });
            });
            every(t0, t1, phaseStart, 1.5, .4, k => emit({ origin: this.worldPoint(this.root, new Vector3(0, 9, -8)), target: k, speed: 40 }));
        } else if (phase === 2) {
            every(t0, t1, phaseStart, 2.9, 1.2, k => {
                const origin = this.worldPoint(this.coreNode, new Vector3(0, 0, 2.5));
                for (let j = 0; j < 10; j++) {
                    const a = j / 10 * Math.PI * 2 + k * .3;
                    emit({ origin, target: k, speed: 30, spreadX: Math.cos(a) * .32, spreadY: Math.sin(a) * .22 });
                }
            });
            every(t0, t1, phaseStart, 1.1, .5, k => emit({ origin: this.worldPoint(this.coreNode, new Vector3(0, 0, 2.5)), target: k + 1, speed: 44 }));
        }
    }

    tick(dt, info, fx) {
        if (info.introU !== null && info.introU < .6 && Math.random() < dt * 30)
            fx.burst(this.worldPoint(this.root, new Vector3((Math.random() - .5) * 16, 1, (Math.random() - .5) * 26)), 3, '#dff6ff', 16);
        if (info.introU === null && info.downT < 0 && Math.random() < dt * 14)
            fx.burst(this.worldPoint(this.root, new Vector3((Math.random() - .5) * 14, -.5, -13)), 2, '#e6fbff', 10);
        for (const part of this.parts) if (!part.alive && part.node.isEnabled() === false && Math.random() < dt * 4)
            fx.explode(part.pos, .3, Vector3.ZeroReadOnly, '#333');
    }

    /** Camera of the boss intro (u = 0..1): rail-relative eye and look points. */
    introShot(u) {
        if (u < .5) return { eye: { d: 24, x: -14, y: 2.6 }, look: { d: 66, x: 0, y: 4 + u * 10 } };
        const a = -.6 + (u - .5) * 2.4;
        return { eye: { d: 66 - 44 * Math.cos(a), x: 44 * Math.sin(a), y: 6 + (u - .5) * 14 }, look: { d: 66, x: 0, y: 8 } };
    }

    explosionPoints() {
        return [...this.parts.map(p => p.pos), ...this.hull.map(h => h.pos)];
    }
}

void clamp;
