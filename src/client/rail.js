// The rail of a mission: a gently curving line along +z. Everything on a mission lives in rail coordinates
// (s along the rail, x to the right, y up); the rail anchor moves with the mission speed, s = speed · t.
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

export class Rail {
    constructor(curve = [], speed = 44) {
        this.curve = curve;
        this.speed = speed;
    }

    x(s) {
        let v = 0;
        for (const [a, l, p] of this.curve) v += a * Math.sin(s / l + p);
        return v;
    }

    dx(s) {
        let v = 0;
        for (const [a, l, p] of this.curve) v += a / l * Math.cos(s / l + p);
        return v;
    }

    /** Heading of the rail at s (radians, 0 = +z). */
    heading(s) {
        return Math.atan(this.dx(s));
    }

    toWorld(s, x, y, out = new Vector3()) {
        const d = this.dx(s);
        const n = 1 / Math.sqrt(1 + d * d);
        // forward (d·n, n) → right (n, -d·n)
        out.x = this.x(s) + n * x;
        out.y = y;
        out.z = s - d * n * x;
        return out;
    }

    /** World point → rail coordinates { s, x, y } (two refinement steps, exact enough for gentle curves). */
    fromWorld(p, out = {}) {
        let s = p.z, x = 0;
        for (let i = 0; i < 3; i++) {
            const d = this.dx(s), n = 1 / Math.sqrt(1 + d * d);
            x = (p.x - this.x(s)) / n;
            s = p.z + d * n * x;
        }
        out.s = s; out.x = x; out.y = p.y;
        return out;
    }

    /** Direction (unit) of a rail-relative vector (vs along, vx right, vy up) at s, in world space. */
    direction(s, vs, vx, vy, out = new Vector3()) {
        const d = this.dx(s);
        const n = 1 / Math.sqrt(1 + d * d);
        out.x = d * n * vs + n * vx;
        out.y = vy;
        out.z = n * vs - d * n * vx;
        return out;
    }
}
