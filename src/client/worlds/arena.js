// The all-range arena "Smaragdsee": a mountain lake with stone arches, sea stacks, floating islands and the old beacon tower.
import { Geo, fbm, rng, shade } from '../render/kit.js';
import { boulder, tree } from './common.js';

const ROCK = ['#8e7c6c', '#a28c76', '#7a6a5e', '#b39a80'];
const GRASS = ['#5f9a48', '#6eaa52', '#558a40'];

export function createArena(stage, { field }) {
    const random = rng(field.seed ?? 77);
    const lit = new Geo({ vary: .07, seed: 5 });
    const radius = field.radius;
    const solids = [];

    // Shore and hills: a ring of terrain around the lake.
    const ringHeight = (angle, r) => {
        const rise = Math.max(0, r - 215);
        return -3 + rise * .55 + fbm(Math.cos(angle) * 2 + 9, Math.sin(angle) * 2 + 9, 31, 3) * rise * .5;
    };
    const rings = [150, 215, 235, 260, 300, 360, 460];
    const steps = 72;
    for (let i = 0; i < rings.length - 1; i++) {
        for (let k = 0; k < steps; k++) {
            const a0 = k / steps * Math.PI * 2, a1 = (k + 1) / steps * Math.PI * 2;
            const p = (a, r) => [Math.cos(a) * r, ringHeight(a, r), Math.sin(a) * r];
            const A = p(a0, rings[i]), B = p(a1, rings[i]), C = p(a1, rings[i + 1]), D = p(a0, rings[i + 1]);
            const color = y => y < .8 ? '#d9c590' : y > 60 ? '#9aa39a' : y > 35 ? ROCK[k % 4] : GRASS[(k + i) % 3];
            lit.tri(A, B, C, color((A[1] + B[1] + C[1]) / 3), [0, -1000, 0], true);
            lit.tri(A, C, D, color((A[1] + C[1] + D[1]) / 3), [0, -1000, 0], true);
        }
    }
    for (let i = 0; i < 90; i++) {
        const a = random() * Math.PI * 2, r = 222 + random() * 110;
        const y = ringHeight(a, r);
        if (y < 1 || y > 40) continue;
        tree(lit, Math.cos(a) * r, y, Math.sin(a) * r, 3 + random() * 3, random, GRASS.map(c => shade(c, .8)));
    }

    // Beacon tower on the central island.
    lit.cylinder(0, -2, 0, 24, 12, 9, ROCK[0], { radiusTop: 18, top: GRASS[0] });
    lit.cylinder(0, 10, 0, 7, 24, 8, '#d8d2c4', { radiusTop: 5.5 });
    lit.cylinder(0, 26, 0, 6.5, 8, 8, '#b84a3a', { radiusTop: 5.5 });
    lit.cylinder(0, 34, 0, 5.4, 8, 8, '#d8d2c4', { radiusTop: 4.6 });
    lit.cylinder(0, 40, 0, 6, 1.5, 8, '#3b3f4a');
    lit.cone(0, 45, 0, 5.4, 5, 8, '#b84a3a');
    solids.push({ x: 0, z: 0, r: 20, top: 9 }, { x: 0, z: 0, r: 7.5, top: 48 });
    const beacon = new Geo({ vary: 0 });
    beacon.ico(0, 41.5, 0, 2.4, '#ffd34a');

    // Stone arches over the water.
    for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + Math.PI / 4;
        const cx = Math.cos(a) * 95, cz = Math.sin(a) * 95;
        lit.at({ x: cx, z: cz, yaw: -a }, g => {
            const span = 26, height = 30;
            for (let k = 0; k < 14; k++) {
                const u0 = k / 14, u1 = (k + 1) / 14;
                const pt = (u, off) => [Math.cos(Math.PI * u) * (span + off), Math.sin(Math.PI * u) * (height + off), 0];
                const i0 = pt(u0, 0), i1 = pt(u1, 0), o0 = pt(u0, 9), o1 = pt(u1, 9);
                const color = ROCK[k % 4];
                const f = z => p => [p[0], p[1], z];
                const c = [0, height * .6, 0];
                g.quad(f(-5)(i0), f(-5)(i1), f(-5)(o1), f(-5)(o0), color, c);
                g.quad(f(5)(i0), f(5)(i1), f(5)(o1), f(5)(o0), shade(color, .9), c);
                g.quad(f(-5)(i0), f(-5)(i1), f(5)(i1), f(5)(i0), shade(color, .75), c);
                g.quad(f(-5)(o0), f(-5)(o1), f(5)(o1), f(5)(o0), k % 3 ? GRASS[k % 3] : color, c);
            }
            g.cylinder(-span - 4.5, -4, 0, 8, 10, 7, ROCK[2], { radiusTop: 6 });
            g.cylinder(span + 4.5, -4, 0, 8, 10, 7, ROCK[2], { radiusTop: 6 });
        });
        // Collision: the two legs and the crown of the arch.
        for (let k = 0; k <= 10; k++) {
            const u = k / 10;
            const lx = Math.cos(Math.PI * u) * 30.5, ly = Math.sin(Math.PI * u) * 34.5;
            solids.push({ x: cx + Math.sin(a) * lx, z: cz - Math.cos(a) * lx, y: ly, sphere: 6 });
        }
    }

    // Sea stacks
    for (let i = 0; i < 7; i++) {
        const a = i / 7 * Math.PI * 2 + .3, r = 55 + (i % 3) * 30;
        const x = Math.cos(a) * r, z = Math.sin(a) * r, h = 22 + (i % 4) * 9, w = 5 + (i % 3) * 1.5;
        lit.cylinder(x, h / 2 - 4, z, w * 1.3, h + 8, 6, ROCK[i % 4], { radiusTop: w * .8, top: GRASS[i % 3] });
        if (i % 2) tree(lit, x, h + 0, z, 3, random);
        solids.push({ x, z, r: w * 1.2, top: h + 4 });
    }

    // Floating islands
    for (let i = 0; i < 3; i++) {
        const a = i / 3 * Math.PI * 2 + 1, r = 120;
        const x = Math.cos(a) * r, z = Math.sin(a) * r, y = 58 + i * 6;
        lit.ico(x, y - 4, z, 13, ROCK[i], { detail: 1, jitter: .2, sy: .9, colorOf: dy => dy > 4 ? GRASS[i] : ROCK[(i + 1) % 4] });
        lit.cylinder(x, y + 3, z, 12, 2, 8, GRASS[i], { radiusTop: 10 });
        tree(lit, x + 3, y + 4, z - 2, 3.5, random);
        tree(lit, x - 4, y + 4, z + 3, 3, random);
        solids.push({ x, z, y: y - 2, sphere: 13 });
    }
    for (let i = 0; i < 30; i++) {
        const a = random() * Math.PI * 2, r = 212 + random() * 8;
        boulder(lit, Math.cos(a) * r, 0, Math.sin(a) * r, 2 + random() * 3, ROCK[i % 4]);
    }

    const mesh = lit.build('arena', stage.scene, stage.flat);
    const glow = beacon.build('beacon', stage.scene, stage.glowMaterial('#ffd34a', 1.6));
    stage.addGlow(glow);

    return {
        groundY(position) {
            const r = Math.hypot(position.x, position.z);
            if (r < 215) return 0;
            return Math.max(0, ringHeight(Math.atan2(position.z, position.x), r));
        },
        collide(x, y, z) {
            for (const s of solids) {
                if (s.sphere) { if ((x - s.x) ** 2 + (y - s.y) ** 2 + (z - s.z) ** 2 < s.sphere * s.sphere) return true; }
                else if ((x - s.x) ** 2 + (z - s.z) ** 2 < s.r * s.r && y < s.top) return true;
            }
            const r = Math.hypot(x, z);
            return r > 215 && y < ringHeight(Math.atan2(z, x), r) + 1;
        },
        update(_, t) { glow.scaling.setAll(1 + Math.sin((t ?? 0) * 4) * .12); },
        dispose() { mesh.dispose(); glow.dispose(); }
    };
}
