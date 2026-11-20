// Effects: laser bolts and enemy shots (drawn where the game puts them), explosions, debris, sparks, smoke and bomb blasts
// (they simulate themselves in world space). Every group is one SolidParticleSystem, so a big fight stays a handful of draw calls.
import { SolidParticleSystem } from '@babylonjs/core/Particles/solidParticleSystem.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Geo, rgb, rng } from './kit.js';

function shapeMesh(stage, geo, name) {
    const mesh = geo.build(name, stage.scene, stage.unlit);
    return mesh;
}

class Pool {
    constructor(stage, name, geo, count, { glow = false, alpha = false, lit = false, additive = false } = {}) {
        const template = shapeMesh(stage, geo, name + '-shape');
        const sps = this.sps = new SolidParticleSystem(name, stage.scene, { updatable: true, isPickable: false });
        sps.addShape(template, count);
        template.dispose();
        const mesh = this.mesh = sps.buildMesh();
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.isPickable = false;
        sps.computeBoundingBox = false;
        sps.computeParticleTexture = false;
        let material;
        if (lit) {
            material = stage.flat;
        } else {
            material = new StandardMaterial(name + '-mat', stage.scene);
            material.disableLighting = true;
            material.emissiveColor = new Color3(1, 1, 1);
            material.diffuseColor = new Color3(0, 0, 0);
            material.specularColor = new Color3(0, 0, 0);
            if (alpha) {
                mesh.hasVertexAlpha = true;
                material.alpha = .999;
                if (additive) material.alphaMode = 1;
                material.disableDepthWrite = true;
                material.backFaceCulling = false;
            }
        }
        mesh.material = material;
        if (alpha) mesh.renderingGroupId = 1;
        if (glow) stage.addGlow(mesh);
        this.free = [];
        this.active = [];
        for (const p of sps.particles) {
            p.isVisible = false;
            p.color = new Color4(1, 1, 1, 1);
            p.data = {};
            this.free.push(p);
        }
        sps.setParticles();
        this.dirty = true;
    }

    take() {
        const p = this.free.pop() ?? this.active.shift();
        if (!p) return null;
        p.isVisible = true;
        this.active.push(p);
        this.dirty = true;
        return p;
    }

    release(p) {
        p.isVisible = false;
        const index = this.active.indexOf(p);
        if (index >= 0) this.active.splice(index, 1);
        this.free.push(p);
        this.dirty = true;
    }

    flush() {
        if (this.dirty || this.active.length) this.sps.setParticles();
        this.dirty = false;
    }
}

const GRAVITY = -26;
const tmp = new Vector3();

export class Effects {
    constructor(stage) {
        this.stage = stage;
        this.random = rng(4242);
        const bolt = new Geo({ vary: 0 });
        bolt.box(0, 0, 0, .16, .16, 3.4, '#ffffff', { tx: .5 });
        this.bolts = new Pool(stage, 'bolts', bolt, 180, { glow: true });
        const orb = new Geo({ vary: 0 });
        orb.ico(0, 0, 0, .5, '#ffffff', { detail: 1 });
        this.orbs = new Pool(stage, 'orbs', orb, 140, { glow: true });
        const fire = new Geo({ vary: 0 });
        fire.ico(0, 0, 0, 1, '#ffffff', { detail: 1 });
        this.fire = new Pool(stage, 'fire', fire, 90, { alpha: true, additive: true });
        this.smoke = new Pool(stage, 'smoke', fire, 70, { alpha: true });
        const chunk = new Geo({ vary: 0 });
        chunk.tri([0, .5, 0], [-.45, -.3, .3], [.45, -.3, .3], '#ffffff', [0, 0, 0]).tri([0, .5, 0], [.45, -.3, .3], [0, -.3, -.5], '#ffffff', [0, 0, 0])
            .tri([0, .5, 0], [0, -.3, -.5], [-.45, -.3, .3], '#ffffff', [0, 0, 0]).tri([-.45, -.3, .3], [0, -.3, -.5], [.45, -.3, .3], '#ffffff', [0, 0, 0]);
        this.debris = new Pool(stage, 'debris', chunk, 160, { lit: true });
        const spark = new Geo({ vary: 0 });
        spark.box(0, 0, 0, .09, .09, 1, '#ffffff');
        this.sparks = new Pool(stage, 'sparks', spark, 220, { glow: true });
        const ring = new Geo({ vary: 0 });
        for (let i = 0; i < 24; i++) {
            const a0 = i / 24 * Math.PI * 2, a1 = (i + 1) / 24 * Math.PI * 2;
            ring.quad([Math.cos(a0), -.04, Math.sin(a0)], [Math.cos(a1), -.04, Math.sin(a1)], [Math.cos(a1) * .82, .04, Math.sin(a1) * .82], [Math.cos(a0) * .82, .04, Math.sin(a0) * .82], '#ffffff', [0, -1, 0]);
        }
        this.rings = new Pool(stage, 'rings', ring, 16, { alpha: true });
        this.pools = [this.bolts, this.orbs, this.fire, this.smoke, this.debris, this.sparks, this.rings];
        this.boltCursor = 0;
        this.orbCursor = 0;
    }

    /** Starts a frame of drawn projectiles: bolts and orbs are re-placed by the game every frame. */
    beginProjectiles() {
        this.boltCursor = 0;
        this.orbCursor = 0;
    }

    bolt(position, direction, color, length = 1, width = 1) {
        const pool = this.bolts;
        const p = pool.sps.particles[this.boltCursor++];
        if (!p) return;
        p.isVisible = true;
        p.position.copyFrom(position);
        p.rotation.y = Math.atan2(direction.x, direction.z);
        p.rotation.x = -Math.asin(Math.max(-1, Math.min(1, direction.y)));
        p.rotation.z = 0;
        p.scaling.set(width, width, length);
        const c = rgb(color);
        p.color.set(c[0] * 1.6, c[1] * 1.6, c[2] * 1.6, 1);
    }

    orb(position, color, size = 1) {
        const p = this.orbs.sps.particles[this.orbCursor++];
        if (!p) return;
        p.isVisible = true;
        p.position.copyFrom(position);
        p.rotation.set(this.stage.time * 3, this.stage.time * 2, 0);
        p.scaling.setAll(size);
        const c = rgb(color);
        const pulse = .85 + Math.sin(this.stage.time * 24 + position.x) * .15;
        p.color.set(c[0] * pulse, c[1] * pulse, c[2] * pulse, 1);
    }

    endProjectiles() {
        for (let i = this.boltCursor; i < this.bolts.sps.particles.length; i++) this.bolts.sps.particles[i].isVisible = false;
        for (let i = this.orbCursor; i < this.orbs.sps.particles.length; i++) this.orbs.sps.particles[i].isVisible = false;
        this.bolts.dirty = this.orbs.dirty = true;
    }

    /** An explosion: fireballs, smoke, debris and sparks. size 1 = a fighter. velocity is inherited (world units/s). */
    explode(position, size = 1, velocity = Vector3.ZeroReadOnly, tint = '#555a66') {
        const r = this.random;
        const balls = Math.round(4 + size * 4);
        for (let i = 0; i < balls; i++) {
            const smoke = i >= balls * .65;
            const p = (smoke ? this.smoke : this.fire).take();
            if (!p) break;
            const d = p.data;
            d.kind = smoke ? 'smoke' : 'fire';
            d.life = 0;
            d.max = (d.kind === 'fire' ? .45 + r() * .35 : 1.1 + r() * .6) * Math.sqrt(size);
            d.size = (1.1 + r() * 1.4) * (smoke ? Math.min(size, 1.6) * .75 : size);
            d.v = new Vector3((r() - .5) * 9 * size, (r() - .2) * 7 * size, (r() - .5) * 9 * size).addInPlace(velocity.scale(.65));
            d.delay = i * .03 * r();
            p.position.copyFrom(position).addInPlaceFromFloats((r() - .5) * size * 1.6, (r() - .5) * size * 1.2, (r() - .5) * size * 1.6);
            p.scaling.setAll(.01);
            p.rotation.set(r() * 6, r() * 6, r() * 6);
        }
        const chunks = Math.round(5 + Math.min(size, 2.5) * 5);
        const tc = rgb(tint);
        for (let i = 0; i < chunks; i++) {
            const p = this.debris.take();
            if (!p) break;
            const d = p.data;
            d.life = 0;
            d.max = 1.0 + r() * .9;
            d.v = new Vector3((r() - .5) * 26, r() * 18 + 3, (r() - .5) * 26).scaleInPlace(Math.sqrt(size)).addInPlace(velocity.scale(.7));
            d.spin = new Vector3((r() - .5) * 14, (r() - .5) * 14, (r() - .5) * 14);
            p.position.copyFrom(position);
            const s = (.35 + r() * .7) * Math.sqrt(size);
            p.scaling.set(s, s * (.5 + r()), s);
            const f = .8 + r() * .7;
            if (i % 4 === 0) p.color.set(1, .55, .2, 1);
            else p.color.set(Math.min(1, tc[0] * f + .15), Math.min(1, tc[1] * f + .15), Math.min(1, tc[2] * f + .17), 1);
        }
        this.burst(position, Math.round(8 + size * 8), '#ffd27a', 30 * Math.sqrt(size), velocity);
        if (size >= 2) this.shockwave(position, size * 6, '#ffcf8a', .6);
    }

    /** Short bright sparks (hits, scraping). */
    burst(position, count, color, speed = 24, velocity = Vector3.ZeroReadOnly) {
        const r = this.random, c = rgb(color);
        for (let i = 0; i < count; i++) {
            const p = this.sparks.take();
            if (!p) break;
            const d = p.data;
            d.life = 0;
            d.max = .18 + r() * .25;
            d.v = new Vector3(r() - .5, r() - .35, r() - .5).normalize().scaleInPlace(speed * (.4 + r() * .8)).addInPlace(velocity.scale(.8));
            p.position.copyFrom(position);
            p.color.set(c[0] * 2, c[1] * 2, c[2] * 2, 1);
        }
    }

    shockwave(position, radius, color, duration = .5) {
        const p = this.rings.take();
        if (!p) return;
        const d = p.data;
        d.life = 0;
        d.max = duration;
        d.radius = radius;
        d.color = rgb(color);
        p.position.copyFrom(position);
        p.rotation.set((this.random() - .5) * .6, 0, (this.random() - .5) * .6);
    }

    /** Big expanding fire sphere of a bomb. */
    blast(position, radius) {
        for (let i = 0; i < 3; i++) {
            const p = this.fire.take();
            if (!p) break;
            const d = p.data;
            d.kind = 'blast';
            d.life = 0;
            d.delay = i * .06;
            d.max = .75 + i * .15;
            d.size = radius * (1 - i * .18);
            d.v = new Vector3(0, 0, 0);
            p.position.copyFrom(position);
            p.scaling.setAll(.01);
        }
        this.shockwave(position, radius * 1.6, '#ffe7b0', .7);
        this.shockwave(position, radius * 1.1, '#ff8a5a', .5);
        this.burst(position, 40, '#fff1c4', 60);
    }

    update(dt) {
        for (const p of [...this.fire.active, ...this.smoke.active]) {
            const d = p.data;
            const pool = d.kind === 'smoke' ? this.smoke : this.fire;
            if (d.delay > 0) { d.delay -= dt; p.scaling.setAll(.01); continue; }
            d.life += dt;
            const u = d.life / d.max;
            if (u >= 1) { pool.release(p); continue; }
            p.position.addInPlace(d.v.scale(dt));
            d.v.scaleInPlace(Math.max(0, 1 - dt * 2.2));
            if (d.kind === 'fire') {
                p.scaling.setAll(d.size * (.35 + Math.sqrt(u) * .9));
                const heat = 1 - u;
                p.color.set(.95, .28 + heat * .42, .04 + heat * .2, Math.min(1, (1 - u) * 1.3));
            } else if (d.kind === 'blast') {
                p.scaling.setAll(d.size * Math.sqrt(Math.min(1, u * 1.6)));
                p.color.set(.9, .3 + (1 - u) * .4, .05 + (1 - u) * .2, Math.min(.75, (1 - u) * 1.1));
            } else {
                p.position.y += dt * 3;
                p.scaling.setAll(d.size * (.6 + u * 1.1));
                const g = .3 + u * .2;
                p.color.set(g, g, g * 1.08, (1 - u) * (1 - u) * .55);
            }
        }
        for (const p of [...this.debris.active]) {
            const d = p.data;
            d.life += dt;
            if (d.life >= d.max) { this.debris.release(p); continue; }
            d.v.y += GRAVITY * dt;
            p.position.addInPlace(d.v.scale(dt));
            p.rotation.addInPlace(d.spin.scale(dt));
            if (d.max - d.life < .2) p.scaling.scaleInPlace(.85);
        }
        for (const p of [...this.sparks.active]) {
            const d = p.data;
            d.life += dt;
            if (d.life >= d.max) { this.sparks.release(p); continue; }
            d.v.y += GRAVITY * .6 * dt;
            p.position.addInPlace(d.v.scale(dt));
            const speed = d.v.length();
            tmp.copyFrom(d.v).scaleInPlace(1 / (speed || 1));
            p.rotation.y = Math.atan2(tmp.x, tmp.z);
            p.rotation.x = -Math.asin(Math.max(-1, Math.min(1, tmp.y)));
            p.scaling.set(1, 1, Math.max(.3, speed * .05) * (1 - d.life / d.max));
        }
        for (const p of [...this.rings.active]) {
            const d = p.data;
            d.life += dt;
            const u = d.life / d.max;
            if (u >= 1) { this.rings.release(p); continue; }
            const s = d.radius * (.15 + Math.sqrt(u) * .85);
            p.scaling.set(s, s * .5 + 1, s);
            p.color.set(d.color[0] * 1.6, d.color[1] * 1.6, d.color[2] * 1.6, (1 - u) * .85);
        }
        for (const pool of this.pools) pool.flush();
    }

    clear() {
        for (const pool of [this.fire, this.smoke, this.debris, this.sparks, this.rings]) for (const p of [...pool.active]) pool.release(p);
    }
}
