// What the game shows: enemies (instanced per kind), the pilots' ships with trails, cores and blob shadows, pickups.
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder.js';
import { ENEMY_MODELS, PICKUP_MODELS, TEAM, buildShip } from './models.js';
import { Geo, rgb } from './kit.js';

/** Instanced enemy views: show(id, kind) gives a view with root/head nodes; hide(id) returns it. */
export class EnemyViews {
    constructor(stage) {
        this.stage = stage;
        this.templates = new Map();
        this.free = new Map();
        this.views = new Map();
    }

    template(kind) {
        let t = this.templates.get(kind);
        if (t) return t;
        const variant = kind === 'ace' ? 1 : 0;
        const model = ENEMY_MODELS[kind === 'ace' ? 'fighter' : kind](variant);
        const body = model.body.build('e-' + kind, this.stage.scene, this.stage.flat);
        body.setEnabled(false);
        const scale = { fighter: 1.35, ace: 1.4, drone: 1.2 }[kind] ?? 1;
        if (scale !== 1) body.scaling.setAll(scale);
        const glow = model.glow ? model.glow.build('e-' + kind + '-glow', this.stage.scene, this.stage.unlit) : null;
        if (glow) { glow.setEnabled(false); this.stage.addGlow(glow); if (scale !== 1) glow.scaling.setAll(scale); }
        const head = model.head ? model.head.build('e-' + kind + '-head', this.stage.scene, this.stage.flat) : null;
        head?.setEnabled(false);
        t = { body, glow, head, headY: model.headY ?? 0, radius: model.radius };
        this.templates.set(kind, t);
        return t;
    }

    show(id, kind) {
        let view = this.views.get(id);
        if (view) return view;
        const list = this.free.get(kind) ?? [];
        view = list.pop();
        if (!view) {
            const t = this.template(kind);
            const root = new TransformNode('enemy', this.stage.scene);
            root.rotationQuaternion = new Quaternion();
            const body = t.body.createInstance('eb');
            body.parent = root;
            let glow = null, head = null;
            if (t.head) {
                head = t.head.createInstance('eh');
                head.parent = root;
                head.position.y = t.headY;
                head.rotationQuaternion = new Quaternion();
            }
            if (t.glow) {
                glow = t.glow.createInstance('eg');
                glow.parent = head && kind !== 'turret' && kind !== 'tank' ? root : (head ?? root);
                if (head && (kind === 'turret' || kind === 'tank')) glow.position.y = 0;
                this.stage.addGlow(glow);
            }
            view = { kind, root, body, glow, head, flash: 0 };
        }
        view.root.setEnabled(true);
        view.flash = 0;
        view.root.scaling.setAll(1);
        this.views.set(id, view);
        return view;
    }

    hide(id) {
        const view = this.views.get(id);
        if (!view) return;
        this.views.delete(id);
        view.root.setEnabled(false);
        const list = this.free.get(view.kind) ?? [];
        list.push(view);
        this.free.set(view.kind, list);
    }

    hideAll(keep) {
        for (const id of [...this.views.keys()]) if (!keep?.has(id)) this.hide(id);
    }
}

/** One pilot's ship as seen: model, engine trails, blob shadow, battle cores. */
export class ShipView {
    constructor(stage, design, slot, { shadow = true } = {}) {
        this.stage = stage;
        this.design = design;
        this.slot = slot;
        const ship = this.ship = buildShip(stage, design, slot, 'pilot' + slot);
        this.root = ship.root;
        this.root.rotationQuaternion = new Quaternion();
        this.model = new TransformNode('model' + slot, stage.scene);
        this.model.parent = this.root;
        ship.body.parent = this.model;
        ship.glow.parent = this.model;
        this.model.rotationQuaternion = new Quaternion();
        // Engine flames: glowing cones behind every nozzle, longer while boosting.
        this.flames = [];
        const big = ship.engines.length > 2 ? .17 : ship.engines.length === 1 ? .34 : .22;
        for (const point of ship.engines) {
            const outer = new Geo({ vary: 0 });
            outer.at({ pitch: -Math.PI / 2 }, g => g.cone(0, -.9, 0, big, 1.8, 6, '#3fb8ff'));
            const inner = new Geo({ vary: 0 });
            inner.at({ pitch: -Math.PI / 2 }, g => g.cone(0, -.55, 0, big * .55, 1.1, 6, '#ffffff'));
            const node = new TransformNode('flame', stage.scene);
            node.parent = this.model;
            node.position.copyFrom(point);
            const a = outer.build('flame-o', stage.scene, stage.glowMaterial('#3fb8ff', 1.3));
            const b = inner.build('flame-i', stage.scene, stage.glowMaterial('#dff8ff', 1.4));
            a.parent = node; b.parent = node;
            stage.addGlow(a); stage.addGlow(b);
            this.flames.push(node);
        }
        this.shadow = null;
        if (shadow) {
            const disc = this.shadow = CreateDisc('shadow' + slot, { radius: 2.4, tessellation: 12 }, stage.scene);
            disc.rotation.x = Math.PI / 2;
            const material = new StandardMaterial('shadowMat' + slot, stage.scene);
            material.disableLighting = true;
            material.emissiveColor = new Color3(0, 0, .02);
            material.alpha = .32;
            material.disableDepthWrite = true;
            disc.material = material;
            disc.isPickable = false;
        }
        this.cores = [];
        this.coreRoot = new TransformNode('cores' + slot, stage.scene);
        this.coreRoot.parent = this.root;
        this.flash = 0;
        this.visible = true;
    }

    setCores(count) {
        while (this.cores.length < count) {
            const geo = new Geo({ vary: 0 });
            geo.ico(0, 0, 0, .42, TEAM[this.slot]);
            const mesh = geo.build('core', this.stage.scene, this.stage.glowMaterial(TEAM[this.slot], 1.4));
            mesh.parent = this.coreRoot;
            this.stage.addGlow(mesh);
            this.cores.push(mesh);
        }
        while (this.cores.length > count) this.cores.pop().dispose();
    }

    /** Places the ship: position (world), heading yaw, pitch, bank roll and an extra spin (barrel roll / loops). */
    place(position, yaw, pitch, roll, groundY = null, boost = 0) {
        this.root.position.copyFrom(position);
        Quaternion.RotationYawPitchRollToRef(yaw, pitch, roll, this.root.rotationQuaternion);
        const time = this.stage.time;
        this.coreRoot.rotationQuaternion = Quaternion.Inverse(this.root.rotationQuaternion);
        this.cores.forEach((core, i) => {
            const a = time * 2.2 + i / this.cores.length * Math.PI * 2;
            core.position.set(Math.cos(a) * 2.6, .6 + Math.sin(time * 3 + i) * .2, Math.sin(a) * 2.6);
        });
        if (this.shadow) {
            if (groundY === null || position.y - groundY > 40) this.shadow.setEnabled(false);
            else {
                this.shadow.setEnabled(this.visible);
                this.shadow.position.set(position.x, groundY + .25, position.z);
                const h = Math.max(0, position.y - groundY);
                this.shadow.scaling.setAll(Math.max(.4, 1.2 - h / 40));
                this.shadow.material.alpha = .34 * Math.max(0, 1 - h / 40);
            }
        }
        const length = boost > 0 ? 2.1 : boost < 0 ? .45 : 1;
        for (const flame of this.flames) {
            const flicker = .85 + Math.sin(time * 61 + flame.position.x * 7) * .1 + Math.sin(time * 37) * .06;
            flame.scaling.set(1, 1, length * flicker);
        }
    }

    setVisible(visible) {
        if (visible === this.visible) return;
        this.visible = visible;
        this.root.setEnabled(visible);
        if (!visible) this.shadow?.setEnabled(false);
    }

    /** Blinking while invulnerable. */
    blink(on) {
        this.model.setEnabled(on);
    }

    dispose() {
        this.shadow?.dispose();
        this.root.dispose(false, true);
    }
}

export class PickupViews {
    constructor(stage) {
        this.stage = stage;
        this.templates = new Map();
        this.views = new Map();
    }

    template(kind) {
        let t = this.templates.get(kind);
        if (!t) {
            const model = PICKUP_MODELS[kind]();
            const body = model.body ? model.body.build('p-' + kind, this.stage.scene, this.stage.flatShiny) : null;
            const glow = model.glow.build('p-' + kind + '-glow', this.stage.scene, this.stage.glowMaterial(model.color, 1.15));
            body?.setEnabled(false);
            glow.setEnabled(false);
            this.stage.addGlow(glow);
            t = { body, glow, radius: model.radius };
            this.templates.set(kind, t);
        }
        return t;
    }

    show(id, kind) {
        let view = this.views.get(id);
        if (view) return view;
        const t = this.template(kind);
        const root = new TransformNode('pickup', this.stage.scene);
        if (t.body) { const b = t.body.createInstance('pb'); b.parent = root; }
        const g = t.glow.createInstance('pg');
        g.parent = root;
        this.stage.addGlow(g);
        view = { root, kind };
        this.views.set(id, view);
        return view;
    }

    hide(id) {
        const view = this.views.get(id);
        if (!view) return;
        view.root.dispose(false, false);
        this.views.delete(id);
    }

    hideAll(keep) {
        for (const id of [...this.views.keys()]) if (!keep?.has(id)) this.hide(id);
    }
}

/** A glowing bomb in flight. */
export function bombMesh(stage) {
    const geo = new Geo({ vary: 0 });
    geo.ico(0, 0, 0, .55, '#ff6a4a', { detail: 1 });
    const mesh = geo.build('bomb', stage.scene, stage.glowMaterial('#ff7050', 1.6));
    stage.addGlow(mesh);
    return mesh;
}

export { Mesh, Vector3, rgb };
