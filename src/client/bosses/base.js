// Shared parts of the bosses: the scheduling of attacks (deterministic on every client), part meshes and their state.
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';

/** Calls fn(k, time) for every time start + offset + k·period inside (t0, t1]. */
export function every(t0, t1, start, period, offset, fn) {
    const first = Math.max(0, Math.floor((t0 - start - offset) / period) + 1);
    for (let k = first; ; k++) {
        const time = start + offset + k * period;
        if (time > t1) break;
        if (time > t0) fn(k, time);
    }
}

export class BossBase {
    constructor(stage, def) {
        this.stage = stage;
        this.def = def;
        this.root = new TransformNode('boss', stage.scene);
        this.root.rotationQuaternion = new Quaternion();
        this.root.setEnabled(false);
        this.parts = [];
        this.armor = [];
        this.hull = [];
        this.flash = [];
        this.position = new Vector3();
        this.rail = { d: 80, x: 0, y: 2 };
    }

    /** A damageable part: node (its meshes are children), hit radius and the offset of its hit centre. */
    part(index, node, radius, center = Vector3.Zero()) {
        this.parts[index] = { index, node, radius, center, alive: true, active: false, pos: new Vector3(), hit: 0 };
        return this.parts[index];
    }

    node(name, parent = this.root, position = Vector3.Zero()) {
        const node = new TransformNode(name, this.stage.scene);
        node.parent = parent;
        node.position.copyFrom(position);
        return node;
    }

    mesh(geo, name, parent, material = this.stage.flat) {
        const mesh = geo.build(name, this.stage.scene, material);
        mesh.parent = parent;
        return mesh;
    }

    glowMesh(geo, name, parent, color, intensity = 1.3) {
        const mesh = geo.build(name, this.stage.scene, this.stage.glowMaterial(color, intensity));
        mesh.parent = parent;
        this.stage.addGlow(mesh);
        return mesh;
    }

    /** Places the boss root at rail coordinates facing the player. */
    placeOnRail(rail, sRail, d, x, y, yawOffset = 0, pitch = 0, roll = 0) {
        const s = sRail + d;
        rail.toWorld(s, x, y, this.root.position);
        Quaternion.RotationYawPitchRollToRef(rail.heading(s) + Math.PI + yawOffset, pitch, roll, this.root.rotationQuaternion);
        this.rail.d = d; this.rail.x = x; this.rail.y = y;
    }

    /** World positions of the parts after posing. */
    refresh(phases, phase, hp) {
        this.root.computeWorldMatrix(true);
        for (const part of this.parts) {
            if (!part) continue;
            part.node.computeWorldMatrix(true);
            Vector3.TransformCoordinatesToRef(part.center, part.node.getWorldMatrix(), part.pos);
            part.alive = hp[part.index] > 0;
            part.active = part.alive && phase < phases.length && phases[phase].includes(part.index);
        }
        for (const a of [...this.armor, ...this.hull]) {
            a.node.computeWorldMatrix(true);
            Vector3.TransformCoordinatesToRef(a.center ?? Vector3.ZeroReadOnly, a.node.getWorldMatrix(), a.pos ??= new Vector3());
        }
    }

    /** A sphere that stops lasers (armour) or rams ships (hull). */
    shield(node, radius, center = Vector3.Zero(), list = this.armor) {
        const entry = { node, radius, center, pos: new Vector3() };
        list.push(entry);
        return entry;
    }

    worldPoint(node, local) {
        node.computeWorldMatrix(true);
        return Vector3.TransformCoordinates(local, node.getWorldMatrix());
    }

    setVisible(visible) {
        this.root.setEnabled(visible);
    }

    /** Scales the whole boss (model, hit spheres). Call at the end of the constructor. */
    applyScale(s) {
        this.scale = s;
        this.root.scaling.setAll(s);
        for (const part of this.parts) if (part) part.radius *= s;
        for (const a of [...this.armor, ...this.hull]) { a.radius *= s; a.baseRadius = a.radius; }
    }

    dispose() {
        this.root.dispose(false, true);
    }
}

export const ease = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
