// Mission 1 · Flusshafen: a turquoise river in a red sandstone canyon, green plateaus, stone arches and the harbour at the end.
import { ChunkStreamer, Geo, boulder, chunkRandom, finish, railPoint, shade, terrainStrip, tree } from './common.js';
import { fbm, noise2 } from '../render/kit.js';

const STRATA = ['#a9553a', '#c4683f', '#d9875a', '#b65f3e', '#e2a06d', '#c97a4c'];
const GRASS = ['#6e9c45', '#7cab4f', '#5f8d3c'];

export function riverWidth(s) {
    return 27 + Math.sin(s / 170) * 5 + Math.sin(s / 61) * 2;
}

function cliffBase(s, side) {
    return 46 + fbm(s / 140, side * 3.1, 21) * 22;
}

function cliffHeight(s, side) {
    return 38 + fbm(s / 90, side * 5.7, 33) * 70;
}

function profile(s, side) {
    const w = riverWidth(s), c = cliffBase(s, side), h = cliffHeight(s, side);
    const j = (k, a) => (noise2(s / 9, k * 7.3 + side * 31, 5) - .5) * a;
    return [
        [w - 3, -2.5], [w + 2 + j(1, 1.5), .3], [w + 8 + j(2, 2), 1.4], [c - 3 + j(3, 3), 2.2 + j(4, 1)],
        [c + 3 + j(5, 3), h * .32 + j(6, 4)], [c + 7 + j(7, 3), h * .7 + j(8, 5)], [c + 11 + j(9, 2), h + j(10, 3)],
        [c + 26 + j(11, 6), h + 2 + j(12, 2)], [c + 70 + j(13, 10), h + 8 + j(14, 8)], [c + 160, h + 30]
    ].map(([x, y]) => [x * side, y]);
}

function color(y, flat) {
    if (y < .9) return '#d8c08a';
    if (flat > .8) return y > 6 ? GRASS[Math.floor(Math.abs(y * 7)) % 3] : '#86b85a';
    if (flat > .55 && y > 6) return shade(GRASS[1], .85);
    return STRATA[Math.floor(Math.abs(y) / 7) % STRATA.length];
}

/** The inner edge of an arch at lateral x (relative to its centre). */
export function archInner(prop, x, s) {
    const half = Math.min(cliffBase(s, -1), cliffBase(s, 1)) + 2;
    const u = (x - prop.x) / half;
    if (Math.abs(u) >= 1) return 0;
    return prop.y * Math.pow(1 - u * u, .42);
}

function buildArch(geo, rail, prop) {
    const s0 = prop.s - 7, s1 = prop.s + 7;
    const half = Math.min(cliffBase(prop.s, -1), cliffBase(prop.s, 1)) + 2;
    const steps = 22;
    const inner = [], outer = [];
    for (let i = 0; i <= steps; i++) {
        const x = prop.x - half - 8 + (half * 2 + 16) * i / steps;
        const yi = Math.max(0, archInner(prop, x, prop.s)) + (Math.abs(x - prop.x) > half ? 2 : 0);
        const thickness = 10 + Math.abs(x - prop.x) / half * 12 + (noise2(i * .7, prop.s, 3) - .5) * 4;
        inner.push([x, yi]);
        outer.push([x, Math.max(yi + thickness, prop.y + 9 + (noise2(i * .5, prop.s, 8) - .5) * 5)]);
    }
    const sideColor = i => STRATA[(i + Math.floor(prop.s)) % STRATA.length];
    const center = railPoint(rail, prop.s, prop.x, prop.y + 5);
    for (let i = 0; i < steps; i++) {
        const quad = (s, a, b) => [railPoint(rail, s, a[0], a[1]), railPoint(rail, s, b[0], b[1])];
        const [fa, fb] = quad(s0, inner[i], inner[i + 1]);
        const [fc, fd] = quad(s0, outer[i + 1], outer[i]);
        const [ba, bb] = quad(s1, inner[i], inner[i + 1]);
        const [bc, bd] = quad(s1, outer[i + 1], outer[i]);
        geo.quad(fa, fb, fc, fd, sideColor(i), center);
        geo.quad(ba, bb, bc, bd, shade(sideColor(i), .9), center);
        geo.quad(fa, fb, bb, ba, shade(sideColor(i + 2), .7), center);
        geo.quad(fd, fc, bc, bd, i % 3 ? GRASS[i % 3] : sideColor(i + 1), center);
    }
    // Moss and a few trees on top.
    const random = chunkRandom(prop.s | 0, 3);
    for (let i = 2; i < steps - 2; i += 3) {
        if (random() < .5) continue;
        const p = railPoint(rail, prop.s + (random() - .5) * 8, outer[i][0], outer[i][1] - .5);
        tree(geo, p[0], p[1], p[2], 2.2 + random() * 1.5, random);
    }
}

function buildHarbour(geo, rail, s0, s1, random) {
    for (const side of [-1, 1]) {
        for (let s = s0 + 10; s < s1; s += 26) {
            const w = riverWidth(s);
            // Pier into the river
            const pier = railPoint(rail, s, side * (w - 2), .6);
            const heading = rail.heading(s);
            geo.at({ x: pier[0], y: pier[1], z: pier[2], yaw: heading }, g => {
                g.box(side * -3, 0, 0, 10, 1.2, 5, '#8a6a4e', { top: '#a7825e' });
                for (const dz of [-2, 2]) g.box(side * -7, -2, dz, .7, 5, .7, '#5d4636');
            });
            const yard = railPoint(rail, s, side * (w + 12), 1.6);
            geo.at({ x: yard[0], y: yard[1], z: yard[2], yaw: heading }, g => {
                const colors = ['#d9553f', '#3f7fd9', '#e7b23c', '#4fa36b', '#ececec'];
                for (let k = 0; k < 4; k++) {
                    const c = colors[Math.floor(random() * colors.length)];
                    g.box(side * (random() * 6), 1.3 + Math.floor(k / 2) * 2.6, (k % 2) * 6 - 3, 2.6, 2.6, 5.8, c, { top: shade(c, 1.15) });
                }
                if (random() < .55) {
                    // Crane
                    g.box(side * -4, 7, 0, 1.2, 14, 1.2, '#f0b429');
                    g.box(side * -9, 14, 0, 13, 1, 1, '#f0b429');
                    g.box(side * -14, 10, 0, .3, 7, .3, '#3a3a3a');
                    g.box(side * -14, 6.4, 0, 2.6, 2.4, 4.6, colors[Math.floor(random() * 5)]);
                }
            });
            if (random() < .6) {
                const hall = railPoint(rail, s + 8, side * (w + 26), 1.6);
                geo.at({ x: hall[0], y: hall[1], z: hall[2], yaw: heading }, g => {
                    g.box(0, 4, 0, 14, 8, 18, '#c9b79c', { top: '#3f5f8f' });
                    g.box(0, 9.5, 0, 14, 3, 18, '#3f5f8f', { tx: .1 });
                });
            }
        }
    }
}

export function createRiver(stage, { rail, level }) {
    const seed = level.def.seed;
    const arches = level.props.filter(p => p.kind === 'arch');
    const harbour = level.props.find(p => p.kind === 'harbour');
    const streamer = new ChunkStreamer(stage, {
        length: 60,
        build(k, s0, s1) {
            const geo = new Geo({ vary: .07, seed: seed + k });
            const random = chunkRandom(seed, k);
            for (const side of [-1, 1]) {
                terrainStrip(geo, rail, s0, s1, 6, s => profile(s, side), color, side);
                // Trees on the green bank and the plateau
                for (let i = 0; i < 9; i++) {
                    const s = s0 + random() * (s1 - s0);
                    const top = random() < .55;
                    const c = cliffBase(s, side), h = cliffHeight(s, side);
                    const x = top ? c + 14 + random() * 60 : riverWidth(s) + 9 + random() * Math.max(1, c - riverWidth(s) - 13);
                    const y = top ? h + 1.5 + (x - c - 14) / 60 * 2 : 2;
                    const p = railPoint(rail, s, side * x, y);
                    tree(geo, p[0], p[1], p[2], 2.4 + random() * 2.2, random);
                }
                if (random() < .55) {
                    const s = s0 + random() * (s1 - s0);
                    const p = railPoint(rail, s, side * (riverWidth(s) + 1 + random() * 3), .2);
                    boulder(geo, p[0], p[1], p[2], 1.6 + random() * 2, '#a46a4e');
                }
            }
            for (const ground of level.grounds) {
                if (ground.s < s0 || ground.s >= s1) continue;
                const p = railPoint(rail, ground.s, ground.x, -4);
                geo.at({ x: p[0], y: 0, z: p[2] }, g => {
                    g.cylinder(0, -2.6, 0, 3.6, 6, 7, '#b9653f', { radiusTop: 3.0, top: '#7cab4f' });
                });
            }
            for (const arch of arches) if (arch.s >= s0 && arch.s < s1) buildArch(geo, rail, arch);
            if (harbour && s1 > harbour.s && s0 < harbour.s + 900) buildHarbour(geo, rail, Math.max(s0, harbour.s), Math.min(s1, harbour.s + 900), random);
            return [finish(geo, 'river' + k, stage)];
        }
    });

    return {
        streamer,
        bounds: level.def.bounds,
        floor: () => 1.4,
        /** Solid scenery at rail position (s, x, y)? Returns the push direction or null. */
        collide(s, x, y) {
            for (const arch of arches) {
                if (Math.abs(s - arch.s) > 7.6) continue;
                const inner = archInner(arch, x, s);
                if (y > inner - 1.3) return { x: 0, y: -1 };
            }
            return null;
        },
        update(sCam) { streamer.update(sCam); },
        dispose() { streamer.dispose(); }
    };
}
