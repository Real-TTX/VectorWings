// Mission 3 · Orbitalwerft: an asteroid belt in deep space with a ringed gas giant, a moon, a nebula band,
// drifting rocks, station scaffolding and the three dock frames of the shipyard.
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { ChunkStreamer, Geo, chunkRandom, finish, railPoint, shade } from './common.js';
import { noise2, rng } from '../render/kit.js';
import { THEMES } from './themes.js';

// A touch more light on the hulls and a violet tint in the deep.
Object.assign(THEMES.orbit, {
    sky: { top: '#05061a', middle: '#0c1034', horizon: '#26205a', bottom: '#090b22' },
    sun: { dir: [.75, .5, -.45], color: '#cfe0ff', light: '#f2f5ff', intensity: 1.75, size: 1.6 },
    hemi: { sky: '#8f9ae0', ground: '#3a2f5a', intensity: .8 },
    fog: { color: '#0e1132', density: .0009 }
});

const ROCK = ['#6f6a70', '#7d7166', '#5a5560', '#8a7f76', '#655c58'];
const HULL = '#c9ced8', HULL_DARK = '#7e8796', STEEL = '#4a505e', HAZARD = '#f08a2c', DARK = '#22252e';
const DOCK_INNER = { x: 30, top: 25, bottom: -21 };

function rock(geo, x, y, z, size, color, random) {
    geo.at({ x, y, z, yaw: random() * 6, pitch: random() * 6 }, g => g.ico(0, 0, 0, size, color, {
        detail: 1, jitter: .24, sy: .75 + random() * .4,
        colorOf: dy => dy > size * .35 ? shade(color, 1.18) : dy < -size * .35 ? shade(color, .72) : color
    }));
}

/** Scaffolding: a lattice of girders, optionally with a solar wing. */
function girders(geo, x, y, z, length, random) {
    const yaw = random() * Math.PI, roll = (random() - .5) * .8;
    geo.at({ x, y, z, yaw, roll }, g => {
        for (const [gy, gz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) g.box(0, gy, gz, length, .5, .5, HULL_DARK);
        for (let k = -length / 2; k <= length / 2; k += 5) {
            g.box(k, 0, -1.6, .4, 3.2, .4, STEEL);
            g.box(k, 0, 1.6, .4, 3.2, .4, STEEL);
            g.box(k, 1.6, 0, .4, .4, 3.2, STEEL);
        }
        if (random() < .5) {
            g.box(length / 2 + 6, 0, 0, 12, .2, 7, '#2f4d9a', { top: '#3d64c4', bottom: '#1d2b55' });
            g.box(-length / 2 - 6, 0, 0, 12, .2, 7, '#2f4d9a', { top: '#3d64c4', bottom: '#1d2b55' });
        }
        if (random() < .4) g.box((random() - .5) * length, 3.4, 0, 4, 3, 7, ['#d9553f', '#3f7fd9', '#e7b23c'][Math.floor(random() * 3)]);
    });
}

/** A station module: drum with docking ring and solar panels. */
function module(geo, x, y, z, random) {
    geo.at({ x, y, z, pitch: Math.PI / 2, roll: random() * .6 }, g => {
        g.cylinder(0, 0, 0, 6, 22, 8, HULL, { top: HULL_DARK });
        g.cylinder(0, 12, 0, 3.4, 3, 8, STEEL);
        g.cylinder(0, -8, 0, 7.5, 2, 8, HAZARD);
        for (const side of [-1, 1]) {
            g.box(side * 9, 2, 0, 6, .3, .3, STEEL);
            g.box(side * 18, 2, 0, 14, 8, .2, '#2f4d9a', { front: '#3d64c4', back: '#1d2b55' });
        }
    });
}

/** The dock frames of the shipyard: an octagonal ring around the lane, with a beam to dodge. */
function dockFrame(geo, glow, rail, prop, index) {
    const s0 = prop.s - 5, s1 = prop.s + 5;
    const cy = (DOCK_INNER.top + DOCK_INNER.bottom) / 2;
    const hx = DOCK_INNER.x, hy = (DOCK_INNER.top - DOCK_INNER.bottom) / 2;
    const octagon = scale => {
        const c = .42;
        return [[-hx, -hy * c], [-hx * c, -hy], [hx * c, -hy], [hx, -hy * c], [hx, hy * c], [hx * c, hy], [-hx * c, hy], [-hx, hy * c]]
            .map(([x, y]) => [x * scale, cy + y * scale]);
    };
    const inner = octagon(1), outer = octagon(1.32);
    const center = railPoint(rail, prop.s, 0, cy);
    for (let i = 0; i < 8; i++) {
        const j = (i + 1) % 8;
        const p = (s, q) => railPoint(rail, s, q[0], q[1]);
        const color = i % 2 ? HULL : HULL_DARK;
        // front, back, inner, outer faces; the inner face must look into the opening
        geo.quad(p(s0, inner[i]), p(s0, inner[j]), p(s0, outer[j]), p(s0, outer[i]), color, center);
        geo.quad(p(s1, inner[i]), p(s1, inner[j]), p(s1, outer[j]), p(s1, outer[i]), shade(color, .85), center);
        geo.quad(p(s0, outer[i]), p(s0, outer[j]), p(s1, outer[j]), p(s1, outer[i]), STEEL, center);
        const away = railPoint(rail, prop.s, outer[i][0] * 3 + outer[j][0] * 3, cy + (outer[i][1] + outer[j][1] - 2 * cy) * 3);
        geo.quad(p(s0, inner[i]), p(s0, inner[j]), p(s1, inner[j]), p(s1, inner[i]), i % 2 ? HAZARD : DARK, away);
        // lights on the front rim
        const m = [(inner[i][0] + inner[j][0]) / 2, (inner[i][1] + inner[j][1]) / 2];
        const lp = railPoint(rail, s0 - .2, m[0] * 1.08, cy + (m[1] - cy) * 1.08);
        glow.box(lp[0], lp[1], lp[2], 1.4, 1.4, .3, i % 2 ? '#5fd8ff' : '#ff8a3d');
    }
    // Pylons that hold the frame
    for (const side of [-1, 1]) {
        const a = railPoint(rail, prop.s, side * hx * 1.6, cy);
        geo.box(a[0], a[1], a[2], hx * .9, 3, 3, STEEL);
    }
    // Beams to dodge (inside the lane, collisions in collide())
    for (const beam of DOCK_BEAMS[index % 3]) {
        const a = railPoint(rail, prop.s, beam.x, beam.y);
        geo.box(a[0], a[1], a[2], beam.w, beam.h, 4, HULL_DARK, { top: HULL, front: HAZARD });
        const l = railPoint(rail, prop.s - 2.2, beam.x, beam.y);
        glow.box(l[0], l[1], l[2], Math.max(.6, beam.w * .8), Math.max(.6, beam.h * .8), .2, '#ff5a3a');
    }
}

// Beams across the opening of each dock frame (rail x/y centre, width/height).
const DOCK_BEAMS = [
    [{ x: 0, y: 2, w: 2 * DOCK_INNER.x, h: 3.2 }],
    [{ x: 0, y: 2, w: 4, h: DOCK_INNER.top - DOCK_INNER.bottom }],
    [{ x: -11, y: 2, w: 4, h: DOCK_INNER.top - DOCK_INNER.bottom }, { x: 11, y: 2, w: 4, h: DOCK_INNER.top - DOCK_INNER.bottom }]
];

function buildBackdrop(stage) {
    const node = new TransformNode('orbit-sky', stage.scene);
    const meshes = [];
    // Ringed gas giant, lit by the sun so it shows a terminator.
    const planet = new Geo({ vary: .05, seed: 3 });
    const R = 520, lat = 18, lon = 30;
    const bands = ['#4b5fb8', '#5f78d0', '#7a8fe0', '#3e4fa0', '#8fa6ec', '#6a5fc0', '#5470c8'];
    const point = (i, j) => {
        const theta = i / lat * Math.PI, phi = j / lon * Math.PI * 2;
        return [Math.sin(theta) * Math.cos(phi) * R, Math.cos(theta) * R, Math.sin(theta) * Math.sin(phi) * R];
    };
    for (let i = 0; i < lat; i++)
        for (let j = 0; j < lon; j++) {
            const band = Math.floor(i + noise2(j * .4, i * .7, 9) * 1.6) % bands.length;
            const color = bands[band];
            const a = point(i, j), b = point(i, j + 1), c = point(i + 1, j + 1), d = point(i + 1, j);
            if (i > 0) planet.tri(a, b, c, color, [0, 0, 0]);
            if (i < lat - 1) planet.tri(a, c, d, shade(color, .97), [0, 0, 0]);
        }
    const planetMesh = planet.build('planet', stage.scene, stage.flat);
    planetMesh.position.set(-1150, -470, 1420);
    planetMesh.rotation.set(.35, .2, .28);
    // Ring: two-sided bands, unlit with baked shading.
    const ring = new Geo({ vary: .03, seed: 4 });
    const ringColors = ['#c9b8e8', '#9f8fd0', '#e0d4f4', '#7f70b0', '#b6a6e0'];
    for (let band = 0; band < 5; band++) {
        const r0 = R * (1.35 + band * .14), r1 = r0 + R * .12;
        for (let k = 0; k < 48; k++) {
            const a0 = k / 48 * Math.PI * 2, a1 = (k + 1) / 48 * Math.PI * 2;
            const q = [[Math.cos(a0) * r0, 0, Math.sin(a0) * r0], [Math.cos(a1) * r0, 0, Math.sin(a1) * r0], [Math.cos(a1) * r1, 0, Math.sin(a1) * r1], [Math.cos(a0) * r1, 0, Math.sin(a0) * r1]];
            ring.quad(q[0], q[1], q[2], q[3], ringColors[band], [0, -10, 0]);
            ring.quad(q[0], q[1], q[2], q[3], shade(ringColors[band], .7), [0, 10, 0]);
        }
    }
    const ringMesh = ring.build('planet-ring', stage.scene, stage.unlit);
    ringMesh.parent = planetMesh;
    // Moon
    const moon = new Geo({ vary: .08, seed: 6 });
    moon.ico(0, 0, 0, 55, '#7d7a8c', { detail: 1, jitter: .06, colorOf: dy => dy > 25 ? '#928fa2' : dy < -25 ? '#5e5b6c' : '#7d7a8c' });
    const moonMesh = moon.build('moon', stage.scene, stage.flat);
    moonMesh.position.set(820, 230, 1550);
    // Nebula band: big additive veils.
    const veil = new StandardMaterial('nebula', stage.scene);
    veil.disableLighting = true;
    veil.emissiveColor = new Color3(1, 1, 1);
    veil.alpha = .025;
    veil.alphaMode = 1;
    veil.backFaceCulling = false;
    veil.disableDepthWrite = true;
    const nebula = new Geo({ vary: 0, seed: 8 });
    const random = rng(21);
    for (let i = 0; i < 28; i++) {
        const a = -1.3 + i * .095 + random() * .08;
        const d = 1850;
        nebula.at({ x: Math.sin(a) * d, y: 420 + Math.sin(i * .5) * 140 + (random() - .5) * 120, z: Math.cos(a) * d, yaw: a, roll: random() * 3 }, g =>
            g.ico(0, 0, 0, 120 + random() * 140, ['#6a3fb0', '#3f5fc0', '#a04fa8', '#4f3a9a'][i % 4], { sx: 1.6, sy: .6, sz: .25 }));
    }
    const nebulaMesh = nebula.build('nebula', stage.scene, veil);
    nebulaMesh.renderingGroupId = 0;
    for (const mesh of [planetMesh, moonMesh, nebulaMesh]) {
        mesh.parent = node;
        mesh.applyFog = false;
        meshes.push(mesh);
    }
    ringMesh.applyFog = false;
    meshes.push(ringMesh);
    return { node, meshes, planet: planetMesh };
}

export function createOrbit(stage, { rail, level }) {
    const seed = level.def?.seed ?? 303;
    const docks = (level.props ?? []).filter(p => p.kind === 'dock').map((p, index) => ({ ...p, index }));
    const yardFrom = docks.length ? docks[0].s - 600 : Infinity, yardTo = docks.length ? docks[docks.length - 1].s + 500 : -Infinity;
    const backdrop = buildBackdrop(stage);
    const spinners = new Set();
    const streamer = new ChunkStreamer(stage, {
        length: 60, ahead: 980, behind: 90,
        build(k, s0, s1) {
            const random = chunkRandom(seed, k);
            const lit = new Geo({ vary: .08, seed: seed + k });
            const glow = new Geo({ vary: 0 });
            const dust = new Geo({ vary: 0 });
            const yard = s1 > yardFrom && s0 < yardTo;
            // Rocks around the lane (decor only, outside the bounds)
            const count = yard ? 3 : 6;
            for (let i = 0; i < count; i++) {
                const side = random() < .5 ? -1 : 1;
                const x = side * (38 + random() * 120), y = -55 + random() * 115;
                const size = 1.8 + random() * random() * 13;
                const p = railPoint(rail, s0 + random() * (s1 - s0), x, y);
                rock(lit, p[0], p[1], p[2], size, ROCK[Math.floor(random() * ROCK.length)], random);
            }
            // Space dust streaking past (tiny and unlit)
            for (let i = 0; i < 26; i++) {
                const p = railPoint(rail, s0 + random() * (s1 - s0), (random() - .5) * 110, (random() - .5) * 80);
                const c = random() < .2 ? '#ffd9b0' : '#9fb3e8';
                dust.box(p[0], p[1], p[2], .14, .14, .14 + random() * .5, c);
            }
            // Lane beacons every chunk
            if (k % 2 === 0) for (const [x, y] of [[-27, -17], [27, -17], [-27, 21], [27, 21]]) {
                const p = railPoint(rail, s0, x, y);
                glow.box(p[0], p[1], p[2], .8, .8, .8, (k / 2) % 2 ? '#5fd8ff' : '#ff8a3d');
                lit.box(p[0], p[1] - .9, p[2], .3, 1.2, .3, STEEL);
            }
            // Scaffolding and debris, more of it in the shipyard
            if (random() < (yard ? .9 : .35)) {
                const side = random() < .5 ? -1 : 1;
                const p = railPoint(rail, s0 + random() * 60, side * (45 + random() * 60), -20 + random() * 50);
                girders(lit, p[0], p[1], p[2], 18 + random() * 30, random);
            }
            if (yard && random() < .7) {
                const side = random() < .5 ? -1 : 1;
                const p = railPoint(rail, s0 + 30, side * (75 + random() * 50), -10 + random() * 40);
                module(lit, p[0], p[1], p[2], random);
            }
            for (const dock of docks) if (dock.s >= s0 && dock.s < s1) dockFrame(lit, glow, rail, dock, dock.index);
            const meshes = [finish(lit, 'orbit' + k, stage), finish(glow, 'orbit-glow' + k, stage, stage.unlit), finish(dust, 'orbit-dust' + k, stage, stage.unlit)];
            // One big tumbling asteroid far out
            if (random() < .6) {
                const big = new Geo({ vary: .1, seed: k });
                const color = ROCK[Math.floor(random() * ROCK.length)];
                rock(big, 0, 0, 0, 14 + random() * 18, color, random);
                const mesh = finish(big, 'orbit-big' + k, stage);
                const side = random() < .5 ? -1 : 1;
                const p = railPoint(rail, s0 + random() * 60, side * (110 + random() * 120), -40 + random() * 100);
                mesh.position.set(p[0], p[1], p[2]);
                mesh.metadata = { spin: (random() - .5) * .3, tilt: (random() - .5) * .2 };
                spinners.add(mesh);
                meshes.push(mesh);
            }
            return meshes;
        }
    });

    return {
        streamer,
        bounds: level.def?.bounds ?? [22, -14, 18],
        floor: () => (level.def?.bounds ?? [22, -14, 18])[1],
        collide(s, x, y) {
            for (const dock of docks) {
                if (Math.abs(s - dock.s) > 6.5) continue;
                for (const beam of DOCK_BEAMS[dock.index % 3]) {
                    const dx = x - beam.x, dy = y - beam.y;
                    if (Math.abs(dx) < beam.w / 2 + 1 && Math.abs(dy) < beam.h / 2 + 1) {
                        // Push out along the shorter way
                        const ox = beam.w / 2 + 1 - Math.abs(dx), oy = beam.h / 2 + 1 - Math.abs(dy);
                        return ox < oy ? { x: Math.sign(dx) || 1, y: 0 } : { x: 0, y: Math.sign(dy) || 1 };
                    }
                }
            }
            return null;
        },
        update(sCam) {
            streamer.update(sCam);
            backdrop.node.position.copyFrom(stage.camera.position);
            backdrop.planet.rotation.y += .00008;
            const dt = Math.min(.05, stage.engine.getDeltaTime() / 1000);
            for (const mesh of spinners) {
                if (mesh.isDisposed()) { spinners.delete(mesh); continue; }
                mesh.rotation.y += mesh.metadata.spin * dt;
                mesh.rotation.x += mesh.metadata.tilt * dt;
            }
        },
        dispose() {
            streamer.dispose();
            for (const mesh of backdrop.meshes) mesh.dispose();
            backdrop.node.dispose();
        }
    };
}
