// Mission 4 · Abendstadt: a broad avenue through the ruined old town of Altglanz at sunset. Stone and brick blocks with
// broken roofs and warm windows line the lane, clock towers stand beside it, monumental gateways span it, dark spires
// fill the horizon.
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { ChunkStreamer, Geo, boulder, chunkRandom, finish, railPoint, shade, terrainStrip } from './common.js';
import { mix, rng } from '../render/kit.js';
import { THEMES } from './themes.js';

// The skyline below replaces the theme's hills; a little more haze makes the far blocks melt into the evening sky.
THEMES.city.mountains = null;
THEMES.city.fog = { color: '#d8775c', density: .0024 };

const STONE = ['#b8957c', '#a8826c', '#c4a284', '#9a7a68'];
const BRICK = ['#9a5444', '#8a4a3e', '#a86452', '#7e4638'];
const PLASTER = ['#c9a48a', '#b99079', '#d2b092'];
const DARK = ['#5a4252', '#4c3848', '#644a58'];
const ROOF = ['#5a3a3e', '#4a3440', '#6a4446'];
const WINDOW_DARK = '#2a1f2c';
const WINDOW_LIT = ['#ffcf7a', '#ffb45a', '#ffe2a0'];
const LANE = 19;

function pick(list, random) { return list[Math.floor(random() * list.length)]; }

/** Inner edge (bottom) of a gateway at lateral x. */
export function gateInner(prop, x) {
    const u = Math.min(1, Math.abs(x - prop.x) / 21);
    return prop.y + 2.6 * (1 - u * u);
}

/**
 * One building block in rail-aligned local space (x across, z along the rail, y up), facing the lane on `side`.
 * Windows on the lane facade: dark ones in `geo`, lit ones in `glow`.
 */
function building(geo, glow, rail, s, x, side, width, depth, height, random, { ruined = false, back = false } = {}) {
    const p = railPoint(rail, s, x, 0);
    const heading = rail.heading(s);
    const palette = back ? DARK : pick([STONE, BRICK, PLASTER], random);
    const wall = pick(palette, random);
    const roof = back ? shade(wall, .8) : pick(ROOF, random);
    const face = -side * width / 2;
    const lit = [];
    const place = g => {
        g.box(0, height / 2, 0, width, height, depth, wall, { top: roof });
        if (!back) {
            // Cornice and ground-floor plinth
            g.box(0, height + .4, 0, width + .8, .8, depth + .8, shade(wall, .82));
            g.box(face - side * .15, 1.4, 0, .3, 2.8, depth + .3, shade(wall, .7));
        }
        if (ruined) {
            // Broken crown: stepped stumps of the upper floors, a gap where the roof fell in.
            const stumps = 2 + Math.floor(random() * 3);
            for (let i = 0; i < stumps; i++) {
                const w = width * (.25 + random() * .35), dz = depth * (.2 + random() * .3), h = 2 + random() * 7;
                const ox = (random() - .5) * (width - w), oz = (random() - .5) * (depth - dz);
                g.box(ox, height + h / 2, oz, w, h, dz, wall, { top: shade(wall, .75), tx: .7 + random() * .3 });
            }
        } else if (!back) {
            if (random() < .5) g.box((random() - .5) * width * .4, height + 1.6, (random() - .5) * depth * .4, 2, 3.2, 2, shade(roof, .9));
            if (random() < .35) g.box(0, height + 2.2, 0, width * .6, 3.6, depth * .8, roof, { tx: .1 });
        }
        // Windows on the facade towards the lane
        const floors = Math.floor((height - 3) / 3.4);
        const columns = Math.max(1, Math.floor(depth / 2.8));
        for (let f = 0; f < floors; f++) {
            for (let c = 0; c < columns; c++) {
                const y = 3.4 + f * 3.4, z = -depth / 2 + (c + .5) * depth / columns;
                const on = random() < (back ? .18 : .3) && !(ruined && f >= floors - 1);
                const xf = face - side * .06, h = 1.6, w = .7;
                const quad = [[xf, y, z - w], [xf, y, z + w], [xf, y + h, z + w], [xf, y + h, z - w], on ? pick(WINDOW_LIT, random) : WINDOW_DARK, [0, y, z]];
                if (on) lit.push(quad);
                else g.quad(...quad);
            }
        }
    };
    geo.at({ x: p[0], y: 0, z: p[2], yaw: heading }, place);
    // The lit windows live in their own mesh (unlit material) with the same transform.
    if (lit.length) glow.at({ x: p[0], y: 0, z: p[2], yaw: heading }, g => { for (const quad of lit) g.quad(...quad); });
}

function lamp(geo, light, rail, s, side) {
    const p = railPoint(rail, s, side * 23, 0);
    const heading = rail.heading(s);
    geo.at({ x: p[0], y: 0, z: p[2], yaw: heading }, g => {
        g.box(0, 3.6, 0, .35, 7.2, .35, '#2c2630');
        g.box(-side * .9, 7.1, 0, 1.9, .25, .25, '#2c2630');
    });
    light.at({ x: p[0], y: 0, z: p[2], yaw: heading }, g => g.box(-side * 1.7, 6.8, 0, .6, .5, .6, '#ffd890'));
}

function clockTower(geo, light, rail, prop) {
    const side = prop.x < 0 ? -1 : 1;
    const p = railPoint(rail, prop.s, side * 31, 0);
    const heading = rail.heading(prop.s);
    const wall = '#a88670', trim = '#7a5a4c';
    const build = g => {
        g.box(0, 3, 0, 14, 6, 14, trim);
        g.box(0, 30, 0, 10, 50, 10, wall, { top: trim });
        for (const y of [18, 36]) g.box(0, y, 0, 10.8, .9, 10.8, trim);
        g.box(0, 58, 0, 11, 4, 11, trim);
        // Belfry: four pillars around a dark room
        g.box(0, 64, 0, 7, 8, 7, '#2a1f2c');
        for (const [cx, cz] of [[-4.6, -4.6], [4.6, -4.6], [-4.6, 4.6], [4.6, 4.6]]) g.box(cx, 64, cz, 1.6, 8, 1.6, wall);
        g.box(0, 68.6, 0, 11.4, 1.4, 11.4, trim);
        g.cone(0, 77, 0, 7.6, 16, 4, '#5a3640');
        g.box(0, 86, 0, .3, 3, .3, '#2c2630');
    };
    geo.at({ x: p[0], y: 0, z: p[2], yaw: heading }, build);
    light.at({ x: p[0], y: 0, z: p[2], yaw: heading }, g => {
        // Clock faces towards the incoming squadron and towards the avenue
        g.at({ y: 45, z: -5.15, pitch: Math.PI / 2 }, c => c.cylinder(0, 0, 0, 3.6, .12, 12, '#ffe6b0'));
        g.at({ y: 45, x: -side * 5.15, roll: Math.PI / 2 }, c => c.cylinder(0, 0, 0, 3.6, .12, 12, '#ffe6b0'));
        g.box(0, 64, 0, 1.4, 1.4, 1.4, '#ffcf6a');
    });
    // Hands of the clock (dark, on the lit face)
    geo.at({ x: p[0], y: 0, z: p[2], yaw: heading }, g => {
        g.box(0, 46.2, -5.3, .35, 2.6, .1, '#2a1f24');
        g.at({ y: 45, z: -5.3, roll: 1.1 }, h => h.box(0, .9, 0, .3, 1.9, .1, '#2a1f24'));
    });
}

function gateway(geo, light, rail, prop) {
    const s0 = prop.s - 6, s1 = prop.s + 6;
    const top = prop.y + 13;
    const stone = '#b08c74', dark = '#7c5e50';
    const center = railPoint(rail, prop.s, prop.x, prop.y + 6);
    // Pylons
    for (const side of [-1, 1]) {
        const p = railPoint(rail, prop.s, prop.x + side * 27, 0);
        geo.at({ x: p[0], y: 0, z: p[2], yaw: rail.heading(prop.s) }, g => {
            g.box(0, top / 2, 0, 12, top, 13, stone, { top: dark });
            g.box(0, top + 1.5, 0, 13.5, 3, 14.5, dark);
            g.box(0, top + 5, 0, 4, 4, 4, stone);
            g.box(-side * 6.1, 8, 0, .3, 12, 7, dark);
        });
        const q = railPoint(rail, prop.s, prop.x + side * 27, 0);
        light.at({ x: q[0], y: 0, z: q[2], yaw: rail.heading(prop.s) }, g => g.box(0, top + 7.6, 0, 1.4, 1.4, 1.4, '#ffcf6a'));
    }
    // Lintel with a shallow arched underside
    const steps = 12;
    for (let i = 0; i < steps; i++) {
        const x0 = prop.x - 22 + 44 * i / steps, x1 = prop.x - 22 + 44 * (i + 1) / steps;
        const y0 = gateInner(prop, x0), y1 = gateInner(prop, x1);
        const color = i % 2 ? stone : shade(stone, .94);
        const P = (s, x, y) => railPoint(rail, s, x, y);
        geo.quad(P(s0, x0, y0), P(s0, x1, y1), P(s0, x1, top), P(s0, x0, top), color, center);
        geo.quad(P(s1, x0, y0), P(s1, x1, y1), P(s1, x1, top), P(s1, x0, top), shade(color, .9), center);
        geo.quad(P(s0, x0, y0), P(s0, x1, y1), P(s1, x1, y1), P(s1, x0, y0), shade(stone, .62), center);
        geo.quad(P(s0, x0, top), P(s0, x1, top), P(s1, x1, top), P(s1, x0, top), dark, center);
    }
    // Frieze and an emblem facing the squadron
    const f = railPoint(rail, s0 - .1, prop.x, prop.y + 8.5);
    light.at({ x: f[0], y: f[1], z: f[2], yaw: rail.heading(prop.s) }, g => {
        g.at({ pitch: Math.PI / 2 }, c => c.cylinder(0, 0, 0, 2.6, .2, 6, '#ff9a4a'));
    });
    geo.at({ x: f[0], y: f[1], z: f[2], yaw: rail.heading(prop.s) }, g => {
        g.box(0, 0, -.15, 40, 1.2, .3, dark);
        g.box(0, 3.4, -.15, 40, .6, .3, dark);
    });
}

function skyline(stage) {
    const geo = new Geo({ vary: .04, seed: 41 });
    const random = rng(404);
    const far = '#4a2f50', near = '#3a2645', horizon = '#ff9351';
    const rings = [{ r: 1050, count: 70, h: 160, color: mix(far, horizon, .45) }, { r: 760, count: 60, h: 120, color: mix(near, horizon, .28) }];
    for (const ring of rings) {
        for (let i = 0; i < ring.count; i++) {
            const a = i / ring.count * Math.PI * 2 + random() * .05;
            const r = ring.r * (1 + (random() - .5) * .06);
            const w = 22 + random() * 40, h = ring.h * (.35 + random() * .75);
            const x = Math.cos(a) * r, z = Math.sin(a) * r;
            geo.at({ x, z, yaw: -a + Math.PI / 2 }, g => {
                g.box(0, h / 2 - 10, 0, w, h + 20, 14, ring.color);
                if (random() < .45) {
                    const sw = w * (.2 + random() * .2), sh = h * (.3 + random() * .5);
                    g.box((random() - .5) * w * .5, h + sh / 2 - 2, 0, sw, sh, 10, ring.color);
                    g.cone((random() - .5) * w * .5, h + sh + 12, 0, sw * .6, 28 + random() * 30, 4, ring.color);
                }
            });
        }
    }
    const mesh = geo.build('city-skyline', stage.scene, stage.unlit);
    mesh.applyFog = false;
    mesh.alwaysSelectAsActiveMesh = true;
    return mesh;
}

export function createCity(stage, { rail, level }) {
    const seed = level.def.seed;
    const towers = level.props.filter(p => p.kind === 'tower');
    const gates = level.props.filter(p => p.kind === 'gateway');
    const roofs = level.grounds.filter(g => g.y > 1);
    const sky = skyline(stage);

    const streamer = new ChunkStreamer(stage, {
        length: 60,
        ahead: 820,
        build(k, s0, s1) {
            const geo = new Geo({ vary: .06, seed: seed + k });
            const glow = new Geo({ vary: .1, seed: seed + k * 3 });
            const random = chunkRandom(seed, k);
            // Street, kerb, pavement and the ground behind the blocks
            for (const side of [-1, 1]) {
                terrainStrip(geo, rail, s0, s1, 12, () => [[0, 0], [21, 0], [21.1, .35], [25.5, .35], [25.6, 0], [700, 0]].map(([x, y]) => [x * side, y]),
                    (y, flat, s, i) => ['#3b3240', '#7a6a72', '#8e7a7a', '#7a6a72', '#4a3a44'][i] ?? '#4a3a44', side);
            }
            // Lane markings
            for (let s = s0; s < s1; s += 10) {
                const a = railPoint(rail, s, -.3, .03), b = railPoint(rail, s, .3, .03), c = railPoint(rail, s + 4.5, .3, .03), d = railPoint(rail, s + 4.5, -.3, .03);
                geo.quad(a, b, c, d, '#d9c8a0', [a[0], -10, a[2]]);
            }
            for (const side of [-1, 1]) {
                // Front row: the blocks along the avenue
                let s = s0 + random() * 6;
                while (s < s1) {
                    const depth = 10 + random() * 10;
                    const gate = gates.find(g => Math.abs(g.s - (s + depth / 2)) < 12) || towers.find(t => Math.abs(t.s - (s + depth / 2)) < 12 && Math.sign(t.x) === side);
                    if (!gate) {
                        const width = 10 + random() * 8;
                        const height = 12 + random() * 26;
                        building(geo, glow, rail, s + depth / 2, side * (27 + width / 2 + random() * 2), side, width, depth, height, random, { ruined: random() < .38 });
                        if (random() < .5) {
                            const q = railPoint(rail, s + random() * depth, side * (25 + random() * 2), .3);
                            boulder(geo, q[0], q[1], q[2], .8 + random() * 1.4, pick(STONE, random));
                        }
                    }
                    s += depth + .5 + random() * 3;
                }
                // Back rows: taller dark blocks with a few warm windows
                s = s0 + random() * 10;
                while (s < s1) {
                    const depth = 14 + random() * 16, width = 16 + random() * 20;
                    building(geo, glow, rail, s + depth / 2, side * (58 + random() * 40 + width / 2), side, width, depth, 28 + random() * 55, random, { back: true, ruined: random() < .25 });
                    s += depth + 4 + random() * 10;
                }
                for (let ls = Math.ceil(s0 / 22) * 22; ls < s1; ls += 22) lamp(geo, glow, rail, ls + (side > 0 ? 11 : 0), side);
                // Wrecks and rubble at the kerb
                if (random() < .45) {
                    const q = railPoint(rail, s0 + random() * 60, side * (15 + random() * 4), 0);
                    geo.at({ x: q[0], y: 0, z: q[2], yaw: rail.heading(s0) + (random() - .5) }, g => {
                        g.box(0, .7, 0, 2.2, 1.2, 4.4, '#4a3c42', { top: '#3a2f36' });
                        g.box(0, 1.6, -.3, 1.8, .8, 2.2, '#2f262c');
                    });
                }
            }
            // Rooftop gun posts: a narrow block under every turret
            for (const g of roofs) {
                if (g.s < s0 || g.s >= s1) continue;
                const side = Math.sign(g.x) || 1;
                building(geo, glow, rail, g.s, g.x + side * .5, side, 7, 9, g.y, random);
                const q = railPoint(rail, g.s, g.x, g.y);
                geo.at({ x: q[0], y: q[1], z: q[2], yaw: rail.heading(g.s) }, b => b.box(0, .2, 0, 6, .4, 7, '#3a2f36'));
            }
            for (const t of towers) if (t.s >= s0 && t.s < s1) clockTower(geo, glow, rail, t);
            for (const gate of gates) if (gate.s >= s0 && gate.s < s1) gateway(geo, glow, rail, gate);
            return [finish(geo, 'city' + k, stage), finish(glow, 'city-lights' + k, stage, stage.unlit)];
        }
    });

    return {
        streamer,
        bounds: level.def.bounds,
        floor: () => 3.2,
        groundY: () => 0,
        collide(s, x, y) {
            for (const gate of gates) {
                if (Math.abs(s - gate.s) > 6.6) continue;
                if (y > gateInner(gate, x) - 1.3) return { x: 0, y: -1 };
            }
            for (const g of roofs) {
                if (Math.abs(s - g.s) < 5 && Math.abs(x - g.x) < 4.2 && y < g.y + .5) return { x: -Math.sign(g.x), y: .4 };
            }
            return null;
        },
        update(sCam) {
            streamer.update(sCam);
            rail.toWorld(sCam, 0, 0, sky.position);
            sky.position.y = 0;
        },
        dispose() { streamer.dispose(); sky.dispose(); }
    };
}

void Mesh;
