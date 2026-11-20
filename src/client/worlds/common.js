// Streaming of world chunks along the rail and the shared props (trees, rocks, pedestals).
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Geo, hash2, mix, shade } from '../render/kit.js';

const tmp = new Vector3();

/** Converts rail coordinates to a world point array for the kit. */
export function railPoint(rail, s, x, y) {
    rail.toWorld(s, x, y, tmp);
    return [tmp.x, tmp.y, tmp.z];
}

export function faceNormalY(a, b, c) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    return Math.abs(ny) / (Math.hypot(nx, ny, nz) || 1);
}

/**
 * Builds a terrain strip between two lateral profiles. `profile(s)` returns [[x, y], ...] from inside to outside;
 * `color(avgY, flatness, s, x)` picks the face colour. Rows every `step` along s.
 */
export function terrainStrip(geo, rail, s0, s1, step, profile, color, side = 1) {
    let previous = null;
    for (let s = s0; s <= s1 + .001; s += step) {
        const row = profile(s).map(([x, y]) => railPoint(rail, s, x, y));
        if (previous) {
            // Faces turn away from a point far outside and below: floors look up, walls look at the rail.
            const inside = railPoint(rail, s - step / 2, side * 600, -400);
            for (let i = 0; i < row.length - 1; i++) {
                const a = previous[i], b = previous[i + 1], c = row[i + 1], d = row[i];
                const y1 = (a[1] + b[1] + c[1]) / 3, y2 = (a[1] + c[1] + d[1]) / 3;
                geo.tri(a, b, c, color(y1, faceNormalY(a, b, c), s, i), inside, true);
                geo.tri(a, c, d, color(y2, faceNormalY(a, c, d), s, i), inside, true);
            }
        }
        previous = row;
    }
}

export function tree(geo, x, y, z, size, random, palette = ['#3f7a3a', '#4f8f40', '#2f6534']) {
    const leaf = palette[Math.floor(random() * palette.length)];
    geo.box(x, y + size * .5, z, size * .22, size, size * .22, '#6b4a33');
    if (random() < .5) {
        geo.cone(x, y + size * 1.35, z, size * .75, size * 1.4, 6, leaf);
        geo.cone(x, y + size * 2.05, z, size * .5, size * 1.0, 6, shade(leaf, 1.12));
    } else {
        geo.ico(x, y + size * 1.45, z, size * .78, leaf, { colorOf: dy => dy > 0 ? shade(leaf, 1.15) : leaf });
    }
}

export function boulder(geo, x, y, z, size, color) {
    geo.ico(x, y, z, size, color, { jitter: .25, sy: .7, colorOf: dy => dy > size * .2 ? shade(color, 1.12) : shade(color, .85) });
}

/** Keeps the chunks around the camera built and drops the ones left behind. */
export class ChunkStreamer {
    constructor(stage, { length = 60, ahead = 860, behind = 90, build }) {
        this.stage = stage;
        this.length = length;
        this.ahead = ahead;
        this.behind = behind;
        this.build = build;
        this.chunks = new Map();
    }

    update(sCam, budget = 2) {
        const first = Math.floor((sCam - this.behind) / this.length);
        const last = Math.floor((sCam + this.ahead) / this.length);
        for (const [k, meshes] of this.chunks) {
            if (k < first || k > last) {
                for (const mesh of meshes) mesh.dispose();
                this.chunks.delete(k);
            }
        }
        for (let k = first; k <= last && budget > 0; k++) {
            if (this.chunks.has(k)) continue;
            this.chunks.set(k, this.build(k, k * this.length, (k + 1) * this.length).filter(Boolean));
            budget--;
        }
    }

    dispose() {
        for (const meshes of this.chunks.values()) for (const mesh of meshes) mesh.dispose();
        this.chunks.clear();
    }
}

/** A deterministic random generator per chunk. */
export function chunkRandom(seed, k) {
    let state = Math.floor(hash2(k, seed, 77) * 4294967295) || 1;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function finish(geo, name, stage, material) {
    return geo.empty ? null : geo.build(name, stage.scene, material ?? stage.flat);
}

export { Geo, mix, shade };
