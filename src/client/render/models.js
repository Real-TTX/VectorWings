// Every model of VectorWings, built from the low-poly kit: the three player ships, the enemy craft, ground units and pickups.
// Axes: +z is the nose, +y up, +x the right wing. One unit is about one metre.
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Geo, mix, shade } from './kit.js';

export const TEAM = ['#ff8a3d', '#3fb8ff', '#8fdc4a', '#ff5fa2'];
export const TEAM_NAMES = ['Orange', 'Blau', 'Grün', 'Rosa'];

export const SHIPS = [
    { id: 0, name: 'Lanze', model: 'VW-3 Lanze', text: 'Ausgewogen: solide Panzerung, drei Smart-Bomben an Bord.', speed: .7, power: .6, agility: .65, shield: 100, bombs: 3 },
    { id: 1, name: 'Sperber', model: 'VW-5 Sperber', text: 'Schnell und wendig, lädt den Zielsuchschuss schneller – nur zwei Bomben.', speed: .9, power: .45, agility: .9, shield: 85, bombs: 2 },
    { id: 2, name: 'Bastion', model: 'VW-9 Bastion', text: 'Schwer gepanzert und träge, startet mit Doppellaser.', speed: .5, power: .9, agility: .45, shield: 130, bombs: 3 }
];

const WHITE = '#eef2f7', LIGHT = '#c9d3df', GREY = '#8d99a8', DARK = '#2b3140', NAVY = '#263f86', GLASS = '#1d3563', GLASS_HI = '#5b86c4';

function torus(geo, radius, tube, segments, sides, color, colorOf) {
    for (let i = 0; i < segments; i++) {
        const a0 = i / segments * Math.PI * 2, a1 = (i + 1) / segments * Math.PI * 2;
        for (let j = 0; j < sides; j++) {
            const b0 = j / sides * Math.PI * 2, b1 = (j + 1) / sides * Math.PI * 2;
            const p = (a, b) => [Math.cos(a) * (radius + Math.cos(b) * tube), Math.sin(b) * tube, Math.sin(a) * (radius + Math.cos(b) * tube)];
            const center = [Math.cos((a0 + a1) / 2) * radius, 0, Math.sin((a0 + a1) / 2) * radius];
            geo.quad(p(a0, b0), p(a1, b0), p(a1, b1), p(a0, b1), colorOf ? colorOf(j) : color, center);
        }
    }
}

function fuselageColors(top, side, belly, accent, accentRings = []) {
    return (ring, face) => {
        if (face === 3 || face === 4) return belly;
        if (face === 2 || face === 5) return side;
        return accentRings.includes(ring) ? accent : top;
    };
}

/** Builds one player ship. Returns the root node with body + glow meshes and the hard points. */
export function buildShip(stage, design, slot, name = 'ship') {
    const accent = TEAM[slot % 4];
    const accentDark = shade(accent, .72);
    const geo = new Geo({ vary: .035, seed: 11 + design });
    const glow = new Geo({ vary: 0 });
    const engines = [];
    let muzzles, wingtips;

    if (design === 0) {
        // VW-3 Lanze: hexagonal fuselage, cranked delta wings, canted wingtip fins, two engine pods.
        geo.loft([
            { z: 2.5, w: 0, h: 0, y: -.02 }, { z: 1.85, w: .42, h: .34 }, { z: 1.0, w: .78, h: .6, y: .04 },
            { z: -.2, w: .98, h: .74, y: .06 }, { z: -1.3, w: .86, h: .62 }, { z: -1.95, w: .58, h: .44 }
        ], 6, WHITE, { colors: fuselageColors(WHITE, LIGHT, NAVY, accent, [1]) });
        geo.loft([{ z: 1.5, w: 0, h: 0, y: .3 }, { z: .95, w: .44, h: .38, y: .38 }, { z: .05, w: .5, h: .42, y: .42 }, { z: -.55, w: 0, h: 0, y: .3 }],
            6, GLASS, { colors: (r, f) => (f === 0 || f === 1) && r === 1 ? GLASS_HI : GLASS });
        geo.mirror((g, side) => {
            g.plate([[.35, .65], [1.25, -.35], [2.45, -1.05], [2.5, -1.42], [1.2, -1.45], [.4, -1.35]], .13, WHITE, { y: -.08, under: NAVY, edge: LIGHT });
            g.plate([[1.15, -.28], [2.38, -1.0], [2.4, -1.13], [1.1, -.45]], .02, accent, { y: -.005 });
            g.at({ x: 2.47, y: -.06, z: -1.12, roll: -.75 }, f => f.plate([[0, .3], [.5, -.3], [.5, -.5], [0, -.5]], .09, accent, { edge: accentDark }));
            g.at({ x: .82, y: -.02, z: -1.0 }, e => {
                e.loft([{ z: .75, w: 0, h: 0 }, { z: .45, w: .44, h: .44 }, { z: -.6, w: .56, h: .56 }, { z: -1.15, w: .5, h: .5 }], 8, LIGHT,
                    { colors: (r, f) => r === 2 ? GREY : (f >= 4 && f <= 6 ? GREY : LIGHT) });
                e.cylinder(0, 0, -1.2, .24, .14, 8, DARK);
            });
            g.at({ x: .45, y: -.05, z: 1.35 }, c => c.plate([[0, .25], [.55, -.05], [.55, -.18], [0, -.2]], .06, NAVY));
            g.box(.55, -.18, .2, .22, .2, .7, DARK);
        });
        geo.at({ x: 0, y: .42, z: -1.05, roll: Math.PI / 2 }, f => f.plate([[0, .35], [.62, -.45], [.62, -.75], [0, -.6]], .08, NAVY, { edge: accent }));
        for (const side of [-1, 1]) {
            glow.at({ x: .82 * side, y: -.02, z: -2.28, pitch: Math.PI / 2 }, g => g.cylinder(0, 0, 0, .2, .06, 8, '#4fd6ff'));
            engines.push(new Vector3(.82 * side, -.02, -2.3));
        }
        muzzles = [new Vector3(-.62, -.15, 1.0), new Vector3(.62, -.15, 1.0)];
        wingtips = [new Vector3(-2.5, -.1, -1.4), new Vector3(2.5, -.1, -1.4)];
    } else if (design === 1) {
        // VW-5 Sperber: long needle body, forward-swept wings, canards and canted twin tails, one big engine.
        geo.loft([
            { z: 2.9, w: 0, h: 0 }, { z: 2.0, w: .36, h: .3 }, { z: .9, w: .66, h: .52, y: .04 },
            { z: -.4, w: .82, h: .62, y: .05 }, { z: -1.6, w: .78, h: .6 }, { z: -2.05, w: .66, h: .54 }
        ], 6, WHITE, { colors: fuselageColors(WHITE, LIGHT, DARK, accent, [1, 3]) });
        geo.loft([{ z: 1.8, w: 0, h: 0, y: .26 }, { z: 1.25, w: .36, h: .32, y: .32 }, { z: .3, w: .42, h: .36, y: .36 }, { z: -.2, w: 0, h: 0, y: .26 }],
            6, GLASS, { colors: (r, f) => (f === 0 || f === 1) && r === 1 ? GLASS_HI : GLASS });
        geo.mirror(g => {
            g.plate([[.3, -1.25], [1.9, .1], [2.12, .05], [2.15, -.32], [.38, -1.85]], .11, WHITE, { y: -.1, under: DARK, edge: LIGHT });
            g.plate([[1.6, -.18], [2.1, .03], [2.12, -.1], [1.62, -.3]], .02, accent, { y: -.04 });
            g.at({ x: .3, y: -.04, z: 1.55 }, c => c.plate([[0, .2], [.62, -.12], [.62, -.24], [0, -.28]], .06, accent));
            g.at({ x: .38, y: .25, z: -1.35, roll: Math.PI / 2 - .38 }, f => f.plate([[0, .3], [.85, -.4], [.85, -.62], [0, -.62]], .07, WHITE, { edge: accent }));
            g.at({ x: 2.12, y: -.1, z: -.15, roll: .5 }, f => f.plate([[0, .2], [.36, -.1], [.36, -.2], [0, -.25]], .05, accent));
        });
        geo.at({ z: -2.1, pitch: Math.PI / 2 }, g => g.cylinder(0, 0, 0, .42, .2, 10, GREY));
        glow.at({ z: -2.25, pitch: Math.PI / 2 }, g => g.cylinder(0, 0, 0, .3, .06, 10, '#4fd6ff'));
        engines.push(new Vector3(0, 0, -2.3));
        muzzles = [new Vector3(-.45, -.12, 1.3), new Vector3(.45, -.12, 1.3)];
        wingtips = [new Vector3(-2.15, -.1, -.2), new Vector3(2.15, -.1, -.2)];
    } else {
        // VW-9 Bastion: broad armoured body, gull wings with four engine pods and a chin cannon.
        geo.loft([
            { z: 2.3, w: .3, h: .22, y: -.08 }, { z: 1.6, w: .9, h: .62 }, { z: .6, w: 1.34, h: .86, y: .05 },
            { z: -.7, w: 1.42, h: .9, y: .06 }, { z: -1.7, w: 1.1, h: .7 }, { z: -2.15, w: .8, h: .5 }
        ], 6, WHITE, { colors: fuselageColors(WHITE, LIGHT, GREY, accent, [2]) });
        geo.loft([{ z: 1.45, w: 0, h: 0, y: .42 }, { z: 1.0, w: .55, h: .4, y: .5 }, { z: .15, w: .62, h: .44, y: .54 }, { z: -.35, w: 0, h: 0, y: .44 }],
            6, GLASS, { colors: (r, f) => (f === 0 || f === 1) && r === 1 ? GLASS_HI : GLASS });
        geo.box(0, -.42, 1.75, .3, .2, .9, DARK);
        geo.mirror(g => {
            g.at({ x: .55, y: -.05, z: -.5, roll: -.22 }, w => w.plate([[0, .7], [1.2, .1], [1.25, -.9], [0, -1.1]], .16, WHITE, { under: GREY, edge: LIGHT }));
            g.at({ x: 1.72, y: -.33, z: -.55, roll: .3 }, w => {
                w.plate([[0, .2], [1.0, -.4], [1.05, -.75], [0, -.65]], .13, WHITE, { under: GREY, edge: LIGHT });
                w.plate([[.1, .12], [.95, -.4], [.98, -.5], [.1, -.05]], .02, accent, { y: .075 });
            });
            for (const x of [1.15, 1.82]) {
                g.at({ x, y: -.42, z: -.85 }, e => {
                    e.loft([{ z: .55, w: 0, h: 0 }, { z: .3, w: .36, h: .36 }, { z: -.7, w: .42, h: .42 }, { z: -.95, w: .36, h: .36 }], 8, LIGHT,
                        { colors: (r, f) => r === 2 ? GREY : LIGHT });
                });
            }
            g.at({ x: .7, y: .38, z: -1.5, roll: Math.PI / 2 - .2 }, f => f.plate([[0, .3], [.55, -.3], [.55, -.55], [0, -.5]], .08, accent));
        });
        for (const side of [-1, 1]) for (const x of [1.15, 1.82]) {
            const y = x > 1.5 ? -.42 : -.42;
            glow.at({ x: x * side, y, z: -1.85, pitch: Math.PI / 2 }, g => g.cylinder(0, 0, 0, .15, .05, 8, '#4fd6ff'));
            engines.push(new Vector3(x * side, y, -1.9));
        }
        muzzles = [new Vector3(-.7, -.2, 1.1), new Vector3(.7, -.2, 1.1)];
        wingtips = [new Vector3(-2.8, -.15, -1.0), new Vector3(2.8, -.15, -1.0)];
    }

    const root = new TransformNode(name, stage.scene);
    const body = geo.build(name + '-body', stage.scene, stage.flatShiny);
    body.parent = root;
    const glowMesh = glow.build(name + '-glow', stage.scene, stage.unlit);
    glowMesh.parent = root;
    stage.addGlow(glowMesh);
    return { root, body, glow: glowMesh, engines, muzzles, wingtips, accent };
}

/** Enemy and prop models. Each returns a Geo set { body, glow?, parts? } that the pools turn into meshes. */
const RED = '#c2283a', RED_DARK = '#7d1626', BLACK = '#23222b', STEEL = '#5d6472', STEEL_LIGHT = '#8b93a3', GOLD = '#e8b43c';

export const ENEMY_MODELS = {
    fighter(variant = 0) {
        const body = variant === 1 ? RED : STEEL;
        const trim = variant === 1 ? GOLD : RED;
        const g = new Geo({ vary: .05, seed: 3 });
        const e = new Geo({ vary: 0 });
        g.loft([{ z: 1.4, w: 0, h: 0 }, { z: .7, w: .5, h: .38 }, { z: -.4, w: .8, h: .55, y: .05 }, { z: -1.2, w: .6, h: .4 }], 5, body,
            { colors: (r, f) => f === 3 || f === 2 ? BLACK : body });
        g.mirror(m => {
            m.at({ x: .45, z: .6 }, p => p.loft([{ z: 1.3, w: 0, h: 0 }, { z: .5, w: .22, h: .22 }, { z: -.6, w: .3, h: .3 }], 4, trim));
            m.plate([[.3, .2], [2.0, -1.05], [1.95, -1.35], [.4, -1.0]], .1, BLACK, { y: -.05, edge: trim });
            m.plate([[1.4, -.7], [2.0, -1.05], [1.95, -1.3], [1.4, -.95]], .02, trim, { y: .01 });
            m.at({ x: 1.0, y: .1, z: -.9, roll: Math.PI / 2 + .5 }, f => f.plate([[0, .2], [.5, -.3], [.5, -.45], [0, -.4]], .06, trim));
        });
        g.loft([{ z: .5, w: 0, h: 0, y: .25 }, { z: .1, w: .3, h: .26, y: .3 }, { z: -.4, w: 0, h: 0, y: .25 }], 5, '#ff4a4a');
        e.at({ z: -1.25, pitch: Math.PI / 2 }, c => c.cylinder(0, 0, 0, .22, .06, 6, '#ff7a3a'));
        return { body: g, glow: e, radius: 1.7 };
    },
    bomber() {
        const g = new Geo({ vary: .05, seed: 4 });
        const e = new Geo({ vary: 0 });
        g.box(0, 0, 0, 2.2, .9, 4.2, STEEL, { tx: .7, tz: .85, top: STEEL_LIGHT, bottom: BLACK });
        g.loft([{ z: 2.6, w: 0, h: 0, y: .1 }, { z: 2.0, w: 1.2, h: .7, y: .1 }, { z: 1.4, w: 1.6, h: .8, y: .1 }], 6, RED_DARK);
        g.mirror(m => {
            m.plate([[1.0, 1.0], [4.0, -.8], [3.9, -1.5], [1.0, -1.6]], .2, BLACK, { edge: RED });
            m.at({ x: 2.4, y: -.4, z: -.5 }, p => p.loft([{ z: 1.3, w: .2, h: .2 }, { z: .8, w: .7, h: .7 }, { z: -1.4, w: .8, h: .8 }, { z: -1.8, w: .6, h: .6 }], 8, STEEL,
                { colors: (r, f) => r === 1 ? RED : STEEL }));
        });
        g.box(0, .55, -.6, .4, .5, 1.6, RED, { tz: .5 });
        for (const side of [-1, 1]) e.at({ x: 2.4 * side, y: -.4, z: -2.35, pitch: Math.PI / 2 }, c => c.cylinder(0, 0, 0, .3, .06, 8, '#ff7a3a'));
        e.at({ y: .15, z: 2.3 }, c => c.ico(0, 0, 0, .22, '#ff3b3b'));
        return { body: g, glow: e, radius: 3.4 };
    },
    turret() {
        const base = new Geo({ vary: .05, seed: 5 });
        base.cylinder(0, .5, 0, 1.7, 1.0, 8, STEEL, { radiusTop: 1.4, top: STEEL_LIGHT });
        base.cylinder(0, 1.15, 0, 1.0, .3, 8, BLACK);
        const head = new Geo({ vary: .05, seed: 6 });
        head.box(0, 0, 0, 1.6, 1.0, 1.7, RED_DARK, { tx: .8, tz: .8, top: RED });
        head.mirror(m => m.at({ x: .4, y: 0, z: .8, pitch: Math.PI / 2 }, b => b.cylinder(0, .8, 0, .16, 1.6, 6, BLACK)));
        const e = new Geo({ vary: 0 });
        e.box(0, .2, .86, .5, .2, .05, '#ff3b3b');
        return { body: base, head, glow: e, headY: 1.75, radius: 2.0 };
    },
    tank() {
        const hull = new Geo({ vary: .05, seed: 7 });
        hull.box(0, .55, 0, 2.4, .8, 3.6, STEEL, { tx: .85, tz: .85, top: STEEL_LIGHT });
        hull.mirror(m => m.box(1.3, .4, 0, .5, .8, 3.8, BLACK));
        const head = new Geo({ vary: .05, seed: 8 });
        head.box(0, 0, 0, 1.4, .6, 1.6, RED_DARK, { tx: .75, tz: .75, top: RED });
        head.at({ y: .05, z: .8, pitch: Math.PI / 2 }, b => b.cylinder(0, .9, 0, .14, 1.8, 6, BLACK));
        const e = new Geo({ vary: 0 });
        e.box(0, .1, .82, .4, .15, .05, '#ff3b3b');
        return { body: hull, head, glow: e, headY: 1.25, radius: 2.2 };
    },
    walker() {
        const g = new Geo({ vary: .05, seed: 9 });
        g.box(0, 3.4, 0, 1.8, 1.2, 2.0, RED_DARK, { tx: .8, top: RED });
        g.mirror(m => {
            m.box(.7, 2.0, 0, .35, 2.4, .35, STEEL);
            m.box(.7, .4, .3, .7, .4, 1.4, BLACK);
            m.at({ x: 1.1, y: 3.5, z: .5, pitch: Math.PI / 2 }, b => b.cylinder(0, .6, 0, .14, 1.2, 6, BLACK));
        });
        const e = new Geo({ vary: 0 });
        e.box(0, 3.5, 1.02, .9, .18, .05, '#ff3b3b');
        return { body: g, glow: e, radius: 2.2 };
    },
    mine() {
        const g = new Geo({ vary: .05, seed: 10 });
        g.ico(0, 0, 0, .9, BLACK, { detail: 0 });
        for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]])
            g.at({ x: d[0] * .9, y: d[1] * .9, z: d[2] * .9, yaw: Math.atan2(d[0], d[2]), pitch: d[1] ? -Math.sign(d[1]) * Math.PI / 2 : 0 },
                s => s.at({ pitch: Math.PI / 2 }, c => c.cone(0, .3, 0, .22, .6, 4, STEEL_LIGHT)));
        const e = new Geo({ vary: 0 });
        e.ico(0, 0, 0, .55, '#ff3030');
        return { body: g, glow: e, radius: 1.4 };
    },
    rock(variant = 0) {
        const g = new Geo({ vary: .1, seed: 12 + variant });
        const color = ['#8a7f76', '#6f6a70', '#9b6b4f'][variant % 3];
        g.ico(0, 0, 0, 2.2, color, { detail: 1, jitter: .22, colorOf: y => y > .6 ? shade(color, 1.15) : y < -.6 ? shade(color, .75) : color });
        return { body: g, radius: 2.2 };
    },
    carrier() {
        const g = new Geo({ vary: .05, seed: 14 });
        g.loft([{ z: 3.4, w: 0, h: 0 }, { z: 2.4, w: 1.6, h: 1.2 }, { z: -1.6, w: 2.4, h: 1.6, y: .1 }, { z: -2.6, w: 1.8, h: 1.2 }], 6, STEEL,
            { colors: (r, f) => r === 1 && f < 2 ? '#f08a2c' : f === 3 || f === 4 ? BLACK : STEEL });
        g.mirror(m => m.plate([[1.0, .6], [2.8, -1.4], [2.8, -2.2], [1.0, -2.0]], .2, BLACK, { edge: '#f08a2c' }));
        const e = new Geo({ vary: 0 });
        e.at({ z: -2.7, pitch: Math.PI / 2 }, c => c.cylinder(0, 0, 0, .5, .06, 8, '#ffb347'));
        e.ico(0, .9, .4, .3, '#7dff9a');
        return { body: g, glow: e, radius: 3.2 };
    },
    missile() {
        const g = new Geo({ vary: .04, seed: 16 });
        g.loft([{ z: 1.3, w: 0, h: 0 }, { z: .8, w: .5, h: .5 }, { z: -1.1, w: .55, h: .55 }], 6, '#d9dde4', { colors: (r, f) => r === 0 ? RED : '#d9dde4' });
        g.mirror(m => { m.plate([[.2, -.4], [.7, -1.0], [.7, -1.2], [.2, -1.1]], .05, RED); m.at({ roll: Math.PI / 2 }, f => f.plate([[.2, -.4], [.7, -1.0], [.7, -1.2], [.2, -1.1]], .05, RED)); });
        const e = new Geo({ vary: 0 });
        e.at({ z: -1.2, pitch: Math.PI / 2 }, c => c.cylinder(0, 0, 0, .3, .1, 6, '#ffb347'));
        return { body: g, glow: e, radius: 1.2 };
    },
    drone() {
        const g = new Geo({ vary: .05, seed: 15 });
        g.ico(0, 0, 0, .8, STEEL, { sy: .6 });
        g.mirror(m => m.plate([[.5, .3], [1.5, 0], [1.5, -.3], [.5, -.4]], .08, BLACK, { edge: RED }));
        const e = new Geo({ vary: 0 });
        e.ico(0, 0, .55, .28, '#ff3b3b');
        return { body: g, glow: e, radius: 1.3 };
    }
};

export const PICKUP_MODELS = {
    ring() {
        const g = new Geo({ vary: 0 });
        torus(g, 2.2, .28, 14, 5, '#e9f1ff', j => j % 2 ? '#c6d7f0' : '#f4f8ff');
        return { glow: g, radius: 2.4, color: '#e9f1ff' };
    },
    gold() {
        const g = new Geo({ vary: 0 });
        torus(g, 2.2, .32, 14, 5, '#ffd34a', j => j % 2 ? '#e6a92a' : '#ffe27a');
        return { glow: g, radius: 2.4, color: '#ffd34a' };
    },
    bomb() {
        const b = new Geo({ vary: .03, seed: 2 });
        b.loft([{ z: .9, w: 0, h: 0 }, { z: .6, w: .9, h: .9 }, { z: -.6, w: .9, h: .9 }, { z: -.9, w: 0, h: 0 }], 8, '#e8edf3',
            { colors: (r, f) => r === 1 ? '#e0313d' : '#e8edf3' });
        const g = new Geo({ vary: 0 });
        g.ico(0, 0, 0, .3, '#ff5050');
        return { body: b, glow: g, radius: 1.6, color: '#ff6060' };
    },
    laser() {
        const b = new Geo({ vary: .03, seed: 3 });
        b.loft([{ z: .9, w: 0, h: 0 }, { z: .6, w: .9, h: .9 }, { z: -.6, w: .9, h: .9 }, { z: -.9, w: 0, h: 0 }], 8, '#e8edf3',
            { colors: (r, f) => r === 1 ? '#2d8bff' : '#e8edf3' });
        const g = new Geo({ vary: 0 });
        g.ico(0, 0, 0, .3, '#6fd8ff');
        return { body: b, glow: g, radius: 1.6, color: '#6fd8ff' };
    },
    gate() {
        const g = new Geo({ vary: 0 });
        torus(g, 7, .45, 20, 5, '#7dffb0', j => j % 2 ? '#43d987' : '#a9ffd0');
        return { glow: g, radius: 7, color: '#7dffb0' };
    }
};

export { mix, shade };
