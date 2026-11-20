// The cockpit view: canopy frame, dashboard and glowing instruments in camera space (+z ahead, +y up).
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Geo, shade } from './kit.js';
import { TEAM } from './models.js';

export class Cockpit {
    constructor(stage, slot = 0) {
        this.stage = stage;
        const accent = TEAM[slot % 4];
        const root = this.root = new TransformNode('cockpit', stage.scene);
        root.parent = stage.camera;
        const frame = new Geo({ vary: .04, seed: 5 });
        const DARK = '#171b24', MID = '#252b37', LIGHT = '#323a4a';
        // Dashboard: a slanted panel across the bottom with a hood over the instruments.
        frame.quad([-1.6, -.42, 1.05], [1.6, -.42, 1.05], [1.6, -.9, .8], [-1.6, -.9, .8], DARK, [0, -.2, 2]);
        frame.quad([-1.6, -.42, 1.05], [-.55, -.3, 1.15], [.55, -.3, 1.15], [1.6, -.42, 1.05], MID, [0, -1, 1]);
        frame.quad([-.55, -.3, 1.15], [.55, -.3, 1.15], [.5, -.37, 1.0], [-.5, -.37, 1.0], LIGHT, [0, -1, 1.2]);
        frame.box(0, -.62, .95, .5, .28, .08, DARK, { top: MID });
        frame.mirror(g => {
            // Canopy struts from the dashboard corners up into the roof, and the roof bow.
            g.at({ x: 1.08, y: .12, z: 1.25, roll: .32 }, s => s.box(0, 0, 0, .07, 1.25, .07, MID));
            g.at({ x: .62, y: .72, z: 1.3, roll: 1.05 }, s => s.box(0, 0, 0, .06, .75, .06, MID));
            g.box(1.35, -.2, 1.0, .5, .5, .3, DARK, { top: MID });
        });
        frame.box(0, .9, 1.35, 1.1, .06, .1, MID);
        frame.box(0, .78, 1.35, .05, .2, .05, LIGHT);
        this.body = frame.build('cockpit-frame', stage.scene, stage.flat);
        this.body.parent = root;
        const glow = new Geo({ vary: 0 });
        // Instruments: radar ring, two display panes, warning lights, an accent stripe.
        glow.at({ x: -.32, y: -.52, z: 1.02, pitch: -1.05 }, g => {
            for (let i = 0; i < 14; i++) {
                const a0 = i / 14 * Math.PI * 2, a1 = (i + 1) / 14 * Math.PI * 2;
                g.quad([Math.cos(a0) * .1, 0, Math.sin(a0) * .1], [Math.cos(a1) * .1, 0, Math.sin(a1) * .1],
                    [Math.cos(a1) * .085, 0, Math.sin(a1) * .085], [Math.cos(a0) * .085, 0, Math.sin(a0) * .085], '#3dff7a', [0, -1, 0]);
            }
        });
        glow.at({ x: .32, y: -.52, z: 1.02, pitch: -1.05 }, g => g.box(0, 0, 0, .26, .01, .14, '#2e8bff'));
        glow.at({ x: 0, y: -.5, z: .99, pitch: -1.05 }, g => g.box(0, 0, 0, .12, .01, .08, '#ffb347'));
        for (let i = 0; i < 5; i++) glow.box(-.9 + i * .08, -.47, 1.0, .03, .03, .02, i === 4 ? '#ff4a4a' : '#7dffb0');
        glow.box(0, -.305, 1.155, 1.08, .012, .02, shade(accent, 1.1));
        this.glow = glow.build('cockpit-glow', stage.scene, stage.glowMaterial('#ffffff', .55));
        this.glow.parent = root;
        for (const mesh of [this.body, this.glow]) { mesh.renderingGroupId = 2; mesh.alwaysSelectAsActiveMesh = true; }
        this.visible = true;
        this.setVisible(false);
    }

    setVisible(on) {
        if (on === this.visible) return;
        this.visible = on;
        this.root.setEnabled(on);
    }

    /** A little sway with steering and a flicker of the lamps. */
    update(bank, pitch, time) {
        this.root.position.set(Math.sin(bank) * .03, -Math.max(-.04, Math.min(.04, pitch * .05)), 0);
        this.glow.visibility = .85 + Math.sin(time * 9) * .05;
    }

    dispose() {
        this.root.dispose(false, true);
    }
}
