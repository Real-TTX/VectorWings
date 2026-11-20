// Low-poly modelling kit: flat shaded triangles with one colour per face, merged into one mesh per model.
// Every primitive orients its faces away from an inside point, so normals and culling stay right without care.
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';

export function rng(seed) {
    let a = seed >>> 0 || 1;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function hash2(x, y, seed = 0) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0,1]. */
export function noise2(x, y, seed = 0) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x, y, seed = 0, octaves = 3) {
    let sum = 0, amp = .5, f = 1;
    for (let i = 0; i < octaves; i++) {
        sum += amp * noise2(x * f, y * f, seed + i * 17);
        f *= 2.03;
        amp *= .5;
    }
    return sum / (1 - Math.pow(.5, octaves));
}

const colorCache = new Map();
/** '#rrggbb' → [r, g, b] in 0..1 */
export function rgb(value) {
    if (Array.isArray(value)) return value;
    let cached = colorCache.get(value);
    if (!cached) {
        const n = parseInt(value.slice(1), 16);
        cached = [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
        colorCache.set(value, cached);
    }
    return cached;
}

export function mix(a, b, t) {
    a = rgb(a); b = rgb(b);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function shade(color, factor) {
    const c = rgb(color);
    return [Math.min(1, c[0] * factor), Math.min(1, c[1] * factor), Math.min(1, c[2] * factor)];
}

const tmp = new Vector3();

export class Geo {
    constructor({ vary = .06, seed = 7 } = {}) {
        this.positions = [];
        this.normals = [];
        this.colors = [];
        this.matrix = Matrix.Identity();
        this.stack = [];
        this.vary = vary;
        this.random = rng(seed);
    }

    /** Runs fn with an extra transform (translation, Euler rotation yaw/pitch/roll, scale). */
    at({ x = 0, y = 0, z = 0, yaw = 0, pitch = 0, roll = 0, sx = 1, sy = 1, sz = 1, s }, fn) {
        if (s !== undefined) sx = sy = sz = s;
        const local = Matrix.Compose(new Vector3(sx, sy, sz), Quaternion.RotationYawPitchRoll(yaw, pitch, roll), new Vector3(x, y, z));
        this.stack.push(this.matrix);
        this.matrix = local.multiply(this.matrix);
        try { fn(this); } finally { this.matrix = this.stack.pop(); }
        return this;
    }

    /** Mirrors everything drawn in fn on the x axis (fn runs twice, side = -1 and +1). */
    mirror(fn) {
        fn(this, 1);
        this.at({ sx: -1 }, () => fn(this, -1));
        return this;
    }

    point(p) {
        Vector3.TransformCoordinatesFromFloatsToRef(p[0], p[1], p[2], this.matrix, tmp);
        return [tmp.x, tmp.y, tmp.z];
    }

    /** One face. `inside` is a point (in local coordinates) the face must turn away from. */
    tri(a, b, c, color, inside, raw = false) {
        if (!raw) { a = this.point(a); b = this.point(b); c = this.point(c); if (inside) inside = this.point(inside); }
        // Babylon's normal of (a,b,c) is (a-b)×(c-b); front faces point along it.
        const ux = a[0] - b[0], uy = a[1] - b[1], uz = a[2] - b[2];
        const vx = c[0] - b[0], vy = c[1] - b[1], vz = c[2] - b[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const length = Math.hypot(nx, ny, nz);
        if (length < 1e-9) return this;
        nx /= length; ny /= length; nz /= length;
        if (inside) {
            const cx = (a[0] + b[0] + c[0]) / 3 - inside[0], cy = (a[1] + b[1] + c[1]) / 3 - inside[1], cz = (a[2] + b[2] + c[2]) / 3 - inside[2];
            if (nx * cx + ny * cy + nz * cz < 0) { const swap = b; b = c; c = swap; nx = -nx; ny = -ny; nz = -nz; }
        }
        const base = rgb(color);
        const f = this.vary ? 1 + (this.random() - .5) * 2 * this.vary : 1;
        const alpha = base[3] ?? 1;
        for (const p of [a, b, c]) {
            this.positions.push(p[0], p[1], p[2]);
            this.normals.push(nx, ny, nz);
            this.colors.push(Math.min(1, base[0] * f), Math.min(1, base[1] * f), Math.min(1, base[2] * f), alpha);
        }
        return this;
    }

    quad(a, b, c, d, color, inside) {
        this.tri(a, b, c, color, inside);
        return this.tri(a, c, d, color, inside);
    }

    /** Convex polygon as a fan. */
    poly(points, color, inside) {
        for (let i = 1; i < points.length - 1; i++) this.tri(points[0], points[i], points[i + 1], color, inside);
        return this;
    }

    /** Box with optional taper of the top face (tx, tz) and per-face colours { top, bottom, side }. */
    box(cx, cy, cz, sx, sy, sz, color, { top, bottom, front, back, tx = 1, tz = 1, shiftX = 0, shiftZ = 0 } = {}) {
        const hx = sx / 2, hy = sy / 2, hz = sz / 2;
        const b = [[cx - hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz + hz], [cx - hx, cy - hy, cz + hz]];
        const t = [[cx - hx * tx + shiftX, cy + hy, cz - hz * tz + shiftZ], [cx + hx * tx + shiftX, cy + hy, cz - hz * tz + shiftZ],
            [cx + hx * tx + shiftX, cy + hy, cz + hz * tz + shiftZ], [cx - hx * tx + shiftX, cy + hy, cz + hz * tz + shiftZ]];
        const inside = [cx + shiftX / 2, cy, cz + shiftZ / 2];
        this.quad(t[0], t[1], t[2], t[3], top ?? color, inside);
        this.quad(b[0], b[1], b[2], b[3], bottom ?? color, inside);
        this.quad(b[0], b[1], t[1], t[0], back ?? color, inside);
        this.quad(b[2], b[3], t[3], t[2], front ?? color, inside);
        this.quad(b[1], b[2], t[2], t[1], color, inside);
        this.quad(b[3], b[0], t[0], t[3], color, inside);
        return this;
    }

    /**
     * Lofts rings along a path: rings = [{ z, w, h, x?, y? }], `sides` points per ring (an ellipse, rotated by `twist`).
     * The first and last ring are capped (a ring with w = 0 makes a point).
     */
    loft(rings, sides, color, { colors, twist = Math.PI / sides, caps = true } = {}) {
        const shape = rings.map(ring => {
            const points = [];
            for (let i = 0; i < sides; i++) {
                const angle = twist + i * 2 * Math.PI / sides;
                points.push([(ring.x ?? 0) + Math.cos(angle) * ring.w / 2, (ring.y ?? 0) + Math.sin(angle) * ring.h / 2, ring.z]);
            }
            return points;
        });
        for (let r = 0; r < rings.length - 1; r++) {
            const a = shape[r], b = shape[r + 1];
            const inside = [((rings[r].x ?? 0) + (rings[r + 1].x ?? 0)) / 2, ((rings[r].y ?? 0) + (rings[r + 1].y ?? 0)) / 2, (rings[r].z + rings[r + 1].z) / 2];
            for (let i = 0; i < sides; i++) {
                const j = (i + 1) % sides;
                const c = colors ? colors(r, i) : color;
                this.quad(a[i], a[j], b[j], b[i], c, inside);
            }
        }
        if (caps) {
            const first = rings[0], last = rings[rings.length - 1];
            if (first.w > 0) this.poly(shape[0], color, [first.x ?? 0, first.y ?? 0, first.z + 1]);
            if (last.w > 0) this.poly(shape[shape.length - 1], color, [last.x ?? 0, last.y ?? 0, last.z - 1]);
        }
        return this;
    }

    /** Cylinder along y (use `at` to turn it). */
    cylinder(cx, cy, cz, radius, height, sides, color, { top, radiusTop = radius, capTop = true, capBottom = true } = {}) {
        const inside = [cx, cy, cz];
        const lower = [], upper = [];
        for (let i = 0; i < sides; i++) {
            const angle = (i + .5) * 2 * Math.PI / sides;
            lower.push([cx + Math.cos(angle) * radius, cy - height / 2, cz + Math.sin(angle) * radius]);
            upper.push([cx + Math.cos(angle) * radiusTop, cy + height / 2, cz + Math.sin(angle) * radiusTop]);
        }
        for (let i = 0; i < sides; i++) {
            const j = (i + 1) % sides;
            if (radiusTop > 0) this.quad(lower[i], lower[j], upper[j], upper[i], color, inside);
            else this.tri(lower[i], lower[j], upper[i], color, inside);
        }
        if (capTop && radiusTop > 0) this.poly(upper, top ?? color, inside);
        if (capBottom) this.poly(lower, color, inside);
        return this;
    }

    cone(cx, cy, cz, radius, height, sides, color) {
        const inside = [cx, cy - height / 4, cz];
        const tip = [cx, cy + height / 2, cz];
        const ring = [];
        for (let i = 0; i < sides; i++) {
            const angle = (i + .5) * 2 * Math.PI / sides;
            ring.push([cx + Math.cos(angle) * radius, cy - height / 2, cz + Math.sin(angle) * radius]);
        }
        for (let i = 0; i < sides; i++) this.tri(ring[i], ring[(i + 1) % sides], tip, color, inside);
        this.poly(ring, color, inside);
        return this;
    }

    /** Icosahedron (detail 0) or one subdivision (detail 1), jitter moves the corners for rocks. */
    ico(cx, cy, cz, radius, color, { detail = 0, jitter = 0, sx = 1, sy = 1, sz = 1, colorOf, colorAt } = {}) {
        const t = (1 + Math.sqrt(5)) / 2;
        let vertices = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
            .map(v => { const l = Math.hypot(...v); return v.map(c => c / l); });
        let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
            [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
        for (let level = 0; level < detail; level++) {
            const cache = new Map();
            const middle = (a, b) => {
                const key = a < b ? a * 100000 + b : b * 100000 + a;
                if (!cache.has(key)) {
                    const m = vertices[a].map((c, i) => (c + vertices[b][i]) / 2);
                    const l = Math.hypot(...m);
                    vertices.push(m.map(c => c / l));
                    cache.set(key, vertices.length - 1);
                }
                return cache.get(key);
            };
            faces = faces.flatMap(([a, b, c]) => {
                const ab = middle(a, b), bc = middle(b, c), ca = middle(c, a);
                return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]];
            });
        }
        const r = jitter ? vertices.map(() => 1 + (this.random() - .5) * 2 * jitter) : null;
        const p = vertices.map((v, i) => [cx + v[0] * radius * sx * (r ? r[i] : 1), cy + v[1] * radius * sy * (r ? r[i] : 1), cz + v[2] * radius * sz * (r ? r[i] : 1)]);
        for (const [a, b, c] of faces) {
            const va = vertices[a], vb = vertices[b], vc = vertices[c];
            const face = colorAt ? colorAt((va[0] + vb[0] + vc[0]) / 3, (va[1] + vb[1] + vc[1]) / 3, (va[2] + vb[2] + vc[2]) / 3)
                : colorOf ? colorOf((p[a][1] + p[b][1] + p[c][1]) / 3 - cy) : color;
            this.tri(p[a], p[b], p[c], face, [cx, cy, cz]);
        }
        return this;
    }

    /** A wing or fin: a flat polygon outline (x,z) with thickness, at height y. */
    plate(outline, thickness, color, { y = 0, under, edge } = {}) {
        const top = outline.map(([x, z]) => [x, y + thickness / 2, z]);
        const bottom = outline.map(([x, z]) => [x, y - thickness / 2, z]);
        const cx = outline.reduce((s, p) => s + p[0], 0) / outline.length;
        const cz = outline.reduce((s, p) => s + p[1], 0) / outline.length;
        const inside = [cx, y, cz];
        this.poly(top, color, inside);
        this.poly(bottom, under ?? color, inside);
        for (let i = 0; i < outline.length; i++) {
            const j = (i + 1) % outline.length;
            this.quad(bottom[i], bottom[j], top[j], top[i], edge ?? color, inside);
        }
        return this;
    }

    append(other) {
        this.positions.push(...other.positions);
        this.normals.push(...other.normals);
        this.colors.push(...other.colors);
        return this;
    }

    get empty() {
        return this.positions.length === 0;
    }

    build(name, scene, material, { updatable = false } = {}) {
        const mesh = new Mesh(name, scene);
        const data = new VertexData();
        data.positions = this.positions;
        data.normals = this.normals;
        data.colors = this.colors;
        const count = this.positions.length / 3;
        const indices = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
        for (let i = 0; i < count; i++) indices[i] = i;
        data.indices = indices;
        data.applyToMesh(mesh, updatable);
        mesh.material = material;
        mesh.isPickable = false;
        return mesh;
    }
}
