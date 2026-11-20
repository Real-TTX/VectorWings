// The living background of the menus: the squadron over the river canyon, and the hangar close-up of the chosen ship.
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { THEMES } from './worlds/themes.js';
import { createWorld } from './worlds/index.js';
import { Rail } from './rail.js';
import { Level, LEVELS } from './level.js';
import { ShipView } from './render/actors.js';

export class MenuScene {
    constructor(stage, key = 'river') {
        this.stage = stage;
        const def = LEVELS.missions.find(m => m.key === key) ?? LEVELS.missions[0];
        stage.setTheme(THEMES[def.key]);
        this.rail = new Rail(def.curve, 34);
        this.level = new Level({ ...def, props: def.props.filter(p => p[1] !== 'harbour') });
        this.world = createWorld(def.key, stage, { rail: this.rail, level: { ...this.level, grounds: [] }, field: LEVELS.arena });
        this.t = 40 + Math.random() * 30;
        this.ships = [0, 1, 2].map(design => new ShipView(stage, design, design, { shadow: true }));
        this.hangar = null;
        this.shipDesign = 0;
        for (let i = 0; i < 40; i++) this.world.update(this.rail.speed * this.t - 30);
    }

    showHangar(design, slot = 0) {
        this.shipDesign = design;
        if (this.hangar?.design !== design || this.hangar?.slot !== slot) {
            this.hangar?.dispose();
            this.hangar = new ShipView(this.stage, design, slot, { shadow: false });
            this.hangar.design = design;
            this.hangar.slot = slot;
        }
        this.mode = 'hangar';
        this.hangar.setVisible(true);
        for (const ship of this.ships) ship.setVisible(false);
    }

    showFlight() {
        this.mode = 'flight';
        this.hangar?.setVisible(false);
        for (const ship of this.ships) ship.setVisible(true);
    }

    tick(dt) {
        this.t += dt;
        const t = this.t, rail = this.rail;
        const s = rail.speed * t;
        const formation = [[0, 12, 0], [-8, 15, -6], [8, 10, -7]];
        this.ships.forEach((ship, i) => {
            const [fx, fy, fd] = formation[i];
            const x = fx + Math.sin(t * .6 + i * 2) * 3, y = fy + Math.sin(t * .45 + i) * 1.5;
            const p = rail.toWorld(s + fd, x, y, new Vector3());
            ship.place(p, rail.heading(s + fd) + Math.cos(t * .6 + i * 2) * .1, Math.cos(t * .45 + i) * -.05, -Math.cos(t * .6 + i * 2) * .35, 0, 0);
        });
        let eye, look, roll = 0;
        if (this.mode === 'hangar' && this.hangar) {
            const p = rail.toWorld(s + 6, 0, 13, new Vector3());
            const spin = t * .35;
            this.hangar.place(p, rail.heading(s) + spin, 0, Math.sin(t) * .06, null, 0);
            const desktop = innerWidth > 860;
            eye = rail.toWorld(s + 6 - 8.5, desktop ? 3.2 : 0, 14.6, new Vector3());
            look = rail.toWorld(s + 6, desktop ? 3.2 : 0, desktop ? 13 : 11.6, new Vector3());
        } else {
            const a = Math.sin(t * .07) * .9;
            eye = rail.toWorld(s - 18 + Math.cos(a) * 4, Math.sin(a) * 16, 17 + Math.sin(t * .1) * 3, new Vector3());
            look = rail.toWorld(s + 20, Math.sin(a) * 4 - 4, 11, new Vector3());
            roll = Math.sin(t * .07) * .04;
        }
        this.stage.view(eye, look, roll, 1);
        this.world.update(s - 30);
    }

    dispose() {
        this.world.dispose();
        for (const ship of this.ships) ship.dispose();
        this.hangar?.dispose();
    }
}

void Quaternion;
