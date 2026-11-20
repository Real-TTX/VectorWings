// Light, sky and atmosphere of every world.
export const THEMES = {
    river: {
        seed: 4,
        sky: { top: '#2f63c9', middle: '#5b98e3', horizon: '#b9dcf5', bottom: '#8fb9da' },
        sun: { dir: [-.35, .62, .7], color: '#fff2cf', light: '#fff1dc', intensity: 1.75, size: 1.2 },
        hemi: { sky: '#bcd8ff', ground: '#8a5a44', intensity: .78 },
        fog: { color: '#a9cdea', density: .0021 },
        water: { deep: '#0a4f86', shallow: '#1d9fd0', foam: '#dff6ff', sky: '#6fb0e6', level: 0, amplitude: .55 },
        mountains: { rings: [
            { radius: 1700, height: 330, color: '#8fa9cf', color2: '#a9c2e2', count: 46, snow: '#eef5ff' },
            { radius: 1250, height: 190, color: '#5f8a76', color2: '#7aa58b', count: 64 }
        ] },
        clouds: { count: 28, color: '#ffffff', shadow: '#cfdff3', height: 190 },
        exposure: 1.08, contrast: 1.15
    },
    desert: {
        seed: 7,
        sky: { top: '#3b3f8f', middle: '#9a6aa8', horizon: '#ffb27a', bottom: '#e9a47e' },
        sun: { dir: [.25, .22, .95], color: '#ffd08a', light: '#ffd9a8', intensity: 1.85, size: 2.2 },
        hemi: { sky: '#d9a8c8', ground: '#a8573a', intensity: .7 },
        fog: { color: '#f2ae86', density: .0024 },
        water: null,
        mountains: { rings: [
            { radius: 1700, height: 260, color: '#9a6f9c', color2: '#c48a8f', count: 40 },
            { radius: 1250, height: 170, color: '#b9674f', color2: '#cf8462', count: 54 }
        ] },
        clouds: { count: 14, color: '#ffd9c2', shadow: '#d99aa0', height: 240 },
        exposure: 1.05, contrast: 1.2
    },
    orbit: {
        seed: 9,
        sky: { top: '#060818', middle: '#0d1230', horizon: '#23285a', bottom: '#0a0d22' },
        sun: { dir: [.6, .35, .7], color: '#cfe0ff', light: '#e6efff', intensity: 1.9, size: 1.6 },
        hemi: { sky: '#6a78c9', ground: '#291d3d', intensity: .55 },
        fog: { color: '#0d1230', density: .0011 },
        stars: 1,
        water: null,
        mountains: null,
        clouds: null,
        exposure: 1.12, contrast: 1.15
    },
    city: {
        seed: 12,
        sky: { top: '#2a2350', middle: '#7a3f6e', horizon: '#ff9351', bottom: '#d9704a' },
        sun: { dir: [-.1, .12, 1], color: '#ffb066', light: '#ffc48a', intensity: 1.9, size: 3.2 },
        hemi: { sky: '#b07ab0', ground: '#4a2a36', intensity: .62 },
        fog: { color: '#d9785a', density: .0026 },
        stars: .25,
        water: null,
        mountains: { rings: [
            { radius: 1650, height: 240, color: '#5a3a5f', color2: '#7a4a62', count: 44 },
            { radius: 1200, height: 140, color: '#3f2b46', color2: '#56344c', count: 60 }
        ] },
        clouds: { count: 12, color: '#ffb38a', shadow: '#a85a6a', height: 260 },
        exposure: 1.0, contrast: 1.22
    },
    arena: {
        seed: 15,
        sky: { top: '#2a6fd0', middle: '#62a7ea', horizon: '#cfe9f7', bottom: '#9cc6de' },
        sun: { dir: [.4, .7, -.5], color: '#fff6d8', light: '#fff4e0', intensity: 1.7, size: 1.2 },
        hemi: { sky: '#cfe6ff', ground: '#4e6b3e', intensity: .8 },
        fog: { color: '#b8dcef', density: .0019 },
        water: { deep: '#0b4a78', shallow: '#1a8ab8', foam: '#dff7ff', sky: '#5fa4d8', level: 0, amplitude: .5 },
        mountains: { rings: [
            { radius: 1700, height: 380, color: '#7f9cc6', color2: '#9fb9dc', count: 40, snow: '#f2f7ff' },
            { radius: 1150, height: 210, color: '#4f7a5a', color2: '#6c9970', count: 58 }
        ] },
        clouds: { count: 30, color: '#ffffff', shadow: '#d4e3f5', height: 210 },
        exposure: 1.08, contrast: 1.14
    }
};
