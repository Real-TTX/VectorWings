// The campaign map: four themed islands in the sea, joined by a glowing path of stepping stones and level pads.
// The own ship hovers over the chosen pad and flies along the path – like the world maps of classic platformers.
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector.js';
import { Geo, fbm, rng, shade } from './render/kit.js';
import { ShipView } from './render/actors.js';
import { tree, boulder } from './worlds/common.js';
import { THEMES } from './worlds/themes.js';

THEMES.map ??= {
    seed: 21,
    sky: { top: '#2b66d0', middle: '#5d9fe6', horizon: '#cde8f8', bottom: '#9cc8e2' },
    sun: { dir: [-.45, .75, -.35], color: '#fff3d2', light: '#fff2dc', intensity: 1.7, size: 1.1 },
    hemi: { sky: '#cfe4ff', ground: '#6a5a4a', intensity: .85 },
    fog: { color: '#b9dcef', density: .0024 },
    water: { deep: '#0a4f8a', shallow: '#1f97cf', foam: '#e4fbff', sky: '#6fb2e8', level: 0, amplitude: .7 },
    mountains: { rings: [{ radius: 1500, height: 260, color: '#8fb0d4', color2: '#a9c6e4', count: 40, snow: '#f1f7ff' }] },
    clouds: { count: 22, color: '#ffffff', shadow: '#d3e2f5', height: 22 },
    exposure: 1.08, contrast: 1.14
};

/** Pads of the four missions (world positions) and the island under each. */
export const NODES = [
    { pad: new Vector3(-82, 9.5, -12), island: { x: -92, z: -18, r: 40, h: 8, key: 'river' } },
    { pad: new Vector3(-14, 9.5, 36), island: { x: -16, z: 44, r: 38, h: 8, key: 'desert' } },
    { pad: new Vector3(52, 34, -8), island: { x: 54, z: -14, r: 26, h: 7, key: 'orbit' } },
    { pad: new Vector3(118, 10.5, 34), island: { x: 122, z: 38, r: 40, h: 9, key: 'city' } }
];
const HOME = new Vector3(-140, 8, -52);

const PALETTE = {
    river: { top: ['#6ea84a', '#7cb656', '#5f9a40'], cliff: ['#b8653f', '#cf7b4c', '#a5553a'] },
    desert: { top: ['#e3b06e', '#ecc07c', '#d79f5c'], cliff: ['#c0643e', '#d47a4a', '#a8522f'] },
    orbit: { top: ['#7d8794', '#8d97a4', '#6c7682'], cliff: ['#59606c', '#6a717d', '#4b525d'] },
    city: { top: ['#6f6a7c', '#7c768a', '#625e70'], cliff: ['#5a4a5e', '#6a5670', '#4b3d50'] }
};

function island(geo, spec, random) {
    const { x, z, r, h, key } = spec;
    const colors = PALETTE[key];
    const steps = 22;
    const rim = Array.from({ length: steps }, (_, i) => {
        const a = i / steps * Math.PI * 2;
        const k = .78 + fbm(Math.cos(a) * 1.7 + x * .01, Math.sin(a) * 1.7 + z * .01, 7, 3) * .45;
        return [Math.cos(a) * r * k, Math.sin(a) * r * k];
    });
    const center = [x, h * .3, z];
    for (let i = 0; i < steps; i++) {
        const [ax, az] = rim[i], [bx, bz] = rim[(i + 1) % steps];
        const top = c => [x + c[0], h, z + c[1]];
        const mid = (c, f, y) => [x + c[0] * f, y, z + c[1] * f];
        // top fan, beach ring and cliff
        geo.tri([x, h + 1.2, z], mid(rim[i], .55, h + .6), mid(rim[(i + 1) % steps], .55, h + .6), colors.top[i % 3], [x, -50, z]);
        geo.quad(mid(rim[i], .55, h + .6), top(rim[i]), top(rim[(i + 1) % steps]), mid(rim[(i + 1) % steps], .55, h + .6), colors.top[(i + 1) % 3], [x, -50, z]);
        geo.quad(top(rim[i]), [x + ax * 1.08, h * .35, z + az * 1.08], [x + bx * 1.08, h * .35, z + bz * 1.08], top(rim[(i + 1) % steps]), colors.cliff[i % 3], center);
        geo.quad([x + ax * 1.08, h * .35, z + az * 1.08], [x + ax * 1.22, -4, z + az * 1.22], [x + bx * 1.22, -4, z + bz * 1.22], [x + bx * 1.08, h * .35, z + bz * 1.08], colors.cliff[(i + 2) % 3], center);
        geo.tri([x + ax * 1.22, -4, z + az * 1.22], [x + bx * 1.22, -4, z + bz * 1.22], [x + (ax + bx) * .7, -.3, z + (az + bz) * .7], '#e8d6a2', [x, 50, z]);
    }
    void random;
}

function decorate(geo, glow, spec, random) {
    const { x, z, r, h, key } = spec;
    const spot = (min = .2, max = .75) => {
        const a = random() * Math.PI * 2, d = r * (min + random() * (max - min));
        return [x + Math.cos(a) * d, z + Math.sin(a) * d];
    };
    if (key === 'river') {
        // A canyon ridge with an arch and a strip of river, trees around
        for (const side of [-1, 1]) for (let k = 0; k < 3; k++)
            geo.ico(x + side * (11 + k * 3), h + 4 + k, z + 14 - k * 11, 7 - k, '#c46d45', { jitter: .2, sy: 1.2, colorOf: dy => dy > 4 ? '#7cb656' : dy > 0 ? '#cf7b4c' : '#a5553a' });
        geo.box(x, h + .2, z + 6, 9, .3, 46, '#2f9bd6');
        for (let k = 0; k <= 10; k++) {
            const a = Math.PI * k / 10, a2 = Math.PI * (k + 1) / 10;
            if (k === 10) break;
            geo.quad([x - Math.cos(a) * 12, h + 2 + Math.sin(a) * 12, z + 2], [x - Math.cos(a2) * 12, h + 2 + Math.sin(a2) * 12, z + 2],
                [x - Math.cos(a2) * 15, h + 2 + Math.sin(a2) * 15, z + 2], [x - Math.cos(a) * 15, h + 2 + Math.sin(a) * 15, z + 2], k % 2 ? '#b8653f' : '#cf7b4c', [x, h, z + 30]);
            geo.quad([x - Math.cos(a) * 12, h + 2 + Math.sin(a) * 12, z - 2], [x - Math.cos(a2) * 12, h + 2 + Math.sin(a2) * 12, z - 2],
                [x - Math.cos(a2) * 15, h + 2 + Math.sin(a2) * 15, z - 2], [x - Math.cos(a) * 15, h + 2 + Math.sin(a) * 15, z - 2], '#a5553a', [x, h, z - 30]);
            geo.quad([x - Math.cos(a) * 15, h + 2 + Math.sin(a) * 15, z - 2], [x - Math.cos(a2) * 15, h + 2 + Math.sin(a2) * 15, z - 2],
                [x - Math.cos(a2) * 15, h + 2 + Math.sin(a2) * 15, z + 2], [x - Math.cos(a) * 15, h + 2 + Math.sin(a) * 15, z + 2], '#7cb656', [x, h, z]);
        }
        for (let i = 0; i < 16; i++) { const [tx, tz] = spot(.35, .85); tree(geo, tx, h + .5, tz, 2.2 + random() * 1.4, random); }
        geo.box(x - 22, h + 3, z - 18, 1, 6, 1, '#f0b429');
        geo.box(x - 25, h + 6, z - 18, 7, .8, .8, '#f0b429');
    } else if (key === 'desert') {
        for (let i = 0; i < 4; i++) {
            const [mx, mz] = spot(.35, .7), s = 5 + random() * 4;
            geo.cylinder(mx, h + s, mz, s, s * 2, 7, ['#c0643e', '#d47a4a'][i % 2], { radiusTop: s * .8, top: '#e3b06e' });
        }
        for (let k = -30; k <= 30; k += 2.2) geo.box(x + k, h + .3, z - 2 + k * .15, .5, .25, 3.2, '#6b4a33');
        geo.box(x, h + .55, z - 2.9, 62, .3, .25, '#9aa0a8', { tz: 1 });
        geo.box(x, h + .55, z - 1.1, 62, .3, .25, '#9aa0a8');
        geo.box(x + 8, h + 1.6, z - 2, 6, 2.6, 2.6, '#c83a3a', { top: '#2b2f3a' });
        for (let i = 0; i < 12; i++) { const [cx, cz] = spot(.3, .85); geo.box(cx, h + 1.6, cz, .7, 3.2, .7, '#4f8a3c'); geo.box(cx + .6, h + 2.2, cz, .9, .5, .5, '#4f8a3c'); }
    } else if (key === 'orbit') {
        // Launch tower up to the floating dock, asteroids around it
        for (let y = h; y < 32; y += 4) {
            for (const [dx, dz] of [[-2, -2], [2, -2], [2, 2], [-2, 2]]) geo.box(x + dx, y + 2, z + dz, .5, 4, .5, '#9aa3b2');
            geo.box(x, y + 4, z, 4.6, .4, 4.6, '#7d8794');
        }
        geo.cylinder(x - 2, 33, z + 6, 10, 1.6, 10, '#8d97a4', { radiusTop: 9, top: '#b4bcc8' });
        for (let a = 0; a < 12; a++) {
            const ang = a / 12 * Math.PI * 2;
            geo.box(x - 2 + Math.cos(ang) * 13, 34, z + 6 + Math.sin(ang) * 13, 2.6, 1, 2.6, '#6c7682', { top: '#4fd6ff' });
        }
        for (let i = 0; i < 9; i++) {
            const a = random() * Math.PI * 2, d = 18 + random() * 14;
            boulder(geo, x + Math.cos(a) * d, 26 + random() * 20, z + Math.sin(a) * d, 1.5 + random() * 2.5, '#6f6a70');
        }
        glow.cylinder(x - 2, 34.9, z + 6, 3, .2, 10, '#5fd8ff');
    } else {
        for (let i = 0; i < 22; i++) {
            const [bx, bz] = spot(.15, .78);
            const w = 3 + random() * 4, d = 3 + random() * 4, tall = 4 + random() * (i < 4 ? 22 : 10);
            const c = ['#7a5a62', '#8a6a6e', '#5f4a58', '#9a7a70'][i % 4];
            geo.box(bx, h + tall / 2, bz, w, tall, d, c, { top: shade(c, .8) });
            for (let k = 1; k < tall / 2.4; k++) if (random() < .5) glow.box(bx - w / 2 - .02, h + k * 2.4, bz + (random() - .5) * d * .6, .05, .7, .6, '#ffc15a');
        }
        geo.cylinder(x + 6, h + 15, z - 6, 2.2, 30, 6, '#5a4a5e', { radiusTop: 1.6 });
        geo.cone(x + 6, h + 32, z - 6, 2.2, 5, 6, '#3f3346');
        glow.box(x + 6, h + 24, z - 8.2, 1.4, 1.4, .1, '#ffd34a');
    }
}

export class Overworld {
    constructor(stage, { design = 0, unlocked = 4, cleared = [], medals = [], selected = 0 }) {
        this.stage = stage;
        stage.setTheme(THEMES.map);
        const random = rng(41);
        const geo = new Geo({ vary: .06, seed: 9 });
        const glow = new Geo({ vary: 0 });
        for (const node of NODES) { island(geo, node.island, random); decorate(geo, glow, node.island, random); }
        // Home carrier where the route begins
        geo.at({ x: HOME.x, z: HOME.z, yaw: .9 }, g => {
            g.loft([{ z: 16, w: 0, h: 0, y: 3 }, { z: 10, w: 9, h: 4, y: 3 }, { z: -12, w: 11, h: 5, y: 3 }, { z: -16, w: 8, h: 4, y: 3 }], 6, '#8d99a8',
                { colors: (r, f) => f >= 3 && f <= 4 ? '#2b3140' : '#c9d3df' });
            g.box(0, 5.6, -2, 7, .4, 22, '#4c5361', { top: '#5a6272' });
            g.box(2.5, 8, -8, 2.4, 4.4, 4, '#c9d3df', { top: '#ff8a3d' });
        });
        this.mesh = geo.build('overworld', stage.scene, stage.flat);
        this.glowMesh = glow.empty ? null : glow.build('overworld-glow', stage.scene, stage.glowMaterial('#ffffff', 1.1));
        if (this.glowMesh) stage.addGlow(this.glowMesh);
        this.unlocked = unlocked;
        this.cleared = new Set(cleared);
        this.medals = new Set(medals);
        this.buildPath();
        this.ship = new ShipView(stage, design, 0, { shadow: true });
        this.index = Math.min(selected, unlocked - 1);
        this.position = NODES[this.index].pad.add(new Vector3(0, 6, 0));
        this.heading = 0;
        this.route = null;
        this.time = 0;
        this.cam = null;
    }

    /** Points of the path from node a to node b (or from home to node 0). */
    curve(from, to) {
        const mid = from.add(to).scale(.5);
        mid.y = Math.max(from.y, to.y) + 10;
        const points = [];
        for (let i = 0; i <= 40; i++) {
            const t = i / 40, a = 1 - t;
            points.push(new Vector3(a * a * from.x + 2 * a * t * mid.x + t * t * to.x, a * a * from.y + 2 * a * t * mid.y + t * t * to.y, a * a * from.z + 2 * a * t * mid.z + t * t * to.z));
        }
        return points;
    }

    buildPath() {
        const open = new Geo({ vary: 0 }), closed = new Geo({ vary: .04, seed: 2 }), pads = new Geo({ vary: .03, seed: 4 });
        const stops = [HOME.add(new Vector3(0, 5, 0)), ...NODES.map(n => n.pad)];
        this.paths = [];
        for (let i = 0; i < NODES.length; i++) {
            const points = this.curve(stops[i], stops[i + 1]);
            this.paths.push(points);
            const unlocked = i < this.unlocked;
            let carry = 0;
            for (let k = 1; k < points.length; k++) {
                carry += Vector3.Distance(points[k], points[k - 1]);
                if (carry < 3.4 || k > points.length - 3) continue;
                carry = 0;
                const p = points[k];
                (unlocked ? open : closed).cylinder(p.x, p.y, p.z, .55, .35, 6, unlocked ? '#fff2a8' : '#6c7380');
            }
        }
        NODES.forEach((node, i) => {
            const p = node.pad, done = this.cleared.has(i), open = i < this.unlocked;
            const color = !open ? '#6c7380' : done ? '#3d8bff' : '#ff6a3a';
            pads.cylinder(p.x, p.y - .6, p.z, 4.2, 1.2, 6, '#2b3140', { radiusTop: 3.8 });
            pads.cylinder(p.x, p.y + .15, p.z, 3.3, .4, 6, color);
            if (done) {
                pads.box(p.x + 2.6, p.y + 3.5, p.z, .25, 7, .25, '#e6e6e6');
                pads.box(p.x + 3.9, p.y + 6, p.z, 2.4, 1.6, .15, this.medals.has(i) ? '#ffd34a' : '#ff8a3d');
            }
        });
        this.pathOpen = open.empty ? null : open.build('path-open', this.stage.scene, this.stage.glowMaterial('#fff2a8', 1));
        if (this.pathOpen) this.stage.addGlow(this.pathOpen);
        this.pathClosed = closed.empty ? null : closed.build('path-closed', this.stage.scene, this.stage.flat);
        this.pads = pads.build('pads', this.stage.scene, this.stage.flatShiny);
    }

    /** Moves the cursor one step (−1 / +1). Returns false when the next mission is locked. */
    step(direction) {
        const target = this.index + direction;
        if (this.route || target < 0 || target >= NODES.length) return false;
        if (target >= this.unlocked) return false;
        this.go(target);
        return true;
    }

    go(target) {
        if (target === this.index || this.route || target >= this.unlocked) return;
        const forward = target > this.index;
        const points = [];
        for (let i = this.index; forward ? i < target : i > target; i += forward ? 1 : -1) {
            const path = this.paths[forward ? i + 1 : i];
            points.push(...(forward ? path : [...path].reverse()));
        }
        this.route = { points: points.map(p => p.add(new Vector3(0, 6, 0))), u: 0, target };
        this.onMove?.();
    }

    tick(dt) {
        this.time += dt;
        if (this.route) {
            const r = this.route;
            r.u += dt * 38;
            let length = 0, i = 1;
            for (; i < r.points.length; i++) {
                const segment = Vector3.Distance(r.points[i - 1], r.points[i]);
                if (length + segment >= r.u) break;
                length += segment;
            }
            if (i >= r.points.length) {
                this.index = r.target;
                this.position.copyFrom(r.points[r.points.length - 1]);
                this.route = null;
                this.onArrive?.(this.index);
            } else {
                const a = r.points[i - 1], b = r.points[i];
                const f = (r.u - length) / Math.max(.001, Vector3.Distance(a, b));
                Vector3.LerpToRef(a, b, f, this.position);
                const heading = Math.atan2(b.x - a.x, b.z - a.z);
                const turn = Math.atan2(Math.sin(heading - this.heading), Math.cos(heading - this.heading));
                this.heading += turn * Math.min(1, dt * 6);
                this.bank = -turn * 2.5;
                this.pitch = -Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
            }
        } else {
            this.bank = (this.bank ?? 0) * .9;
            this.pitch = (this.pitch ?? 0) * .9;
            this.heading += dt * .25;
        }
        const bob = Math.sin(this.time * 2.2) * .6;
        this.ship.place(this.position.add(new Vector3(0, bob, 0)), this.heading, this.pitch ?? 0, this.bank ?? 0, this.groundBelow(), this.route ? 1 : 0);
        const desired = this.position.add(new Vector3(-16, 70, -78));
        const look = this.position.add(new Vector3(6, -10, 26));
        if (!this.cam) this.cam = { eye: desired.clone(), look: look.clone() };
        Vector3.LerpToRef(this.cam.eye, desired, Math.min(1, dt * 2.5), this.cam.eye);
        Vector3.LerpToRef(this.cam.look, look, Math.min(1, dt * 3), this.cam.look);
        this.stage.view(this.cam.eye, this.cam.look, 0, .95);
        if (this.glowMesh) this.glowMesh.visibility = 1;
    }

    groundBelow() {
        for (const node of NODES) {
            const s = node.island;
            if ((this.position.x - s.x) ** 2 + (this.position.z - s.z) ** 2 < (s.r * .8) ** 2) return s.h + .4;
        }
        return 0;
    }

    /** Screen positions of the pads (CSS pixels) for the badges. */
    badges() {
        return NODES.map(node => this.stage.project(node.pad.add(new Vector3(0, 3, 0))));
    }

    dispose() {
        for (const mesh of [this.mesh, this.glowMesh, this.pathOpen, this.pathClosed, this.pads]) mesh?.dispose();
        this.ship.dispose();
    }
}

void Quaternion;
