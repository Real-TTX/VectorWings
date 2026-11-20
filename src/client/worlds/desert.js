// Mission 2 · Wüstenbahn: a sand floor with low dunes in a red sandstone canyon at sunset, the railway of the convoy along the
// route (with the escorted train), cacti and rocks, mesas with hoodoo spires and the trestle bridges of the old line.
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { ChunkStreamer, Geo, boulder, chunkRandom, finish, railPoint, shade, terrainStrip } from './common.js';
import { fbm, noise2 } from '../render/kit.js';
import { THEMES } from './themes.js';

// A touch warmer and clearer than the shared default.
Object.assign(THEMES.desert, {
    sky: { top: '#3a3a8c', middle: '#a36aa0', horizon: '#ffb877', bottom: '#eaa47a' },
    fog: { color: '#f0aa82', density: .0021 },
    hemi: { sky: '#e6b6c8', ground: '#b0603c', intensity: .75 }
});

const STRATA = ['#b4553a', '#cf6a42', '#e08a55', '#c25d3d', '#eba36a', '#9c4632', '#d7774a'];
const SAND = ['#e6b476', '#ddaa6a', '#eabd82', '#d9a263'];
const PLATEAU = ['#d49a5c', '#c88b4f', '#dca56a'];
const CACTUS = '#5f8f4a', WOOD = '#6b4a33', IRON = '#4a4148';

function dune(s, x) {
    const flat = Math.min(1, Math.max(0, (Math.abs(x) - 4) / 10));
    return -.35 + (noise2(s / 26, x / 15, 41) - .45) * 1.8 * flat + Math.sin(s / 37 + x / 21) * .35 * flat;
}

function cliffBase(s, side) {
    return 52 + fbm(s / 150, side * 4.3, 51) * 24;
}

function cliffHeight(s, side) {
    return 36 + fbm(s / 95, side * 7.9, 63) * 66;
}

function profile(s, side) {
    const c = cliffBase(s, side), h = cliffHeight(s, side);
    const j = (k, a) => (noise2(s / 9, k * 5.1 + side * 17, 9) - .5) * a;
    const xs = [0, 6, 13, 21, 30, 40];
    const floor = xs.filter(x => x < c - 6).map(x => [x, dune(s, x * side)]);
    return [
        ...floor,
        [c - 4 + j(1, 2), 1.2 + j(2, .6)], [c + 1 + j(3, 2), h * .22 + j(4, 3)], [c + 4 + j(5, 2), h * .5 + j(6, 4)],
        [c + 9 + j(7, 2), h * .78 + j(8, 3)], [c + 12 + j(9, 2), h + j(10, 2)], [c + 30 + j(11, 6), h + 2 + j(12, 2)],
        [c + 75 + j(13, 10), h + 10 + j(14, 6)], [c + 170, h + 26]
    ].map(([x, y]) => [x * side, y]);
}

function color(y, flat, s, i) {
    if (y < 2.2) return flat > .9 ? SAND[(i + Math.floor(s / 7)) % SAND.length] : shade(SAND[1], .92);
    if (flat > .82) return PLATEAU[Math.floor(Math.abs(y * 3) + i) % PLATEAU.length];
    return STRATA[Math.floor(Math.abs(y) / 6.5) % STRATA.length];
}

function cactus(geo, x, y, z, size, random) {
    geo.box(x, y + size * .9, z, size * .32, size * 1.8, size * .32, CACTUS, { top: shade(CACTUS, 1.15) });
    if (random() < .8) {
        const side = random() < .5 ? -1 : 1;
        geo.box(x + side * size * .35, y + size * .9, z, size * .4, size * .2, size * .24, CACTUS);
        geo.box(x + side * size * .55, y + size * 1.25, z, size * .22, size * .7, size * .22, shade(CACTUS, 1.08));
    }
    if (random() < .5) {
        const side = random() < .5 ? -1 : 1;
        geo.box(x, y + size * .7, z + side * size * .3, size * .2, size * .18, size * .35, CACTUS);
        geo.box(x, y + size * 1.0, z + side * size * .48, size * .2, size * .55, size * .2, CACTUS);
    }
}

function deadTree(geo, x, y, z, size, random) {
    geo.box(x, y + size * .6, z, size * .16, size * 1.2, size * .16, '#7a5a42');
    for (let k = 0; k < 3; k++) {
        const a = random() * Math.PI * 2;
        geo.at({ x: x + Math.cos(a) * size * .2, y: y + size * (.9 + k * .15), z: z + Math.sin(a) * size * .2, yaw: a, roll: .8 }, g =>
            g.box(0, size * .25, 0, size * .08, size * .55, size * .08, '#6f5038'));
    }
}

/** One stepped mesa (2–3 tiers with strata) at world point p. */
function mesa(geo, p, radius, height, random) {
    let r = radius, y = -2, tier = 0;
    while (y < height - 2) {
        const h = Math.min(height - y, height * (.35 + random() * .2));
        const top = tier === 0 ? r * .82 : r * .78;
        geo.cylinder(p[0], y + h / 2, p[2], r, h, 7, STRATA[(tier * 2 + 1) % STRATA.length], { radiusTop: top, top: PLATEAU[tier % 3] });
        y += h;
        r = top * (.72 + random() * .12);
        tier++;
        if (tier > 2) break;
    }
}

function hoodoo(geo, p, radius, height) {
    geo.cylinder(p[0], height * .3, p[2], radius, height * .6, 6, STRATA[1], { radiusTop: radius * .72 });
    geo.cylinder(p[0], height * .72, p[2], radius * .72, height * .25, 6, STRATA[3], { radiusTop: radius * .55 });
    geo.cylinder(p[0], height * .92, p[2], radius * 1.25, height * .16, 6, STRATA[5], { radiusTop: radius * 1.05, top: PLATEAU[0] });
}

const LEG_X = 13;

function bridge(geo, rail, prop) {
    const s = prop.s, deck = prop.y;
    const heading = rail.heading(s);
    const center = railPoint(rail, s, 0, 0);
    geo.at({ x: center[0], y: 0, z: center[2], yaw: heading }, g => {
        // Deck and rails on top
        g.box(0, deck + 1.2, 0, 190, 2.4, 6, '#8a5a3c', { top: '#6e4a34' });
        g.box(0, deck + 2.55, -1.1, 190, .3, .25, IRON);
        g.box(0, deck + 2.55, 1.1, 190, .3, .25, IRON);
        // Truss below the deck
        for (let x = -84; x <= 84; x += 12) {
            g.at({ x, y: deck - 1.6, z: 0, roll: .55 }, b => b.box(0, 0, -2.6, .5, 7, .5, '#5a3a2a'));
            g.at({ x, y: deck - 1.6, z: 0, roll: -.55 }, b => b.box(0, 0, 2.6, .5, 7, .5, '#5a3a2a'));
        }
        g.box(0, deck - 4.6, 0, 190, .5, .6, '#5a3a2a');
        // Legs: two inside the flight lane, more outside
        for (const x of [-LEG_X, LEG_X, -40, 40, -68, 68]) {
            g.box(x, deck / 2 - .5, -2.2, 1.4, deck + 1, 1.4, '#7a4c34', { top: '#6e4a34' });
            g.box(x, deck / 2 - .5, 2.2, 1.4, deck + 1, 1.4, '#7a4c34', { top: '#6e4a34' });
            g.box(x, deck * .45, 0, 1, 1, 5.4, '#5a3a2a');
            g.box(x, -1, 0, 4.2, 2.5, 7, STRATA[2], { top: PLATEAU[1] });
        }
    });
}

function track(geo, rail, s0, s1) {
    for (let s = s0; s < s1; s += 3) {
        const p = railPoint(rail, s + 1.5, 0, 0);
        const heading = rail.heading(s + 1.5);
        geo.at({ x: p[0], y: 0, z: p[2], yaw: heading }, g => {
            g.box(0, -.3, 0, 4.4, .5, 3.05, '#b48c66', { top: '#c29b74' });
            g.box(0, .02, 0, 3.4, .16, .7, WOOD);
            g.box(-.78, .18, 0, .2, .2, 3.05, IRON, { top: '#b8bec8' });
            g.box(.78, .18, 0, .2, .2, 3.05, IRON, { top: '#b8bec8' });
        });
    }
}

/** The escorted train: locomotive + wagons, each its own mesh so they follow the curve of the track. */
function buildTrain(stage) {
    const cars = [];
    const loco = new Geo({ vary: .04, seed: 61 });
    loco.box(0, 2.1, 0, 3.1, 2.4, 8, '#2d5aa0', { top: '#3b6dbb', tx: .95 });
    loco.box(0, 3.6, -1.8, 3.0, 1.4, 4.2, '#24497f', { top: '#e7b23c' });
    loco.box(0, 2.0, 4.05, 2.6, 1.6, .2, '#e7b23c');
    loco.box(0, 1.1, 0, 3.2, .35, 8.2, '#e7b23c');
    loco.box(0, .5, 0, 2.4, .7, 7.4, '#2a2a30');
    loco.box(0, 4.6, 2.2, .7, 1.4, .7, '#2a2a30');
    cars.push(loco.build('train-loco', stage.scene, stage.flatShiny));
    for (let i = 0; i < 3; i++) {
        const wagon = new Geo({ vary: .04, seed: 62 + i });
        const body = ['#e8dcc4', '#3f8f86', '#e8dcc4'][i];
        wagon.box(0, 2.2, 0, 3.0, 2.6, 8.2, body, { top: '#9a6a4a', tx: .96 });
        wagon.box(0, 3.65, 0, 2.6, .35, 8.0, '#7a5038');
        for (const z of [-2.6, 0, 2.6]) for (const x of [-1.52, 1.52]) wagon.box(x, 2.6, z, .05, .9, 1.6, '#2b3550');
        wagon.box(0, 1.2, 0, 3.1, .3, 8.3, '#c9503a');
        wagon.box(0, .5, 0, 2.2, .7, 7.4, '#2a2a30');
        cars.push(wagon.build('train-wagon', stage.scene, stage.flatShiny));
    }
    for (const car of cars) car.rotationQuaternion = new Quaternion();
    return cars;
}

export function createDesert(stage, { rail, level }) {
    const seed = level.def.seed;
    const mesas = level.props.filter(p => p.kind === 'mesa');
    const bridges = level.props.filter(p => p.kind === 'bridge');
    // Every other mesa puts a sandstone spire into the lane.
    const spires = mesas.filter((_, i) => i % 2 === 0).map((m, i) => ({ s: m.s + 14, x: i % 2 ? -10 : 9, r: 3.4, h: 34 }));
    const streamer = new ChunkStreamer(stage, {
        length: 60,
        build(k, s0, s1) {
            const geo = new Geo({ vary: .07, seed: seed + k });
            const random = chunkRandom(seed, k);
            for (const side of [-1, 1]) {
                terrainStrip(geo, rail, s0, s1, 6, s => profile(s, side), color, side);
                for (let i = 0; i < 7; i++) {
                    const s = s0 + random() * (s1 - s0);
                    const c = cliffBase(s, side);
                    const top = random() < .35;
                    const x = top ? c + 16 + random() * 55 : 22 + random() * Math.max(1, c - 28);
                    const y = top ? cliffHeight(s, side) + 1.5 : dune(s, x * side);
                    const p = railPoint(rail, s, side * x, y);
                    const roll = random();
                    if (roll < .45) cactus(geo, p[0], p[1], p[2], 1.6 + random() * 1.6, random);
                    else if (roll < .6) deadTree(geo, p[0], p[1], p[2], 2.4 + random() * 1.6, random);
                    else boulder(geo, p[0], p[1] + .4, p[2], 1.2 + random() * 2.4, STRATA[Math.floor(random() * STRATA.length)]);
                }
                if (random() < .5) {
                    // Telegraph pole of the old line
                    const s = s0 + random() * (s1 - s0);
                    const p = railPoint(rail, s, side * 33, dune(s, side * 33));
                    geo.box(p[0], p[1] + 4, p[2], .35, 8, .35, WOOD);
                    geo.at({ x: p[0], y: p[1] + 7.4, z: p[2], yaw: rail.heading(s) }, g => g.box(0, 0, 0, 2.4, .25, .25, WOOD));
                }
            }
            track(geo, rail, s0, s1);
            for (const ground of level.grounds) {
                if (ground.s < s0 || ground.s >= s1) continue;
                const p = railPoint(rail, ground.s, ground.x, 0);
                geo.cylinder(p[0], -1.1, p[2], 3.6, 2.6, 7, STRATA[2], { radiusTop: 3.0, top: PLATEAU[1] });
            }
            mesas.forEach((m, i) => {
                if (m.s < s0 || m.s >= s1) return;
                const r = chunkRandom(seed + 7, i);
                for (const side of [-1, 1]) {
                    const p = railPoint(rail, m.s + side * 6, side * (34 + r() * 6), 0);
                    mesa(geo, p, 9 + r() * 3, 48 + r() * 26, r);
                }
            });
            for (const spire of spires) if (spire.s >= s0 && spire.s < s1) hoodoo(geo, railPoint(rail, spire.s, spire.x, 0), spire.r, spire.h);
            for (const b of bridges) if (b.s >= s0 && b.s < s1) bridge(geo, rail, b);
            return [finish(geo, 'desert' + k, stage)];
        }
    });
    const train = buildTrain(stage);
    const haltAt = level.def.speed * (level.def.bossAt - 5) + 110;
    const position = new Vector3();

    return {
        streamer,
        bounds: level.def.bounds,
        floor: () => 1.6,
        groundY: () => 0,
        collide(s, x, y) {
            for (const b of bridges) {
                if (Math.abs(s - b.s) > 3.8) continue;
                if (y > b.y - 1.4 && y < b.y + 3.8) return { x: 0, y: y < b.y + 1.2 ? -1 : 1 };
                for (const leg of [-LEG_X, LEG_X]) if (Math.abs(x - leg) < 1.9 && y < b.y) return { x: Math.sign(x - leg) || 1, y: 0 };
            }
            for (const spire of spires) {
                if (Math.abs(s - spire.s) > spire.r + 1 || y > spire.h) continue;
                if ((s - spire.s) ** 2 + (x - spire.x) ** 2 < (spire.r + 1.1) ** 2) return { x: Math.sign(x - spire.x) || 1, y: 0 };
            }
            return null;
        },
        update(sCam) {
            streamer.update(sCam);
            // The train rolls along with the squadron, a little ahead.
            // The train halts before the worm breaches; the squadron flies on over it.
            const front = Math.min(sCam + 120, haltAt);
            train.forEach((car, i) => {
                const s = front - i * 9;
                rail.toWorld(s, 0, .2, position);
                car.position.copyFrom(position);
                Quaternion.RotationYawPitchRollToRef(rail.heading(s), 0, 0, car.rotationQuaternion);
            });
        },
        dispose() {
            streamer.dispose();
            for (const car of train) car.dispose();
        }
    };
}
