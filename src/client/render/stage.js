// The Babylon stage: engine, scene, camera, light, sky, fog, water, far mountains, clouds and the post-processing.
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { Effect } from '@babylonjs/core/Materials/effect.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer.js';
import '@babylonjs/core/Layers/effectLayerSceneComponent.js';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline.js';
import '@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent.js';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration.js';
import '@babylonjs/core/Meshes/instancedMesh.js';
import { Geo, rgb, mix, rng } from './kit.js';

Effect.ShadersStore.vwSkyVertexShader = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main() { vDir = position; gl_Position = worldViewProjection * vec4(position, 1.0); }`;

Effect.ShadersStore.vwSkyFragmentShader = `
precision highp float;
uniform vec3 top; uniform vec3 middle; uniform vec3 horizon; uniform vec3 bottom;
uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunSize; uniform float stars; uniform float flash;
varying vec3 vDir;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(horizon, middle, smoothstep(0.0, 0.22, h));
    col = mix(col, top, smoothstep(0.22, 0.85, h));
    col = mix(col, bottom, smoothstep(0.0, -0.25, h));
    float s = max(dot(d, normalize(sunDir)), 0.0);
    col += sunColor * (smoothstep(1.0 - 0.0009 * sunSize, 1.0 - 0.0006 * sunSize, s) * 1.4 + pow(s, 14.0) * 0.42 + pow(s, 3.0) * 0.14);
    if (stars > 0.0) {
        vec3 c = floor(d * 340.0);
        float st = step(0.9965, hash(c)) * (0.45 + 0.55 * hash(c + 3.1));
        col += vec3(st * stars * smoothstep(-0.2, 0.25, h));
    }
    col = mix(col, vec3(1.0), flash);
    gl_FragColor = vec4(col, 1.0);
}`;

Effect.ShadersStore.vwWaterVertexShader = `
precision highp float;
attribute vec3 position;
uniform mat4 world; uniform mat4 viewProjection;
uniform float time; uniform float level; uniform float amplitude;
varying vec3 vWorld;
float waves(vec2 p) {
    return sin(p.x * 0.11 + time * 1.3) * 0.55 + sin(p.y * 0.083 - time * 1.1 + p.x * 0.03) * 0.75
         + sin((p.x + p.y) * 0.19 + time * 2.1) * 0.25 + sin((p.x - p.y) * 0.05 + time * 0.7) * 0.6;
}
void main() {
    vec4 w = world * vec4(position, 1.0);
    w.y = level + waves(w.xz) * amplitude;
    vWorld = w.xyz;
    gl_Position = viewProjection * w;
}`;

Effect.ShadersStore.vwWaterFragmentShader = `
#extension GL_OES_standard_derivatives : enable
precision highp float;
uniform vec3 deep; uniform vec3 shallow; uniform vec3 foam; uniform vec3 sunDir; uniform vec3 sunColor; uniform vec3 skyColor;
uniform vec3 eye; uniform vec3 fogColor; uniform float fogDensity; uniform float level; uniform float amplitude; uniform float flash;
varying vec3 vWorld;
void main() {
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    if (n.y < 0.0) n = -n;
    vec3 v = normalize(eye - vWorld);
    vec3 l = normalize(sunDir);
    float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    float crest = smoothstep(0.55, 1.6, (vWorld.y - level) / max(amplitude, 0.01));
    vec3 col = mix(deep, shallow, 0.35 + 0.65 * max(dot(n, l), 0.0));
    col = mix(col, skyColor, fres * 0.32);
    col = mix(col, foam, crest * 0.4);
    float spec = pow(max(dot(reflect(-l, n), v), 0.0), 70.0);
    col += sunColor * spec * 0.6;
    float dist = length(eye - vWorld);
    float f = exp(-pow(dist * fogDensity, 2.0));
    col = mix(fogColor, col, clamp(f, 0.0, 1.0));
    col = mix(col, vec3(1.0), flash);
    gl_FragColor = vec4(col, 1.0);
}`;

const color3 = value => { const c = rgb(value); return new Color3(c[0], c[1], c[2]); };

export class Stage {
    constructor(canvas, { quality = 'auto' } = {}) {
        this.canvas = canvas;
        const coarse = matchMedia('(any-pointer: coarse)').matches;
        this.quality = quality === 'auto' ? (coarse ? 'medium' : 'high') : quality;
        this.engine = new Engine(canvas, this.quality !== 'low', { stencil: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false }, false);
        const ratio = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 1.5 : 1.25);
        this.engine.setHardwareScalingLevel(1 / ratio);
        const scene = this.scene = new Scene(this.engine);
        scene.skipPointerMovePicking = true;
        scene.autoClear = true;
        scene.clearColor = new Color4(.4, .55, .8, 1);
        scene.fogMode = Scene.FOGMODE_EXP2;
        scene.fogDensity = .0018;
        scene.ambientColor = new Color3(.25, .25, .3);

        const camera = this.camera = new FreeCamera('camera', new Vector3(0, 6, -12), scene);
        camera.minZ = .4;
        camera.maxZ = 5000;
        camera.fov = 1.0;
        camera.rotationQuaternion = new Quaternion();
        camera.inputs.clear();
        this.baseFov = 1.0;

        this.hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
        this.sun = new DirectionalLight('sun', new Vector3(-.4, -.8, .5), scene);

        this.flat = new StandardMaterial('flat', scene);
        this.flat.specularColor = new Color3(.12, .12, .12);
        this.flat.specularPower = 24;
        this.flat.diffuseColor = new Color3(1, 1, 1);
        this.flat.ambientColor = new Color3(1, 1, 1);
        this.flatShiny = this.flat.clone('flatShiny');
        this.flatShiny.specularColor = new Color3(.5, .5, .5);
        this.flatShiny.specularPower = 48;
        this.unlit = new StandardMaterial('unlit', scene);
        this.unlit.disableLighting = true;
        this.unlit.emissiveColor = new Color3(1, 1, 1);
        this.glowMaterials = new Map();

        this.glow = new GlowLayer('glow', scene, { mainTextureFixedSize: this.quality === 'high' ? 512 : 256, blurKernelSize: 40 });
        this.glow.intensity = .6;
        this.glowIncluded = new Set();

        this.pipeline = null;
        if (this.quality !== 'low') {
            const pipeline = this.pipeline = new DefaultRenderingPipeline('post', true, scene, [camera]);
            pipeline.fxaaEnabled = true;
            pipeline.bloomEnabled = this.quality === 'high';
            pipeline.bloomThreshold = .82;
            pipeline.bloomWeight = .32;
            pipeline.bloomKernel = 48;
            pipeline.bloomScale = .5;
            pipeline.imageProcessingEnabled = true;
            const ip = pipeline.imageProcessing;
            ip.toneMappingEnabled = true;
            ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
            ip.contrast = 1.18;
            ip.exposure = 1.05;
            ip.vignetteEnabled = true;
            ip.vignetteWeight = 1.6;
            ip.vignetteColor = new Color4(.02, .03, .08, 0);
            pipeline.chromaticAberrationEnabled = this.quality === 'high';
            if (pipeline.chromaticAberration) pipeline.chromaticAberration.aberrationAmount = 0;
        }

        this.sky = CreateSphere('sky', { diameter: 4000, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
        this.sky.infiniteDistance = true;
        this.sky.isPickable = false;
        this.skyMaterial = new ShaderMaterial('skyMat', scene, { vertex: 'vwSky', fragment: 'vwSky' },
            { attributes: ['position'], uniforms: ['worldViewProjection', 'top', 'middle', 'horizon', 'bottom', 'sunDir', 'sunColor', 'sunSize', 'stars', 'flash'] });
        this.skyMaterial.backFaceCulling = false;
        this.skyMaterial.disableDepthWrite = true;
        this.sky.material = this.skyMaterial;
        this.sky.renderingGroupId = 0;
        this.sky.applyFog = false;

        this.water = null;
        this.backdrop = new TransformNode('backdrop', scene);
        this.backdropMeshes = [];
        this.time = 0;
        this.flash = 0;
        this.shake = 0;
        this.shakeSeed = rng(91);

        window.addEventListener('resize', () => this.resize());
        this.resize();
    }

    resize() {
        this.engine.resize();
        const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
        this.camera.fovMode = aspect < 1 ? Camera.FOVMODE_HORIZONTAL_FIXED : Camera.FOVMODE_VERTICAL_FIXED;
        this.portrait = aspect < 1;
    }

    glowMaterial(value, intensity = 1) {
        const key = value + ':' + intensity;
        let material = this.glowMaterials.get(key);
        if (!material) {
            material = new StandardMaterial('glow' + key, this.scene);
            material.disableLighting = true;
            const c = rgb(value);
            material.emissiveColor = new Color3(c[0] * intensity, c[1] * intensity, c[2] * intensity);
            material.diffuseColor = new Color3(0, 0, 0);
            material.specularColor = new Color3(0, 0, 0);
            this.glowMaterials.set(key, material);
        }
        return material;
    }

    addGlow(mesh) {
        if (!this.glowIncluded.has(mesh)) {
            this.glowIncluded.add(mesh);
            this.glow.addIncludedOnlyMesh(mesh);
        }
        return mesh;
    }

    /** Applies a world theme: sky, light, fog, water, mountains and clouds. */
    setTheme(theme) {
        this.theme = theme;
        const sky = theme.sky;
        const sunDir = new Vector3(...theme.sun.dir).normalize();
        this.sunDir = sunDir;
        const m = this.skyMaterial;
        m.setColor3('top', color3(sky.top));
        m.setColor3('middle', color3(sky.middle));
        m.setColor3('horizon', color3(sky.horizon));
        m.setColor3('bottom', color3(sky.bottom));
        m.setVector3('sunDir', sunDir);
        m.setColor3('sunColor', color3(theme.sun.color));
        m.setFloat('sunSize', theme.sun.size ?? 1);
        m.setFloat('stars', theme.stars ?? 0);
        m.setFloat('flash', 0);
        this.sun.direction = sunDir.scale(-1);
        this.sun.diffuse = color3(theme.sun.light ?? '#fff4e0');
        this.sun.intensity = theme.sun.intensity ?? 1.6;
        this.sun.specular = color3('#ffffff');
        this.hemi.diffuse = color3(theme.hemi.sky);
        this.hemi.groundColor = color3(theme.hemi.ground);
        this.hemi.intensity = theme.hemi.intensity ?? .7;
        this.scene.fogColor = color3(theme.fog.color);
        this.scene.fogDensity = theme.fog.density;
        this.scene.clearColor = Color4.FromColor3(color3(theme.fog.color), 1);
        if (this.pipeline) {
            this.pipeline.imageProcessing.exposure = theme.exposure ?? 1.05;
            this.pipeline.imageProcessing.contrast = theme.contrast ?? 1.18;
        }
        this.buildWater(theme.water);
        this.buildBackdrop(theme);
    }

    buildWater(water) {
        this.water?.dispose();
        this.water = null;
        if (!water) return;
        const size = 1400, cells = this.quality === 'low' ? 70 : 110;
        const positions = [], indices = [];
        for (let z = 0; z <= cells; z++)
            for (let x = 0; x <= cells; x++) positions.push((x / cells - .5) * size, 0, (z / cells - .5) * size);
        for (let z = 0; z < cells; z++)
            for (let x = 0; x < cells; x++) {
                const a = z * (cells + 1) + x, b = a + 1, c = a + cells + 1, d = c + 1;
                indices.push(a, c, b, b, c, d);
            }
        const mesh = this.water = new Mesh('water', this.scene);
        const data = new VertexData();
        data.positions = positions;
        data.indices = indices;
        data.applyToMesh(mesh);
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.isPickable = false;
        const material = this.waterMaterial = new ShaderMaterial('waterMat', this.scene, { vertex: 'vwWater', fragment: 'vwWater' }, {
            attributes: ['position'],
            uniforms: ['world', 'viewProjection', 'time', 'level', 'amplitude', 'deep', 'shallow', 'foam', 'sunDir', 'sunColor', 'skyColor', 'eye', 'fogColor', 'fogDensity', 'flash']
        });
        material.backFaceCulling = false;
        material.setColor3('deep', color3(water.deep));
        material.setColor3('shallow', color3(water.shallow));
        material.setColor3('foam', color3(water.foam ?? '#e8f6ff'));
        material.setColor3('skyColor', color3(water.sky ?? this.theme.sky.horizon));
        material.setFloat('level', water.level ?? 0);
        material.setFloat('amplitude', water.amplitude ?? .6);
        material.setFloat('flash', 0);
        mesh.material = material;
        this.waterLevel = water.level ?? 0;
    }

    buildBackdrop(theme) {
        for (const mesh of this.backdropMeshes) mesh.dispose();
        this.backdropMeshes = [];
        const random = rng(theme.seed ?? 5);
        if (theme.mountains) {
            const spec = theme.mountains;
            const geo = new Geo({ vary: .05, seed: 3 });
            const rings = spec.rings ?? [{ radius: 1500, height: spec.height ?? 260, color: spec.color, color2: spec.color2 ?? spec.color, count: 64 }];
            for (const ring of rings) {
                const count = ring.count ?? 60;
                const heights = Array.from({ length: count }, () => ring.height * (.35 + random() * .65));
                for (let i = 0; i < count; i++) {
                    const a0 = i / count * Math.PI * 2, a1 = (i + 1) / count * Math.PI * 2, am = (a0 + a1) / 2;
                    const r = ring.radius * (1 + (random() - .5) * .08);
                    const h = heights[i];
                    const peak = [Math.cos(am) * r * .985, h, Math.sin(am) * r * .985];
                    const left = [Math.cos(a0 - .02) * r, -20, Math.sin(a0 - .02) * r];
                    const right = [Math.cos(a1 + .02) * r, -20, Math.sin(a1 + .02) * r];
                    const shoulder = [Math.cos(a0 + .3 / count) * r, h * (.45 + random() * .3), Math.sin(a0 + .3 / count) * r];
                    const center = [Math.cos(am) * r * 1.4, h * .3, Math.sin(am) * r * 1.4];
                    const low = mix(ring.color, ring.color2, .7);
                    geo.tri(left, shoulder, peak, mix(ring.color, ring.color2, random() * .5), center);
                    geo.tri(left, peak, right, ring.color, center);
                    if (ring.snow && h > ring.height * .75) {
                        const cap = [peak[0], peak[1] - h * .18, peak[2]];
                        geo.tri([cap[0] + Math.sin(am) * 30, cap[1], cap[2] - Math.cos(am) * 30], [cap[0] - Math.sin(am) * 30, cap[1], cap[2] + Math.cos(am) * 30],
                            [peak[0] * 0.996, peak[1] + 1, peak[2] * 0.996], ring.snow, center);
                    }
                    geo.tri(left, right, [Math.cos(am) * r * 1.01, -20, Math.sin(am) * r * 1.01], low, center);
                }
            }
            const mesh = geo.build('mountains', this.scene, this.unlit);
            mesh.applyFog = false;
            mesh.parent = this.backdrop;
            this.backdropMeshes.push(mesh);
        }
        if (theme.clouds) {
            const geo = new Geo({ vary: .04, seed: 9 });
            const spec = theme.clouds;
            for (let i = 0; i < (spec.count ?? 26); i++) {
                const angle = random() * Math.PI * 2, distance = 380 + random() * 1000;
                const cx = Math.cos(angle) * distance, cz = Math.sin(angle) * distance, cy = (spec.height ?? 170) + random() * 120;
                const puffs = 3 + Math.floor(random() * 4);
                for (let p = 0; p < puffs; p++) {
                    const r = 16 + random() * 22;
                    geo.ico(cx + (p - puffs / 2) * r * 1.1, cy + random() * 8, cz + (random() - .5) * 20, r, spec.color ?? '#ffffff',
                        { sy: .45, colorOf: y => y > 0 ? (spec.color ?? '#ffffff') : (spec.shadow ?? '#c9d6ef') });
                }
            }
            const mesh = geo.build('clouds', this.scene, this.unlit);
            mesh.applyFog = false;
            mesh.parent = this.backdrop;
            this.backdropMeshes.push(mesh);
        }
    }

    /** Places the camera: position, look target, roll (radians) and an extra FOV factor. */
    view(position, target, roll = 0, fovScale = 1) {
        const camera = this.camera;
        let px = position.x, py = position.y, pz = position.z;
        if (this.shake > .001) {
            const r = this.shakeSeed;
            px += (r() - .5) * this.shake;
            py += (r() - .5) * this.shake;
            pz += (r() - .5) * this.shake * .5;
        }
        camera.position.set(px, py, pz);
        const forward = target.subtract(camera.position).normalize();
        const yaw = Math.atan2(forward.x, forward.z);
        const pitch = -Math.asin(Math.max(-1, Math.min(1, forward.y)));
        Quaternion.RotationYawPitchRollToRef(yaw, pitch, roll, camera.rotationQuaternion);
        camera.fov = this.baseFov * fovScale;
    }

    /** Called once per rendered frame before scene.render. */
    update(dt) {
        this.time += dt;
        this.flash = Math.max(0, this.flash - dt * 2.2);
        this.shake = Math.max(0, this.shake - dt * 3.5 * Math.max(1, this.shake));
        const eye = this.camera.position;
        this.backdrop.position.set(eye.x, 0, eye.z);
        this.skyMaterial.setFloat('flash', this.flash * .8);
        if (this.water) {
            const step = 1400 / 110;
            this.water.position.set(Math.round(eye.x / step) * step, 0, Math.round(eye.z / step) * step);
            const m = this.waterMaterial;
            m.setFloat('time', this.time);
            m.setVector3('sunDir', this.sunDir);
            m.setColor3('sunColor', this.sun.diffuse);
            m.setVector3('eye', eye);
            m.setColor3('fogColor', this.scene.fogColor);
            m.setFloat('fogDensity', this.scene.fogDensity);
            m.setFloat('flash', this.flash * .6);
        }
    }

    setAberration(amount) {
        if (this.pipeline?.chromaticAberration) this.pipeline.chromaticAberration.aberrationAmount = amount;
    }

    /** World point → CSS pixels of the canvas ({ x, y, visible }). */
    project(world) {
        const camera = this.camera;
        const w = this.engine.getRenderWidth(), h = this.engine.getRenderHeight();
        const p = Vector3.Project(world, Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), camera.viewport.toGlobal(w, h));
        const scale = this.engine.getHardwareScalingLevel();
        const forward = camera.getDirection(Vector3.Forward());
        const visible = Vector3.Dot(world.subtract(camera.position), forward) > 0;
        return { x: p.x * scale, y: p.y * scale, visible };
    }
}
