// Boss 2 · Sandbohrer: a giant segmented drill worm that breaches the sand ahead of the squadron and swims in arcs.
// Phase 1 the three glowing vent plates on its back, phase 2 the spinning drill head, phase 3 the glowing core inside the
// opened head – then it lunges at the squadron.
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Geo, shade } from '../render/kit.js';
import { DRONE_BASE } from '../level.js';
import { BossBase, ease, every } from './base.js';

const HIDE = '#8c5038', HIDE_DARK = '#5a3428', BELLY = '#c99a6a', PLATE = '#5c3a30', RUST = '#a0502e', METAL = '#3a3640';
const SEGMENTS = 11;
const VENTS = [2, 3, 5];
const SCALE = 1.7;
const LENGTH = 70;

function radiusOf(i) {
    return i === 0 ? 4.3 : 4.0 - (i - 1) * .2;
}

export class Borer extends BossBase {
    constructor(stage, def) {
        super(stage, def);
        this.segments = [];
        for (let i = 1; i < SEGMENTS; i++) {
            const node = this.node('seg' + i);
            node.rotationQuaternion = new Quaternion();
            const r = radiusOf(i);
            const g = new Geo({ vary: .06, seed: 70 + i });
            g.loft([
                { z: 2.6, w: r * 1.55, h: r * 1.5 }, { z: 1.2, w: r * 2, h: r * 1.95 }, { z: -1.2, w: r * 2, h: r * 1.95 }, { z: -2.6, w: r * 1.5, h: r * 1.45 }
            ], 8, HIDE, { colors: (ring, face) => face === 5 || face === 6 ? BELLY : face === 1 || face === 2 ? (ring === 1 ? HIDE_DARK : PLATE) : ring === 1 ? HIDE : shade(HIDE, .88) });
            // Back plates and spikes
            g.box(0, r * .95, 0, r * .9, .7, 3.6, PLATE, { top: shade(PLATE, 1.2), tx: .7 });
            g.at({ y: r * 1.1, z: -.4, pitch: -.5 }, s => s.cone(0, 1, 0, .6, 2.6, 4, RUST));
            g.mirror(m => m.at({ x: r * .95, y: -r * .2, z: 0, roll: -.9 }, s => s.cone(0, .9, 0, .5, 2.2, 4, METAL)));
            this.mesh(g, 'seg', node, stage.flatShiny);
            const entry = { node, r, vent: null };
            const ventIndex = VENTS.indexOf(i);
            if (ventIndex >= 0) {
                const vent = this.node('vent' + i, node, new Vector3(0, r * 1.05, 0));
                const frame = new Geo({ vary: .04, seed: 90 + i });
                frame.box(0, 0, 0, r * 1.5, .8, 3.8, METAL, { top: '#2a262e' });
                this.mesh(frame, 'vent-frame', vent);
                const glow = new Geo({ vary: 0 });
                for (const z of [-1.1, 0, 1.1]) glow.box(0, .45, z, r * 1.2, .12, .55, '#ffb347');
                glow.mirror(m => m.box(r * .9, -.9, 0, .2, 1.2, 2.6, '#ff7a2a'));
                entry.ventGlow = this.glowMesh(glow, 'vent-glow', vent, '#ffa03a', 1.5);
                entry.vent = vent;
                this.part(ventIndex, vent, 3.0, new Vector3(0, .3, 0));
            }
            this.shield(node, r * .75, Vector3.Zero(), this.hull);
            this.segments.push(entry);
        }

        // Head: armoured collar, three petals around the drill, the core inside.
        const head = this.head = this.node('head');
        head.rotationQuaternion = new Quaternion();
        const r = radiusOf(0);
        const collar = new Geo({ vary: .06, seed: 80 });
        collar.loft([{ z: -2.8, w: r * 1.7, h: r * 1.7 }, { z: -.8, w: r * 2.2, h: r * 2.2 }, { z: .6, w: r * 2.1, h: r * 2.1 }], 8, HIDE,
            { colors: (ring, face) => face === 5 || face === 6 ? BELLY : ring === 1 ? HIDE_DARK : HIDE });
        this.mesh(collar, 'collar', head, stage.flatShiny);
        const mouth = new Geo({ vary: 0 });
        mouth.at({ z: .7, pitch: Math.PI / 2 }, g => g.cylinder(0, 0, 0, r * .95, .3, 10, '#ff6a2a'));
        this.mouthGlow = this.glowMesh(mouth, 'mouth', head, '#ff7a3a', 1.2);
        this.petals = [0, 1, 2].map(k => {
            const hinge = this.node('petal' + k, head, new Vector3(0, 0, .6));
            hinge.rotation.z = k * Math.PI * 2 / 3;
            const leaf = this.node('leaf', hinge);
            const g = new Geo({ vary: .05, seed: 84 + k });
            // A curved wedge from the collar rim to the tip, covering a third of the cone.
            const rim = r * 1.02, tip = 7.5;
            const a0 = -Math.PI / 3 + .04, a1 = Math.PI / 3 - .04;
            const p = (a, rad, z) => [Math.sin(a) * rad, Math.cos(a) * rad, z];
            const inside = [0, 0, 2.5];
            for (let s = 0; s < 3; s++) {
                const u0 = a0 + (a1 - a0) * s / 3, u1 = a0 + (a1 - a0) * (s + 1) / 3;
                g.quad(p(u0, rim, 0), p(u1, rim, 0), p(u1, rim * .45, tip * .6), p(u0, rim * .45, tip * .6), s === 1 ? RUST : PLATE, inside);
                g.tri(p(u0, rim * .45, tip * .6), p(u1, rim * .45, tip * .6), [0, .2, tip], shade(PLATE, 1.15), inside);
                g.quad(p(u0, rim * .8, 0), p(u1, rim * .8, 0), p(u1, rim * .3, tip * .58), p(u0, rim * .3, tip * .58), HIDE_DARK, [0, rim * 3, 2]);
            }
            g.at({ y: rim * .7, z: 2.2, pitch: .35 }, s => s.cone(0, .8, 0, .5, 2, 4, METAL));
            this.mesh(g, 'petal', leaf, stage.flatShiny);
            return { hinge, leaf };
        });
        // Part 3: the drill (spins), visible between the petals.
        this.drill = this.node('drill', head, new Vector3(0, 0, .8));
        const drill = new Geo({ vary: .04, seed: 88 });
        drill.at({ pitch: Math.PI / 2 }, g => {
            g.cone(0, 4.2, 0, 2.6, 8.4, 8, '#8a8f9a');
            for (let k = 0; k < 4; k++) g.at({ yaw: k * Math.PI / 2, y: 2.6 }, s => s.box(1.6, 0, 0, .5, 3.8, .6, '#d9a441', { tx: .3, tz: .3 }));
        });
        this.drillMesh = this.mesh(drill, 'drill', this.drill, stage.flatShiny);
        this.part(3, this.drill, 3.8, new Vector3(0, 0, 3.2));
        // Part 4: the glowing core
        this.coreNode = this.node('core', head, new Vector3(0, 0, 1.6));
        const core = new Geo({ vary: 0 });
        core.ico(0, 0, 0, 2.3, '#ffcf5a', { detail: 1 });
        this.coreMesh = this.glowMesh(core, 'core', this.coreNode, '#ffb03a', 1.7);
        this.part(4, this.coreNode, 2.8);
        this.coreArmor = this.shield(this.coreNode, 3.4);
        this.shield(head, r * 1.05, new Vector3(0, 0, -1), this.hull);

        this.spine = Array.from({ length: SEGMENTS }, () => new Vector3());
        this.applyScale(SCALE);
    }

    /** Spine of the worm in rail-relative coordinates: index 0 = head. */
    shape(info) {
        const { introU, fightT, phase, phaseT, downT } = info;
        const tau = introU !== null ? introU * 7 : fightT;
        let dHead = 60 + Math.sin(tau * .3) * 6, xHead = Math.sin(tau * .45) * 12, height = 20 + Math.sin(tau * 1.1) * 2.2, lean = 0;
        if (introU !== null) {
            const rise = ease((introU - .22) / .5);
            height = -18 + 38 * rise;
            dHead = 64;
            xHead = Math.sin(introU * 3) * 3;
        } else if (phase >= 1) {
            xHead = Math.sin(tau * .6) * 13;
            height += Math.sin(tau * 2.3) * 1.5;
        }
        if (introU === null && phase >= 2 && phaseT > 2) {
            const c = (phaseT - 2) % 7;
            if (c < .7) lean = Math.sin(c * 50) * .6;
            else if (c < 1.5) dHead = 60 - 32 * ease((c - .7) / .8);
            else if (c < 2.1) dHead = 28;
            else if (c < 3.6) dHead = 28 + 32 * ease((c - 2.1) / 1.5);
            if (c > .7 && c < 2.1) height -= 4;
        }
        if (downT >= 0) height -= downT * downT * 5;
        const sweep = introU !== null ? .8 : Math.sin(tau * .22 + .9);
        const points = [];
        for (let i = 0; i < SEGMENTS; i++) {
            const u = i / (SEGMENTS - 1);
            // The body arcs sideways across the canyon, so the chase camera sees the worm in profile.
            const d = dHead + u * LENGTH * .8;
            const y = height * Math.sin(Math.PI * (.32 + .68 * u)) - (u > .82 ? (u - .82) * 40 : 0) + Math.sin(u * 6 - tau * 2.4) * 1.6 * u;
            const x = xHead * (1 - u * .7) + sweep * Math.sin(u * Math.PI * .85) * 28 + Math.sin(u * 4.2 + tau * 1.3) * 3 * u + lean * (1 - u);
            points.push({ d, x, y });
        }
        return { points, dHead, xHead };
    }

    pose(info) {
        const { rail, sRail, phase, phaseT, hp, downT } = info;
        const { points, dHead, xHead } = this.shape(info);
        this.placeOnRail(rail, sRail, dHead, xHead, 0, 0, 0, downT >= 0 ? downT * .15 : 0);
        this.points = points;
        const S = SCALE;
        for (let i = 0; i < SEGMENTS; i++) {
            const p = points[i];
            this.spine[i].set(-(p.x - xHead) / S, p.y / S, -(p.d - dHead) / S);
        }
        const look = (node, from, to, roll = 0) => {
            const dir = to.subtract(from);
            const yaw = Math.atan2(dir.x, dir.z);
            const pitch = -Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
            Quaternion.RotationYawPitchRollToRef(yaw, pitch, roll, node.rotationQuaternion);
        };
        this.segments.forEach((seg, k) => {
            const i = k + 1;
            seg.node.position.copyFrom(this.spine[i]);
            look(seg.node, this.spine[i], this.spine[i - 1], Math.sin(this.stage.time * 1.5 + i) * .08);
            if (seg.vent) {
                const index = VENTS.indexOf(i);
                seg.vent.setEnabled(hp[index] > 0);
                seg.ventGlow.scaling.y = 1 + Math.sin(this.stage.time * 9 + i) * .3;
            }
        });
        // Head: in front of segment 1, looking down at the squadron
        const head = this.spine[0];
        this.head.position.copyFrom(head);
        const ahead = head.add(head.subtract(this.spine[1]));
        ahead.y -= .8;
        look(this.head, head, ahead);
        this.drill.rotation.z = this.stage.time * (phase === 1 ? 9 : 4);
        this.drill.setEnabled(hp[3] > 0 || phase < 1);
        const open = phase >= 2 ? ease(phaseT / 1.2) : phase === 1 ? .12 + Math.sin(this.stage.time * 6) * .06 : 0;
        for (const { leaf } of this.petals) leaf.rotation.x = -open * 1.1;
        this.coreArmor.radius = phase >= 2 ? 0 : this.coreArmor.baseRadius;
        this.coreMesh.scaling.setAll(1 + Math.sin(this.stage.time * 8) * .08 * (phase >= 2 ? 1 : .3));
        this.coreNode.setEnabled(phase >= 2 && (hp[4] > 0 || downT < 0));
        this.mouthGlow.setEnabled(phase >= 1);
        this.refresh(this.def.bossDef.phases, phase, hp);
    }

    attacks(t0, t1, info, emit) {
        const { phase, phaseStart, hp } = info;
        if (info.downT >= 0) return;
        if (phase === 0) {
            this.segments.forEach(seg => {
                if (!seg.vent) return;
                const index = VENTS.indexOf(this.segments.indexOf(seg) + 1);
                if (hp[index] <= 0) return;
                every(t0, t1, phaseStart, 2.5, index * .8, k => {
                    const origin = this.worldPoint(seg.vent, new Vector3(0, 1, 0));
                    for (let j = -2; j <= 2; j++) emit({ origin, target: k + index, speed: 32, spreadX: j * .13, spreadY: .05 });
                });
            });
            every(t0, t1, phaseStart, 3.6, 1.7, k => {
                const origin = this.worldPoint(this.head, new Vector3(0, -1, 3));
                for (let j = 0; j < 3; j++) emit({ origin, target: k, speed: 40, spreadY: (j - 1) * .05 });
            });
        } else if (phase === 1) {
            every(t0, t1, phaseStart, 2.2, .6, k => {
                const origin = this.worldPoint(this.head, new Vector3(0, 0, 5));
                for (let j = -1; j <= 1; j++) emit({ origin, target: k + j + 1, speed: 34, kind: 'big', spreadX: j * .06 });
            });
            every(t0, t1, phaseStart, 4, 1.3, k => {
                for (let j = 0; j < 2; j++) {
                    const seg = this.segments[j ? 4 : 2];
                    emit({ kind: 'missile', id: DRONE_BASE + 20000 + k * 4 + j, origin: this.worldPoint(seg.node, new Vector3(0, seg.r + 1, 0)), target: k + j, speed: 30, side: j ? 1 : -1 });
                }
            });
        } else if (phase === 2) {
            every(t0, t1, phaseStart, 2.7, 1.1, k => {
                const origin = this.worldPoint(this.coreNode, new Vector3(0, 0, 2));
                for (let j = 0; j < 12; j++) {
                    const a = j / 12 * Math.PI * 2 + k * .25;
                    emit({ origin, target: k, speed: 29, spreadX: Math.cos(a) * .3, spreadY: Math.sin(a) * .22 });
                }
            });
            every(t0, t1, phaseStart, 1.3, .4, k => emit({ origin: this.worldPoint(this.coreNode, new Vector3(0, 0, 2)), target: k + 1, speed: 42, kind: 'big' }));
        }
    }

    /** World point where the body meets the sand (for dust). */
    sandPoint() {
        const pts = this.points;
        if (!pts) return null;
        for (let i = 1; i < pts.length; i++) {
            if (pts[i - 1].y > 0 && pts[i].y <= 0) {
                const seg = this.segments[i - 1];
                return seg ? seg.node.getAbsolutePosition() : null;
            }
        }
        return null;
    }

    tick(dt, info, fx) {
        const sand = '#e8c08a';
        if (info.introU !== null) {
            const u = info.introU;
            if (u < .8 && Math.random() < dt * 40) {
                const p = this.worldPoint(this.root, new Vector3((Math.random() - .5) * 14, 0, (Math.random() - .3) * 20));
                p.y = .3;
                fx.burst(p, 4, sand, 26);
            }
            if (u > .15 && u < .7) this.stage.shake = Math.max(this.stage.shake, .5);
            if (u > .25 && u < .3 && !this.erupted) {
                this.erupted = true;
                const p = this.root.getAbsolutePosition().clone();
                p.y = 1;
                fx.explode(p, 3, Vector3.ZeroReadOnly, '#c9925e');
                fx.shockwave(p, 30, sand, .8);
            }
        } else this.erupted = false;
        if (info.downT < 0) {
            const p = this.sandPoint();
            if (p && Math.random() < dt * 18) { const q = p.clone(); q.y = .4; fx.burst(q, 3, sand, 18); }
            if (info.phase >= 2 && Math.random() < dt * 10) fx.burst(this.coreNode.getAbsolutePosition(), 2, '#ffcf5a', 12);
        } else if (Math.random() < dt * 20) {
            const p = this.root.getAbsolutePosition().clone();
            p.x += (Math.random() - .5) * 20; p.y = .5;
            fx.burst(p, 4, sand, 22);
        }
        for (const part of this.parts) if (part && !part.alive && part.index < 3 && Math.random() < dt * 3) fx.burst(part.pos, 2, '#ff9a4a', 8);
    }

    introShot(u) {
        if (u < .45) return { eye: { d: 16, x: -15, y: 3 }, look: { d: 62, x: 0, y: 4 + u * 34 } };
        const a = -.75 + (u - .45) * 2.3;
        return { eye: { d: 78 - 62 * Math.cos(a), x: 62 * Math.sin(a), y: 8 + (u - .45) * 22 }, look: { d: 82, x: 0, y: 15 } };
    }

    explosionPoints() {
        return [...this.parts.map(p => p.pos), ...this.hull.map(h => h.pos)];
    }
}
