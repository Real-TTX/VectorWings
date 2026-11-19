import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';

const themes = {
    river: ['#8fb8e6', '#527fae', '#328db5', '#ab674e', '#dc946c', '#41406a'],
    desert: ['#f0bf99', '#cf8c80', '#ac7352', '#964834', '#dc8259', '#63506f'],
    orbit: ['#111830', '#242b51', '#161f3a', '#393959', '#65688e', '#84b6e2'],
    city: ['#e49393', '#825c89', '#524662', '#473857', '#69476a', '#f8ae7c'],
    arena: ['#a0bbc7', '#537183', '#286979', '#3e5967', '#998168', '#e4a567']
};
const teamColors = ['#43baff', '#ff9e55', '#a5e69c', '#e996ef'];
const tileLength = 24;
const lerp = (a, b, weight) => a + (b - a) * weight;

export function createRenderer(canvas, reticle) {
    const engine = new Engine(canvas, true, { stencil: false }, false);
    engine.setHardwareScalingLevel(Math.max(1, window.devicePixelRatio / 1.5));
    let world;
    let frame;
    let previous;
    let received = 0;
    let slot = -1;
    let currentRoom = '';
    let demoTime = 0;
    let active = false;
    let inside = false;

    function material(scene, name, color, emissive = false) {
        const surface = new StandardMaterial(name, scene);
        surface.diffuseColor = Color3.FromHexString(color);
        surface.specularColor = Color3.Black();
        if (emissive) surface.emissiveColor = Color3.FromHexString(color).scale(.82);
        return surface;
    }

    function box(scene, parent, name, x, y, z, width, height, depth, surface) {
        const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
        mesh.position.set(x, y, z);
        mesh.material = surface;
        mesh.parent = parent;
        return mesh;
    }

    function rock(scene, parent, name, x, y, z, width, height, depth, surface) {
        const mesh = MeshBuilder.CreatePolyhedron(name, { type: 1, size: 1, flat: true }, scene);
        mesh.position.set(x, y, z);
        mesh.scaling.set(width, height, depth);
        mesh.material = surface;
        mesh.parent = parent;
        return mesh;
    }

    function wing(scene, parent, name, points, surface) {
        const mesh = new Mesh(name, scene);
        const positions = points.flat();
        const indices = [0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3];
        const normals = [];
        VertexData.ComputeNormals(positions, indices, normals);
        const data = new VertexData();
        data.positions = positions;
        data.indices = indices;
        data.normals = normals;
        data.applyToMesh(mesh);
        mesh.convertToFlatShadedMesh();
        mesh.material = surface;
        mesh.parent = parent;
    }

    function makeShip(scene, color, surfaces, enemy = false) {
        const root = new TransformNode('ship', scene);
        const hull = enemy ? surfaces.dark : surfaces.hull;
        const accent = material(scene, 'livery', color);
        accent.backFaceCulling = false;
        wing(scene, root, 'fuselage', [[0, 0, 2.6], [-.64, -.18, -1.3], [.64, -.18, -1.3], [0, .55, -.6]], hull);
        for (const side of [-1, 1]) {
            wing(scene, root, 'delta wing', [[0, .15, .55], [side * 2.6, -.18, -1.3],
                [side * .46, -.28, -1.45], [side * .75, .31, -.72]], accent);
            const engineHousing = box(scene, root, 'engine housing', side * .56, -.03, -1.03, .38, .44, .97, surfaces.dark);
            engineHousing.rotation.z = side * .16;
            box(scene, root, 'engine glow', side * .56, -.05, -1.52, .24, .21, .1, surfaces.glow);
        }
        rock(scene, root, 'canopy', 0, .29, .14, .31, .19, .58, surfaces.glass);
        root.metadata = { material: accent };
        return root;
    }

    function makeBoss(scene, theme, surfaces) {
        const root = new TransformNode('boss', scene);
        const bodyWidth = theme === 'orbit' ? 13 : 8;
        const height = theme === 'city' ? 4.5 : 3.2;
        rock(scene, root, 'armor', 0, .4, 0, bodyWidth * .64, height, 4, surfaces.dark);
        for (const side of [-1, 1]) {
            const armor = box(scene, root, 'jointed armor', side * bodyWidth * .64, -.7, .2, 5, 1.25, 4, surfaces.metal);
            armor.rotation.z = side * .42;
            if (theme === 'river') {
                const leg = box(scene, root, 'strut', side * 7.2, -2, -.2, 1, 6, 1.4, surfaces.dark);
                leg.rotation.z = side * .45;
            } else {
                box(scene, root, 'battery', side * bodyWidth * .66, -.25, -1.9, 1.6, .65, 2.8, surfaces.warning);
            }
        }
        const core = rock(scene, root, 'reactor', 0, 0, -3.5, 1.12, .95, .42, surfaces.loot);
        root.metadata = { core };
        return root;
    }

    function buildWorld(theme) {
        world?.scene.dispose();
        const scene = new Scene(engine);
        const palette = themes[theme];
        const sky = Color3.FromHexString(palette[0]);
        scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
        scene.fogMode = Scene.FOGMODE_LINEAR;
        scene.fogColor = Color3.FromHexString(palette[1]);
        scene.fogStart = 61;
        scene.fogEnd = theme === 'orbit' ? 210 : 160;
        const camera = new FreeCamera('chase', new Vector3(0, 8.5, -13), scene);
        camera.minZ = .3;
        camera.maxZ = 360;
        camera.fov = 1;
        const ambient = new HemisphericLight('skylight', new Vector3(.15, 1, -.35), scene);
        ambient.intensity = 1.03;
        ambient.groundColor = Color3.FromHexString('#394164');
        const sun = new DirectionalLight('sunlight', new Vector3(.7, -.75, .42), scene);
        sun.diffuse = Color3.FromHexString('#ffdfb3');
        sun.intensity = .79;

        const surfaces = {
            ground: material(scene, 'terrain', palette[2]), cliff: material(scene, 'slope', palette[3]),
            upper: material(scene, 'slope highlight', palette[4]), metal: material(scene, 'built structures', palette[5]),
            hull: material(scene, 'ship hull', '#e6edff'), dark: material(scene, 'gunmetal', '#293350'),
            glass: material(scene, 'canopy', '#303f66', true), glow: material(scene, 'plasma', '#55dcff', true),
            line: material(scene, 'glints', theme === 'river' ? '#53b4ce' : palette[4]),
            warning: material(scene, 'hostile', '#ff644b', true), loot: material(scene, 'upgrade', '#ffc15b', true),
            repair: material(scene, 'repair', '#80ffbd', true)
        };
        surfaces.hull.backFaceCulling = false;
        surfaces.dark.backFaceCulling = false;
        const tiles = [];
        const place = (n, seed) => (Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453 + 100000) % 1;
        if (theme === 'arena') {
            box(scene, null, 'dock water', 0, -.7, 0, 150, 1, 150, surfaces.ground);
            for (const side of [-1, 1]) {
                box(scene, null, 'pier', side * 46, 0, 0, 9, 2, 100, surfaces.cliff);
                box(scene, null, 'pier', 0, 0, side * 46, 100, 2, 9, surfaces.cliff);
                for (let i = -35; i < 40; i += 8) {
                    box(scene, null, 'cargo', side * 47, 2, i, 4, 3, 5, i % 3 === 0 ? surfaces.upper : surfaces.metal);
                    box(scene, null, 'dock light', i, 1.15, side * 42, 1.7, .2, .3, surfaces.loot);
                }
            }
        } else {
            for (let n = 0; n < 12; n++) {
                const tile = new TransformNode('landscape segment', scene);
                tiles.push(tile);
                if (theme !== 'orbit') box(scene, tile, 'floor', 0, -.75, 0, 165, 1, tileLength, surfaces.ground);
                for (const side of [-1, 1]) {
                    const x = side * (24 + place(n, 3) * 13);
                    if (theme === 'river' || theme === 'desert') {
                        rock(scene, tile, 'cliff', x, 6, 0, 8 + place(n, 5) * 6, 8 + place(n, 1) * 15, 13, surfaces.cliff);
                        rock(scene, tile, 'ridge', x + side * 11, 12, -4, 12, 12 + place(n, 9) * 15, 14, surfaces.upper);
                        if (n % 3 !== 0) {
                            box(scene, tile, 'boathouse', side * 18, 1, n % 5 - 2, 4.3, 2, 6, surfaces.metal);
                            box(scene, tile, 'roof', side * 18, 2.12, n % 5 - 2, 4.7, .4, 6.4, surfaces.upper);
                            box(scene, tile, 'window', side * 18, 1.2, n % 5 - 5.1, 2.2, .42, .16, surfaces.loot);
                        }
                    } else if (theme === 'city') {
                        const height = 6 + place(n, side) * 24;
                        box(scene, tile, 'tower', side * 23, height / 2, 0, 8, height, 11, surfaces.cliff);
                        box(scene, tile, 'tower crown', side * 23, height, 0, 6.2, 2, 9, surfaces.metal);
                        for (let y = 3; y < height; y += 3)
                            box(scene, tile, 'lit windows', side * 19, y, 0, .14, .4, 8, surfaces.upper);
                    } else {
                        rock(scene, tile, 'debris', x, (place(n, side) - .5) * 27, 5, 3, 2.5, 4, surfaces.upper);
                        if (n % 3 === 0) {
                            box(scene, tile, 'orbital dock', side * 20, 2, -6, 5, 6, 18, surfaces.metal);
                            box(scene, tile, 'dock gantry', side * 28, 13, 0, 18, 1, 2, surfaces.dark);
                        }
                        for (let star = 0; star < 6; star++)
                            box(scene, tile, 'star', side * (30 + place(n, star) * 86),
                                8 + place(n + 3, star) * 53, -10 + 3 * star, .23, .23, .23, surfaces.hull);
                    }
                }
                if (theme === 'desert') {
                    for (const x of [9, 10]) box(scene, tile, 'rail', x, -.11, 0, .11, .18, tileLength, surfaces.dark);
                }
                if (theme === 'river' || theme === 'city')
                    for (let mark = 0; mark < 4; mark++) box(scene, tile, 'surface mark', -15 + place(n, mark) * 30,
                        -.215, mark * 6 - 9, .16, .035, 2.4, surfaces.line);
            }
        }
        const pilots = teamColors.map(color => makeShip(scene, color, surfaces));
        const boss = makeBoss(scene, theme, surfaces);
        boss.setEnabled(false);
        const pickupSet = new Map();
        const shots = new Map();
        const scenery = new TransformNode('landmark', scene);
        if (theme === 'river') {
            for (const x of [-21, 21]) box(scene, scenery, 'bridge support', x, 7, 0, 3, 14, 3, surfaces.metal);
            box(scene, scenery, 'cargo bridge', 0, 16, 0, 45, 2.6, 5, surfaces.dark);
            for (let x = -18; x < 21; x += 6) box(scene, scenery, 'bridge beacons', x, 14.65, -2.4, 2.2, .2, .22, surfaces.loot);
            const ferry = new TransformNode('ferry', scene);
            ferry.parent = scenery;
            ferry.position.set(14, 0, -45);
            box(scene, ferry, 'ferry hull', 0, .45, 0, 4.8, 1.15, 13, surfaces.dark);
            box(scene, ferry, 'passenger deck', 0, 1.35, .6, 3.8, .85, 8, surfaces.hull);
            box(scene, ferry, 'windows', 0, 1.65, -.2, 3.9, .35, 5.2, surfaces.glass);
        }
        if (theme === 'desert' || theme === 'city' || theme === 'orbit') {
            for (let n = 0; n < 4; n++) {
                const x = theme === 'desert' ? 9.5 : 11;
                const y = theme === 'orbit' ? 3.6 : .45;
                box(scene, scenery, 'civilian transport', x, y, 9 * n, 2.7, 1.8, 7.2, surfaces.metal);
                box(scene, scenery, 'lighted cabin', x, y + .73, 9 * n, 2.8, .39, 4.7, surfaces.loot);
            }
        }
        world = { scene, camera, surfaces, tiles, pilots, boss, pickupSet, shots, scenery, theme };
    }

    function sync(collection, entries, construct, update) {
        const seen = new Set();
        for (const entry of entries) {
            seen.add(entry.id);
            if (!collection.has(entry.id)) collection.set(entry.id, construct(entry));
            update(collection.get(entry.id), entry);
        }
        for (const [id, node] of collection) if (!seen.has(id)) {
            node.metadata?.material?.dispose();
            node.dispose();
            collection.delete(id);
        }
    }

    function setFrame(value, localSlot) {
        if (currentRoom !== value.code || (frame?.state === 'Lobby' && value.state === 'Playing')) {
            previous = null;
            frame = null;
            currentRoom = value.code;
        } else previous = frame;
        if (world?.theme !== value.mission.theme) buildWorld(value.mission.theme);
        frame = value;
        slot = localSlot;
        received = performance.now();
        active = value.state === 'Playing' || value.state === 'Finished';
    }

    function draw() {
        demoTime += Math.min(engine.getDeltaTime(), 60) / 1000;
        const { scene, camera, surfaces, tiles, pilots, boss, scenery, theme, pickupSet, shots } = world;
        const blend = Math.min(1, (performance.now() - received) / 67);
        const distance = active ? lerp(previous?.distance ?? frame.distance, frame.distance, blend) : demoTime * 10;
        tiles.forEach((tile, index) => {
            const span = tiles.length * tileLength;
            tile.position.z = ((index * tileLength - distance) % span + span + 24) % span - 24;
        });
        scenery.position.z = theme === 'river' ? 290 - distance : 40 + Math.sin(distance * .004) * 16;
        const models = active ? frame.pilots : [
            { slot: 0, x: 0, y: 5 + Math.sin(demoTime) * .4, z: 1, yaw: 0, alive: true },
            { slot: 1, x: -7, y: 7, z: 8, yaw: 0, alive: true }
        ];
        for (const [index, ship] of pilots.entries()) {
            const pilot = models.find(item => item.slot === index);
            ship.setEnabled(!!pilot?.alive);
            if (!pilot?.alive) continue;
            const old = (active && previous?.pilots.find(item => item.slot === index)) || pilot;
            ship.position.set(lerp(old.x, pilot.x, blend), lerp(old.y, pilot.y, blend), lerp(old.z, pilot.z, blend));
            ship.rotation.y = lerp(old.yaw, pilot.yaw, blend);
            ship.rotation.z = pilot.rolling ? demoTime * 18 : Math.max(-.49, Math.min(.49, (old.x - pilot.x) * 1.3));
            if (theme === 'arena') {
                ship.metadata.cores ??= [0, 1, 2].map(core =>
                    rock(scene, ship, 'shield core', (core - 1) * .54, .95, -.9, .16, .2, .16, surfaces.loot));
                ship.metadata.cores.forEach((core, i) => core.setEnabled(i < pilot.shield));
            }
        }
        const viewer = models.find(pilot => pilot.slot === slot && pilot.alive) || models.find(pilot => pilot.alive);
        const ship = viewer ? pilots[viewer.slot] : pilots[0];
        const yaw = theme === 'arena' ? ship.rotation.y : 0;
        const target = new Vector3(ship.position.x + Math.sin(yaw) * 21,
            ship.position.y * .65 + 2, ship.position.z + Math.cos(yaw) * 21);
        camera.position.set(ship.position.x - Math.sin(yaw) * 11, ship.position.y + 4.4, ship.position.z - Math.cos(yaw) * 11);
        if (active && inside && viewer) {
            ship.setEnabled(false);
            camera.position.set(ship.position.x + Math.sin(yaw) * .34, ship.position.y + .48,
                ship.position.z + Math.cos(yaw) * .34);
            target.set(ship.position.x + Math.sin(yaw) * 30, ship.position.y + .28,
                ship.position.z + Math.cos(yaw) * 30);
        }
        camera.setTarget(target);
        camera.rotation.z = active && inside && viewer?.rolling ? Math.sin(demoTime * 13) * .26 : 0;

        boss.setEnabled(active && !!frame.boss);
        if (active && frame.boss) {
            const info = frame.boss;
            boss.position.set(lerp(previous?.boss?.x ?? info.x, info.x, blend),
                lerp(previous?.boss?.y ?? info.y, info.y, blend), info.z);
            boss.rotation.y = Math.sin(demoTime * 1.3) * .14;
            boss.metadata.core.material = info.exposed ? surfaces.loot : surfaces.dark;
        }
        sync(pickupSet, active ? frame.targets : [], entry => {
            if (entry.kind === 'drone' || entry.kind === 'turret') {
                const enemy = makeShip(scene, '#fc6957', surfaces, true);
                enemy.rotation.y = Math.PI;
                if (entry.kind === 'turret') enemy.scaling.setAll(1.45);
                return enemy;
            }
            const surface = entry.kind === 'upgrade' ? surfaces.loot : entry.kind === 'repair' ? surfaces.repair : surfaces.upper;
            const size = entry.kind === 'obstacle' ? 1.65 : .82;
            return rock(scene, null, entry.kind, 0, 0, 0, size, size, size, surface);
        }, (node, entry) => {
            const old = previous?.targets.find(item => item.id === entry.id) || entry;
            node.position.set(entry.x, entry.y, lerp(old.z, entry.z, blend));
            if (entry.kind === 'upgrade' || entry.kind === 'repair') node.rotation.y = demoTime * 1.7;
        });
        sync(shots, active ? frame.shots : [], entry =>
            box(scene, null, 'bolt', 0, 0, 0, .15, .14, entry.friendly ? 2.4 : 1.8,
                entry.friendly ? surfaces.glow : surfaces.warning), (node, entry) => {
            const old = previous?.shots.find(item => item.id === entry.id) || entry;
            node.position.set(lerp(old.x, entry.x, blend), lerp(old.y, entry.y, blend), lerp(old.z, entry.z, blend));
            node.rotation.y = Math.atan2(entry.dx, entry.dz);
        });
        scene.render();
        if (active && viewer) {
            const point = new Vector3(ship.position.x + Math.sin(yaw) * 34, ship.position.y,
                ship.position.z + Math.cos(yaw) * 34);
            const view = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
            const screen = Vector3.Project(point, Matrix.Identity(), scene.getTransformMatrix(), view);
            reticle.style.left = screen.x / view.width * 100 + '%';
            reticle.style.top = screen.y / view.height * 100 + '%';
        }
    }

    buildWorld('river');
    engine.runRenderLoop(draw);
    window.addEventListener('resize', () => engine.resize());
    return { setFrame, cockpit(enabled) { inside = enabled; }, preview() { active = false; frame = null; previous = null; currentRoom = ''; buildWorld('river'); } };
}
