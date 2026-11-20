// The campaign map "Sternenroute": a home station, a planet per mission, asteroid swarms, moons and nebulae in space.
// Hyperspace lanes join the planets like the paths of a classic platformer world map: they branch, and a secret lane
// appears with a medal. The own ship hovers over the chosen planet and flies along the lanes.
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Geo, fbm, noise2, rng, shade } from './render/kit.js';
import { ShipView } from './render/actors.js';
import { THEMES } from './worlds/themes.js';
import { LEVELS } from './level.js';

THEMES.space = {
    seed: 33,
    sky: { top: '#05061a', middle: '#0d1036', horizon: '#251a4e', bottom: '#080a22' },
    sun: { dir: [-.55, .55, -.4], color: '#ffe8c8', light: '#fff2e0', intensity: 1.25, size: 2.2 },
    hemi: { sky: '#7a84d8', ground: '#2a1d3d', intensity: .6 },
    fog: { color: '#0c0f2e', density: .0007 },
    stars: 1.2, water: null, mountains: null, clouds: null,
    exposure: 1.0, contrast: 1.2
};

/** Planet of each mission: position, size and look. The home station is node -1. */
export const NODES = [
    { center: new Vector3(-70, 0, 0), radius: 15, look: 'river' },
    { center: new Vector3(0, -4, -46), radius: 13, look: 'desert' },
    { center: new Vector3(4, 6, 48), radius: 11, look: 'orbit' },
    { center: new Vector3(78, 0, 4), radius: 17, look: 'city' }
].map(node => ({ ...node, pad: node.center.add(new Vector3(0, node.radius + 5, 0)) }));
const HOME = { center: new Vector3(-145, 4, -10), pad: new Vector3(-145, 14, -10) };
const at = index => index < 0 ? HOME : NODES[index];

function planet(geo, node, random) {
    const { center: c, radius: r, look } = node;
    const seed = look.length * 17;
    const colorAt = (x, y, z) => {
        const n = fbm(x * 2.2 + 3, z * 2.2 + y * 1.7, seed, 4);
        if (look === 'river') {
            if (Math.abs(y) > .95) return '#eef6ff';
            if (n < .47) return n < .4 ? '#1c5fa8' : '#2b86c8';
            if (n < .53) return '#e3cf8e';
            return n > .66 ? '#b8653f' : n > .6 ? '#4f8a3c' : '#6fae4a';
        }
        if (look === 'desert') {
            const band = Math.floor((y + 1) * 6 + n * 2.5);
            if (n > .68) return '#8a3a22';
            return ['#e3a86b', '#d4884e', '#f0c48a', '#c8703f'][band % 4];
        }
        if (look === 'orbit') {
            const crater = noise2(x * 6 + 1, z * 6 + y * 4, seed + 3);
            return crater > .72 ? '#55515c' : n > .55 ? '#8d8a96' : '#a7a4b0';
        }
        if (n < .45) return '#3a2a5e';
        return noise2(x * 14, y * 14 + z * 9, seed) > .72 ? '#ffc15a' : n > .6 ? '#5a3a52' : '#6e4a62';
    };
    geo.ico(c.x, c.y, c.z, r, '#888', { detail: 2, colorAt });
    if (look === 'desert') {
        geo.at({ x: c.x, y: c.y, z: c.z, roll: .35, pitch: .2 }, g => {
            for (let i = 0; i < 36; i++) {
                const a0 = i / 36 * Math.PI * 2, a1 = (i + 1) / 36 * Math.PI * 2;
                const p = (a, k) => [Math.cos(a) * r * k, 0, Math.sin(a) * r * k];
                g.quad(p(a0, 1.45), p(a1, 1.45), p(a1, 1.9), p(a0, 1.9), i % 3 ? '#d8b088' : '#c89868', [0, -5, 0]);
                g.quad(p(a0, 1.45), p(a1, 1.45), p(a1, 1.9), p(a0, 1.9), i % 3 ? '#c8a078' : '#b88858', [0, 5, 0]);
            }
        });
    }
    if (look === 'orbit') {
        geo.at({ x: c.x, y: c.y, z: c.z, roll: -.25 }, g => {
            for (let i = 0; i < 16; i++) {
                const a = i / 16 * Math.PI * 2, d = r * 1.75;
                g.at({ x: Math.cos(a) * d, z: Math.sin(a) * d, yaw: -a }, s => s.box(0, 0, 0, 1.2, 1.2, d * .42, i % 4 ? '#8d97a4' : '#ff8a3d', { top: '#b4bcc8' }));
                if (i % 4 === 0) g.at({ x: Math.cos(a) * d * .6, z: Math.sin(a) * d * .6, yaw: -a }, s => s.box(0, 0, 0, .4, .4, d * .8, '#6c7682'));
            }
        });
        for (let i = 0; i < 26; i++) {
            const a = random() * Math.PI * 2, d = r * (2.2 + random() * 1.4);
            geo.ico(c.x + Math.cos(a) * d, c.y + (random() - .5) * 10, c.z + Math.sin(a) * d, .7 + random() * 1.8, '#77727e', { jitter: .3 });
        }
    }
    if (look === 'city') {
        geo.at({ x: c.x, y: c.y, z: c.z, pitch: .15 }, g => {
            for (let i = 0; i < 40; i++) {
                const a0 = i / 40 * Math.PI * 2, a1 = (i + 1) / 40 * Math.PI * 2;
                const p = (a, k) => [Math.cos(a) * r * k, 0, Math.sin(a) * r * k];
                g.quad(p(a0, 1.25), p(a1, 1.25), p(a1, 1.32), p(a0, 1.32), '#ff9a5a', [0, -5, 0]);
            }
        });
    }
}

function station(geo, glow) {
    const c = HOME.center;
    geo.cylinder(c.x, c.y, c.z, 3, 8, 8, '#b4bcc8', { top: '#d8dde6' });
    geo.cone(c.x, c.y + 6, c.z, 2.2, 4, 8, '#8d97a4');
    for (let i = 0; i < 24; i++) {
        const a0 = i / 24 * Math.PI * 2, a1 = (i + 1) / 24 * Math.PI * 2, d = 13;
        const p = (a, k, y) => [c.x + Math.cos(a) * d * k, c.y + y, c.z + Math.sin(a) * d * k];
        geo.quad(p(a0, 1, -1.2), p(a1, 1, -1.2), p(a1, 1, 1.2), p(a0, 1, 1.2), i % 6 ? '#c9d3df' : '#ff8a3d', [c.x, c.y, c.z]);
        geo.quad(p(a0, .86, 1.2), p(a1, .86, 1.2), p(a1, 1, 1.2), p(a0, 1, 1.2), '#8d97a4', [c.x, c.y - 5, c.z]);
        geo.quad(p(a0, .86, -1.2), p(a1, .86, -1.2), p(a1, 1, -1.2), p(a0, 1, -1.2), '#6c7682', [c.x, c.y + 5, c.z]);
        if (i % 2 === 0) glow.box(...p((a0 + a1) / 2, 1.01, 0), .5, .6, .5, '#7fe0ff');
    }
    for (let i = 0; i < 4; i++) {
        const a = i / 4 * Math.PI * 2;
        geo.at({ x: c.x + Math.cos(a) * 6, y: c.y, z: c.z + Math.sin(a) * 6, yaw: -a }, s => s.box(0, 0, 0, .8, .8, 12, '#8d97a4'));
    }
    for (const side of [-1, 1]) {
        geo.box(c.x + side * 24, c.y, c.z, 14, .3, 6, '#2b4f9a', { top: '#3d6fd8' });
        geo.box(c.x + side * 16, c.y, c.z, 4, .5, .5, '#8d97a4');
    }
}

export class Overworld {
    constructor(stage, { design = 0, slot = 0, unlocked = [0], cleared = [], medals = [], selected = 0 }) {
        this.stage = stage;
        stage.setTheme(THEMES.space);
        const random = rng(57);
        this.unlocked = new Set(unlocked);
        this.cleared = new Set(cleared);
        this.medals = new Set(medals);
        const geo = new Geo({ vary: .05, seed: 8 });
        const glow = new Geo({ vary: 0 });
        NODES.forEach(node => planet(geo, node, random));
        station(geo, glow);
        for (let i = 0; i < 70; i++) {
            const x = -170 + random() * 300, z = -90 + random() * 180, y = -30 + random() * 25;
            if (NODES.some(n => Vector3.Distance(n.center, new Vector3(x, y, z)) < n.radius * 2.2)) continue;
            geo.ico(x, y, z, .8 + random() * 2.6, ['#6f6a70', '#7a6a5e', '#5c5866'][i % 3], { jitter: .3 });
        }
        geo.ico(-48, 22, -30, 4, '#c8c4d0', { detail: 1, colorAt: (x, y, z) => noise2(x * 5, z * 5 + y * 3, 3) > .65 ? '#8d8a96' : '#c8c4d0' });
        geo.ico(110, 18, -40, 6, '#8fb8d8', { detail: 1, colorAt: (x, y) => y > .5 ? '#eef6ff' : '#8fb8d8' });
        this.mesh = geo.build('overworld', stage.scene, stage.flat);
        const fog = new Geo({ vary: .1, seed: 3 });
        for (let i = 0; i < 9; i++) {
            const color = ['#6a3aa8', '#2a6ab0', '#b0408a'][i % 3];
            fog.ico(-320 + i * 80 + random() * 40, -260 - random() * 80, 260 + random() * 260, 120 + random() * 80, color, { sy: .35, jitter: .2 });
        }
        const nebula = new StandardMaterial('nebula', stage.scene);
        nebula.disableLighting = true;
        nebula.emissiveColor = new Color3(1, 1, 1);
        nebula.alpha = .13;
        nebula.disableDepthWrite = true;
        this.nebula = fog.build('nebula', stage.scene, nebula);
        this.nebula.applyFog = false;
        this.glowMesh = glow.empty ? null : glow.build('overworld-glow', stage.scene, stage.glowMaterial('#ffffff', 1.1));
        if (this.glowMesh) stage.addGlow(this.glowMesh);
        this.buildRoutes();
        this.ship = new ShipView(stage, design, slot, { shadow: false });
        this.index = this.unlocked.has(selected) ? selected : Math.max(0, ...this.unlocked);
        this.position = at(this.index).pad.add(new Vector3(0, 3, 0));
        this.heading = 0;
        this.route = null;
        this.time = 0;
        this.cam = null;
    }

    /** The lanes: secret ones exist only once open. */
    lanes() {
        return LEVELS.routes.map(([from, to, condition]) => {
            const earned = condition === 'start' || (condition === 'clear' && this.cleared.has(from)) || (condition === 'medal' && this.medals.has(from));
            // A granted mission (administrator) opens its ordinary lanes too; the secret lane needs the medal.
            const open = earned || (condition !== 'medal' && (from < 0 || this.unlocked.has(from)) && this.unlocked.has(to));
            return { from, to, condition, open, shown: condition !== 'medal' || open };
        });
    }

    curve(from, to, secret) {
        const a = at(from).pad, b = at(to).pad;
        const mid = a.add(b).scale(.5);
        mid.y = Math.max(a.y, b.y) + (secret ? 34 : 9);
        if (secret) mid.z += 40;
        const points = [];
        for (let i = 0; i <= 48; i++) {
            const t = i / 48, u = 1 - t;
            points.push(new Vector3(u * u * a.x + 2 * u * t * mid.x + t * t * b.x, u * u * a.y + 2 * u * t * mid.y + t * t * b.y, u * u * a.z + 2 * u * t * mid.z + t * t * b.z));
        }
        return points;
    }

    buildRoutes() {
        const open = new Geo({ vary: 0 }), secret = new Geo({ vary: 0 }), closed = new Geo({ vary: .04, seed: 2 }), pads = new Geo({ vary: .03, seed: 4 });
        this.paths = new Map();
        for (const lane of this.lanes()) {
            if (!lane.shown) continue;
            const points = this.curve(lane.from, lane.to, lane.condition === 'medal');
            this.paths.set(lane.from + '>' + lane.to, points);
            const target = lane.open ? (lane.condition === 'medal' ? secret : open) : closed;
            let carry = 0;
            for (let k = 1; k < points.length - 2; k++) {
                carry += Vector3.Distance(points[k], points[k - 1]);
                if (carry < 3.6) continue;
                carry = 0;
                target.ico(points[k].x, points[k].y, points[k].z, lane.open ? .55 : .4, lane.open ? '#fff2a8' : '#5a6274');
            }
        }
        NODES.forEach((node, i) => {
            const p = node.pad, done = this.cleared.has(i), reachable = this.unlocked.has(i);
            const color = !reachable ? '#5a6274' : this.medals.has(i) ? '#ffd34a' : done ? '#3d8bff' : '#ff6a3a';
            for (let k = 0; k < 6; k++) {
                const a0 = k / 6 * Math.PI * 2, a1 = (k + 1) / 6 * Math.PI * 2;
                const q = (a, d) => [p.x + Math.cos(a) * d, p.y, p.z + Math.sin(a) * d];
                pads.quad(q(a0, 3.2), q(a1, 3.2), q(a1, 4.4), q(a0, 4.4), color, [p.x, p.y - 5, p.z]);
                pads.quad(q(a0, 3.2), q(a1, 3.2), q(a1, 4.4), q(a0, 4.4), shade(color, .6), [p.x, p.y + 5, p.z]);
            }
            const pole = p.y - node.center.y - node.radius;
            pads.cylinder(p.x, p.y - pole / 2, p.z, .25, pole, 4, '#9aa3b2');
            if (done) {
                pads.box(p.x + 3.8, p.y + 2.5, p.z, .2, 5, .2, '#e6e6e6');
                pads.box(p.x + 5, p.y + 4.4, p.z, 2.2, 1.4, .12, this.medals.has(i) ? '#ffd34a' : '#ff8a3d');
            }
        });
        this.pathOpen = open.empty ? null : open.build('lanes-open', this.stage.scene, this.stage.glowMaterial('#fff2a8', 1));
        this.pathSecret = secret.empty ? null : secret.build('lanes-secret', this.stage.scene, this.stage.glowMaterial('#7dffb0', 1.2));
        for (const mesh of [this.pathOpen, this.pathSecret]) if (mesh) this.stage.addGlow(mesh);
        this.pathClosed = closed.empty ? null : closed.build('lanes-closed', this.stage.scene, this.stage.flat);
        this.pads = pads.build('pads', this.stage.scene, this.stage.glowMaterial('#ffffff', .9));
    }

    /** Neighbours over open lanes: [{ index, path }] (path oriented from here). */
    neighbours(index) {
        const result = [];
        for (const lane of this.lanes()) {
            if (!lane.open || lane.from < 0) continue;
            const points = this.paths.get(lane.from + '>' + lane.to);
            if (lane.from === index && this.unlocked.has(lane.to)) result.push({ index: lane.to, path: points });
            if (lane.to === index && this.unlocked.has(lane.from)) result.push({ index: lane.from, path: [...points].reverse() });
        }
        return result;
    }

    /** The lane in a screen direction (dx right, dy down): true when the ship flies, false when there is none. */
    step(dx, dy) {
        if (this.route) return true;
        const here = at(this.index).pad;
        let best = null, bestScore = .35;
        for (const n of this.neighbours(this.index)) {
            const to = at(n.index).pad;
            const vx = to.x - here.x, vz = to.z - here.z, length = Math.hypot(vx, vz) || 1;
            const score = (vx * dx - vz * dy) / length;
            if (score > bestScore) { bestScore = score; best = n; }
        }
        if (!best) return false;
        this.travel(best.index, best.path);
        return true;
    }

    /** Flies to any unlocked planet (badge click): along a lane when there is one, else straight. */
    go(target) {
        if (target === this.index || this.route || !this.unlocked.has(target)) return;
        const direct = this.neighbours(this.index).find(n => n.index === target);
        this.travel(target, direct?.path ?? this.curve(this.index, target, false));
    }

    travel(target, points) {
        this.route = { points: points.map(p => p.add(new Vector3(0, 3, 0))), u: 0, target };
        this.onMove?.(target);
    }

    tick(dt) {
        this.time += dt;
        if (this.route) {
            const r = this.route;
            r.u += dt * 42;
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
                Vector3.LerpToRef(a, b, (r.u - length) / Math.max(.001, Vector3.Distance(a, b)), this.position);
                const heading = Math.atan2(b.x - a.x, b.z - a.z);
                const turn = Math.atan2(Math.sin(heading - this.heading), Math.cos(heading - this.heading));
                this.heading += turn * Math.min(1, dt * 6);
                this.bank = -turn * 2.5;
                this.pitch = -Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
            }
        } else {
            this.bank = (this.bank ?? 0) * .9;
            this.pitch = (this.pitch ?? 0) * .9;
            this.heading += dt * .3;
        }
        const bob = Math.sin(this.time * 2.2) * .5;
        this.ship.place(this.position.add(new Vector3(0, bob, 0)), this.heading, this.pitch ?? 0, this.bank ?? 0, null, this.route ? 1 : 0);
        const desired = this.position.add(new Vector3(-10, 62, -70));
        const look = this.position.add(new Vector3(4, -14, 24));
        if (!this.cam) this.cam = { eye: desired.clone(), look: look.clone() };
        Vector3.LerpToRef(this.cam.eye, desired, Math.min(1, dt * 2.5), this.cam.eye);
        Vector3.LerpToRef(this.cam.look, look, Math.min(1, dt * 3), this.cam.look);
        this.stage.view(this.cam.eye, this.cam.look, 0, .95);
    }

    badges() {
        return NODES.map(node => this.stage.project(node.pad.add(new Vector3(0, 6, 0))));
    }

    dispose() {
        for (const mesh of [this.mesh, this.nebula, this.glowMesh, this.pathOpen, this.pathSecret, this.pathClosed, this.pads]) mesh?.dispose();
        this.ship.dispose();
    }
}
