// Boss 3 · Trägerfregatte: a capital ship that warps in ahead of the squadron. Phase 1 four deck turrets,
// phase 2 the hangar door in the bow (missiles and flak), phase 3 the bridge core behind its armour shells.
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Geo } from '../render/kit.js';
import { DRONE_BASE } from '../level.js';
import { BossBase, ease, every } from './base.js';

const DECK = '#5a6070', SIDE = '#3d4250', BELLY = '#1d2028', RED = '#b8262f', RED_DARK = '#741722', BLACK = '#23252d', PALE = '#8a93a4';
const TURRETS = [[-8, 3.4, 11], [8, 3.4, 11], [-14, 3.8, -4], [14, 3.8, -4]];

export class Frigate extends BossBase {
    constructor(stage, def) {
        super(stage, def);
        const root = this.root;
        // Hull: a broad wedge with a flat deck (hexagon cross-section, flat on top).
        const hull = new Geo({ vary: .05, seed: 71 });
        hull.loft([
            { z: 24, w: 18, h: 7 }, { z: 12, w: 27, h: 8 }, { z: -6, w: 38, h: 9 }, { z: -20, w: 40, h: 9 }, { z: -28, w: 32, h: 7 }
        ], 6, SIDE, { twist: 0, colors: (r, f) => f === 1 ? (r === 1 ? PALE : DECK) : f === 4 ? BELLY : f === 3 || f === 5 ? BLACK : SIDE });
        hull.mirror(g => g.at({ x: 11.6, y: 2.2, z: 15, yaw: -.36 }, s => s.box(0, 0, 0, .4, 1.1, 15, RED)));
        // Flight-deck stripes and hull plating
        hull.box(0, 3.95, 4, 1.2, .1, 30, '#c9ced8');
        hull.mirror(g => {
            g.box(6, 3.95, 4, .5, .1, 26, '#e0b13a');
            g.box(17.5, 1, -14, 4, 3, 18, SIDE, { top: DECK });
            g.box(19.8, 1, -14, .4, 2, 16, RED);
            g.at({ x: 21, y: -1, z: -24 }, e => e.loft([{ z: 4, w: 0, h: 0 }, { z: 2, w: 4, h: 4 }, { z: -4, w: 4.6, h: 4.6 }, { z: -5, w: 3.6, h: 3.6 }], 8, BLACK));
        });
        // Bridge tower at the stern
        hull.box(0, 9.5, -16, 11, 12, 9, SIDE, { tx: .75, tz: .8, top: DECK });
        hull.box(0, 16.4, -17, 6, 2.2, 5, BLACK);
        hull.at({ x: 2, y: 20, z: -18 }, g => g.box(0, 0, 0, .3, 6, .3, BLACK));
        hull.at({ x: -2.2, y: 19, z: -18 }, g => g.box(0, 0, 0, .3, 4, .3, BLACK));
        hull.box(0, 4.2, -16, 14, 1.2, 12, DECK);
        this.mesh(hull, 'frigate-hull', root, stage.flatShiny);
        // Lights: engines, bridge windows, running lights
        const lights = new Geo({ vary: 0 });
        for (const x of [-9, 0, 9]) lights.at({ x, y: 0, z: -28.4, pitch: Math.PI / 2 }, g => g.cylinder(0, 0, 0, 3, .3, 8, '#2f86c8'));
        lights.mirror(g => { g.at({ x: 21, y: -1, z: -29.2, pitch: Math.PI / 2 }, e => e.cylinder(0, 0, 0, 1.6, .3, 8, '#2f86c8')); });
        lights.box(0, 14.2, -11.7, 7, .7, .2, '#ffb347');
        lights.mirror(g => { g.box(19.9, 2.6, -6, .3, .4, 10, '#ff3b3b'); g.box(9.3, 3.1, 18, .3, .3, 8, '#ff3b3b'); });
        this.engineGlow = this.glowMesh(lights, 'frigate-lights', root, '#ffffff', .85);

        // Parts 0–3: deck turrets
        this.turrets = TURRETS.map(([x, y, z], i) => {
            const node = this.node('turret' + i, root, new Vector3(x, y, z));
            const base = new Geo({ vary: .05, seed: 80 + i });
            base.cylinder(0, .3, 0, 2.2, 1.2, 8, BLACK, { radiusTop: 1.8 });
            this.mesh(base, 'turret-base', node);
            const head = this.node('turret-head' + i, node, new Vector3(0, 1.6, 0));
            const g = new Geo({ vary: .05, seed: 84 + i });
            g.box(0, 0, 0, 3.2, 1.8, 3.4, RED_DARK, { top: RED, tx: .8, tz: .8 });
            for (const bx of [-.6, .6]) g.at({ x: bx, z: 1.4, pitch: Math.PI / 2 }, b => b.cylinder(0, 1.8, 0, .28, 3.6, 6, BLACK));
            this.mesh(g, 'turret-head', head);
            const eye = new Geo({ vary: 0 });
            eye.box(0, .35, 1.72, 1.8, .35, .1, '#ff3b3b');
            this.glowMesh(eye, 'turret-eye', head, '#ff4040');
            this.part(i, node, 2.6, new Vector3(0, 1.6, 0));
            return { node, head };
        });

        // Part 4: hangar door in the bow face
        this.hangar = this.node('hangar', root, new Vector3(0, -.6, 24.1));
        const mouth = new Geo({ vary: 0 });
        mouth.box(0, 0, -.6, 11, 4.4, 1, '#ff6a3a');
        this.hangarGlow = this.glowMesh(mouth, 'hangar-glow', this.hangar, '#ff7a3a', 1.2);
        this.doors = [-1, 1].map(side => {
            const door = this.node('door', this.hangar, new Vector3(side * 2.85, 0, .1));
            const g = new Geo({ vary: .05, seed: 90 });
            g.box(0, 0, 0, 5.7, 4.6, .6, PALE, { front: '#6a7282' });
            g.box(side * -2.2, 0, .35, .5, 4, .1, '#e0b13a');
            this.mesh(g, 'door', door, stage.flatShiny);
            return { door, side };
        });
        this.part(4, this.hangar, 4.2, new Vector3(0, 0, .4));

        // Part 5: bridge core behind two shells on the tower front
        this.coreNode = this.node('core', root, new Vector3(0, 9.5, -10.6));
        const core = new Geo({ vary: 0 });
        core.ico(0, 0, 0, 2.6, '#7fd8ff', { detail: 1 });
        this.coreMesh = this.glowMesh(core, 'frigate-core', this.coreNode, '#6fd0ff', 1.6);
        this.shells = [-1, 1].map(side => {
            const hinge = this.node('shell', root, new Vector3(side * 3.6, 9.5, -10.9));
            const g = new Geo({ vary: .05, seed: 95 });
            g.box(-side * 1.8, 0, .9, 3.6, 6.4, 1.4, SIDE, { front: RED, top: DECK });
            this.mesh(g, 'shell', hinge, stage.flatShiny);
            return { hinge, side };
        });
        this.part(5, this.coreNode, 3.0);
        this.coreArmor = this.shield(this.coreNode, 4.0, new Vector3(0, 0, 1));

        // Hull spheres below the deck: they stop lasers and ram ships, the parts stick out above/in front.
        for (const [x, z, r] of [[0, 14, 5.5], [-9, 4, 5.5], [9, 4, 5.5], [0, 4, 5.5], [-14, -10, 5.5], [0, -10, 5.5], [14, -10, 5.5], [-12, -22, 5], [0, -22, 5], [12, -22, 5]])
            this.shield(this.node('hull', root, new Vector3(x, -2.2, z)), r, Vector3.Zero(), this.hull);
        this.shield(this.node('tower', root, new Vector3(0, 9, -17.5)), 5.2);
        this.applyScale(1.5);
        this.lastIntro = null;
    }

    pose(info) {
        const { rail, sRail, introU, fightT, phase, phaseT, hp, downT } = info;
        let d = 92, x = 0, y = -6, roll = 0, pitch = .3, yaw = .38, stretch = 1;
        if (introU !== null) {
            const warp = ease(introU / .35);
            d = 900 - 808 * warp;
            stretch = 1 + 7 * (1 - warp) * (1 - warp);
            const turn = ease((introU - .35) / .45);
            yaw = .38 * turn;
            pitch = .3 * turn;
            roll = Math.sin(introU * 6) * .06 * (1 - turn);
            y = -6 - 3 * (1 - turn);
        } else {
            d = 92 + Math.sin(fightT * .3) * 6;
            x = Math.sin(fightT * .25) * 8;
            y = -6 + Math.sin(fightT * .4) * 2;
            roll = Math.sin(fightT * .2) * .08;
            yaw = .38 + Math.sin(fightT * .15) * .14;
            if (phase >= 2) {
                d = 92 - 12 * ease(phaseT / 2) + Math.sin(fightT * .5) * 5;
                roll += Math.sin(fightT * .7) * .06;
                x = Math.sin(fightT * .35) * 10;
            }
        }
        if (downT >= 0) {
            y -= downT * downT * 1.6;
            roll += downT * .16;
            pitch += downT * .08;
        }
        this.placeOnRail(rail, sRail, d, x, y, yaw, pitch, roll);
        const s = this.scale ?? 1;
        this.root.scaling.set(s, s, s * stretch);
        for (const [i, t] of this.turrets.entries()) {
            t.node.setEnabled(hp[i] > 0);
            t.head.rotation.y = Math.sin((fightT ?? 0) * 1.1 + i * 1.7) * .5;
        }
        const open = phase === 1 ? ease(phaseT / 1) : phase > 1 ? 1 : 0;
        for (const { door, side } of this.doors) {
            door.position.x = side * (2.85 + open * 5.4);
            door.setEnabled(hp[4] > 0 || phase < 1);
        }
        this.hangarGlow.setEnabled(phase >= 1 && hp[4] > 0);
        const shellOpen = phase >= 2 ? ease(phaseT / 1.2) : 0;
        for (const { hinge, side } of this.shells) hinge.rotation.y = -side * shellOpen * 1.4;
        this.coreArmor.radius = phase >= 2 ? 0 : this.coreArmor.baseRadius;
        this.coreMesh.scaling.setAll(1 + Math.sin(this.stage.time * 7) * .07 * (phase >= 2 ? 1 : .3));
        this.coreNode.setEnabled(hp[5] > 0 || downT < 0);
        this.engineGlow.scaling.setAll(1);
        this.refresh(this.def.bossDef.phases, phase, hp);
    }

    attacks(t0, t1, info, emit) {
        const { phase, phaseStart, hp } = info;
        if (info.downT >= 0) return;
        if (phase === 0) {
            for (const [i, t] of this.turrets.entries()) {
                if (hp[i] <= 0) continue;
                for (let j = 0; j < 3; j++) every(t0, t1, phaseStart, 2.8, i * .7 + j * .15, k =>
                    emit({ origin: this.worldPoint(t.head, new Vector3(0, .3, 3.6)), target: k + i, speed: 40 }));
            }
            every(t0, t1, phaseStart, 6, 3, k => {
                const origin = this.worldPoint(this.root, new Vector3(0, 2, 25));
                for (let j = -4; j <= 4; j++) emit({ origin, target: k, speed: 32, spreadX: j * .12 });
            });
        } else if (phase === 1) {
            every(t0, t1, phaseStart, 3, 1.2, k => {
                for (let j = 0; j < 3; j++)
                    emit({ kind: 'missile', id: DRONE_BASE + 30000 + k * 4 + j, origin: this.worldPoint(this.hangar, new Vector3((j - 1) * 3, 0, 1)),
                        target: k + j, speed: 28, side: j === 1 ? (k % 2 ? 1 : -1) : j - 1 });
            });
            every(t0, t1, phaseStart, 1.3, .4, k => {
                const origin = this.worldPoint(this.root, new Vector3((k % 2 ? 1 : -1) * 14, 6, -4));
                emit({ origin, target: k, speed: 38, spreadY: .08 });
                emit({ origin, target: k, speed: 38, spreadY: -.08 });
            });
        } else if (phase === 2) {
            every(t0, t1, phaseStart, 2.6, 1.2, k => {
                const origin = this.worldPoint(this.coreNode, new Vector3(0, 0, 3));
                for (let j = 0; j < 12; j++) {
                    const a = j / 12 * Math.PI * 2 + k * .26;
                    emit({ origin, target: k, speed: 30, spreadX: Math.cos(a) * .34, spreadY: Math.sin(a) * .24 });
                }
            });
            // Sweeping wall: a line of shots fired from one flank to the other.
            for (let j = 0; j < 9; j++) every(t0, t1, phaseStart, 5.2, 3 + j * .09, k => {
                const dir = k % 2 ? 1 : -1;
                emit({ origin: this.worldPoint(this.root, new Vector3(0, 3, 25)), target: k, speed: 34, spreadX: dir * (j - 4) * .11, kind: 'big' });
            });
            every(t0, t1, phaseStart, 1, .5, k => emit({ origin: this.worldPoint(this.coreNode, new Vector3(0, 0, 3)), target: k + 1, speed: 44 }));
        }
    }

    tick(dt, info, fx) {
        const u = info.introU;
        if (u !== null) {
            if (u < .35 && Math.random() < dt * 40)
                fx.burst(this.worldPoint(this.root, new Vector3((Math.random() - .5) * 30, (Math.random() - .5) * 8, -20 - Math.random() * 20)), 2, '#bfe6ff', 40);
            if (this.lastIntro !== null && this.lastIntro < .35 && u >= .35) {
                const center = this.root.getAbsolutePosition().clone();
                fx.shockwave(center, 70, '#bfe0ff', .9);
                fx.shockwave(center, 45, '#7fb8ff', .6);
                fx.burst(center, 40, '#e6f4ff', 70);
                this.stage.flash = Math.max(this.stage.flash, .85);
                this.stage.shake = Math.max(this.stage.shake, 1.2);
            }
        }
        this.lastIntro = u;
        if (info.downT < 0) for (const part of this.parts)
            if (part && !part.alive && Math.random() < dt * 6) fx.burst(part.pos, 2, '#ff9a4a', 9);
    }

    introShot(u) {
        if (u < .35) return { eye: { d: -4, x: 9, y: 9 }, look: { d: 120 + 500 * (1 - ease(u / .35)), x: 0, y: -2 } };
        if (u < .62) return { eye: { d: 34, x: -36, y: -12 }, look: { d: 92, x: 0, y: -2 } };
        const a = -.75 + (u - .62) / .38 * 1.3;
        return { eye: { d: 92 - 64 * Math.cos(a), x: 64 * Math.sin(a), y: 6 + (u - .62) * 22 }, look: { d: 92, x: 0, y: 0 } };
    }

    explosionPoints() {
        return [...this.parts.filter(Boolean).map(p => p.pos), ...this.hull.map(h => h.pos)];
    }
}
