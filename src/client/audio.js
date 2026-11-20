// Sound of VectorWings without audio files: effects are rendered once into buffers, the engine is a filtered drone,
// the music a small step sequencer (lead, bass, pad, drums) with an own theme per situation.
const RATE = 24000;

function layer(from, to, seconds, level, shape = 'sine', delay = 0) { return { from, to, seconds, level, shape, delay }; }

const EFFECTS = {
    laser: [layer(1500, 300, .1, .22, 'pulse'), layer(650, 110, .14, .3)],
    twin: [layer(1250, 250, .11, .24, 'pulse'), layer(1650, 300, .1, .15, 'pulse', .012), layer(600, 95, .15, .32)],
    hyper: [layer(2200, 420, .12, .2, 'pulse'), layer(900, 160, .18, .34, 'buzz'), layer(5200, 900, .08, .2, 'air')],
    enemy: [layer(520, 190, .16, .26, 'buzz')],
    hit: [layer(1000, 330, .08, .2, 'metal'), layer(2400, 420, .08, .3, 'air')],
    armor: [layer(760, 640, .12, .2, 'metal'), layer(1800, 600, .06, .2, 'air')],
    kill: [layer(880, 1320, .09, .2), layer(1320, 1760, .12, .18, 'sine', .07)],
    explode: [layer(190, 40, .38, .55), layer(4200, 90, .45, .8, 'air')],
    explodeBig: [layer(140, 28, .9, .7), layer(2600, 60, 1.1, .9, 'air'), layer(1200, 70, .5, .55, 'air', .18)],
    blast: [layer(110, 22, 1.5, .8), layer(5000, 50, 1.6, .95, 'air'), layer(300, 40, .9, .5, 'buzz', .05)],
    bombLaunch: [layer(300, 900, .35, .35, 'buzz'), layer(1800, 400, .4, .3, 'air')],
    reflect: [layer(420, 1500, .15, .3, 'metal'), layer(260, 640, .12, .18)],
    damage: [layer(240, 50, .3, .55, 'buzz'), layer(3200, 160, .25, .6, 'air')],
    scrape: [layer(3000, 800, .35, .45, 'air'), layer(180, 90, .3, .3, 'metal')],
    pickup: [layer(660, 680, .1, .3), layer(990, 1000, .14, .28, 'sine', .07), layer(1320, 1330, .2, .25, 'sine', .14)],
    ring: [layer(1047, 1047, .12, .25), layer(1319, 1319, .14, .22, 'sine', .06), layer(1568, 1568, .22, .22, 'sine', .12), layer(2093, 2093, .3, .18, 'sine', .18)],
    roll: [layer(380, 2200, .2, .4, 'air'), layer(2200, 260, .3, .35, 'air', .16)],
    loop: [layer(200, 900, .9, .3, 'air'), layer(140, 220, .9, .25, 'buzz')],
    charge: [layer(300, 1200, .7, .18, 'pulse')],
    charged: [layer(1760, 1760, .08, .2), layer(2349, 2349, .12, .2, 'sine', .06)],
    chargeShot: [layer(900, 180, .4, .45, 'buzz'), layer(3000, 300, .35, .4, 'air')],
    missile: [layer(600, 1400, .5, .25, 'air'), layer(220, 300, .5, .15, 'buzz')],
    warning: [layer(660, 660, .16, .25, 'pulse'), layer(880, 880, .16, .25, 'pulse', .2)],
    alarm: [layer(440, 660, .35, .3, 'pulse'), layer(440, 660, .35, .3, 'pulse', .5), layer(440, 660, .35, .3, 'pulse', 1.0), layer(440, 660, .35, .3, 'pulse', 1.5)],
    pop: [layer(900, 200, .2, .4, 'metal'), layer(3000, 400, .2, .5, 'air')],
    ram: [layer(200, 80, .3, .5, 'buzz'), layer(4000, 300, .3, .6, 'air')],
    respawn: [layer(440, 880, .4, .25), layer(660, 1320, .4, .2, 'sine', .1)],
    empty: [layer(220, 200, .08, .25, 'buzz')],
    go: [layer(880, 880, .12, .3, 'pulse'), layer(1760, 1760, .4, .3, 'pulse', .14)],
    click: [layer(1200, 900, .04, .2)],
    select: [layer(660, 990, .08, .2), layer(990, 1320, .1, .18, 'sine', .05)]
};

function render(context, layers) {
    const duration = Math.max(...layers.map(l => l.delay + l.seconds));
    const buffer = context.createBuffer(1, Math.ceil(duration * RATE) + 1, RATE);
    const pcm = buffer.getChannelData(0);
    let seed = 0x2c9277b5;
    for (const { from, to, seconds, level, shape, delay } of layers) {
        const offset = Math.round(delay * RATE);
        const count = Math.min(Math.round(seconds * RATE), pcm.length - offset);
        let phase = 0, noise = 0, hz = from;
        const sweep = Math.pow(to / from, 1 / count);
        for (let i = 0; i < count; i++) {
            const t = i / count;
            phase += 2 * Math.PI * hz / RATE;
            let value;
            if (shape === 'air') {
                seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                noise += (seed / 2147483648 - 1 - noise) * (1 - Math.exp(-2 * Math.PI * hz / RATE));
                value = noise * 2.1;
            } else if (shape === 'metal') value = .6 * Math.sin(phase) + .4 * Math.sin(phase * 2.713);
            else if (shape === 'pulse') value = .68 * Math.sin(phase) + .24 * Math.sin(phase * 3) + .08 * Math.sin(phase * 5);
            else if (shape === 'buzz') value = .66 * Math.sin(phase) + .23 * Math.sin(phase * 2) + .11 * Math.sin(phase * 3);
            else value = Math.sin(phase);
            const attack = Math.min(1, i / (RATE * .004));
            pcm[offset + i] += value * level * attack * (1 - t) * (1 - t);
            hz *= sweep;
        }
    }
    for (let i = 0; i < pcm.length; i++) pcm[i] = .96 * Math.tanh(pcm[i] / .96);
    return buffer;
}

// ─── Music ─────────────────────────────────────────────────────────────────────────
const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const midi = name => { const m = /^([A-G]#?)(\d)$/.exec(name); return m ? 12 * (Number(m[2]) + 1) + NOTE[m[1]] : null; };
const hz = n => 440 * Math.pow(2, (n - 69) / 12);
const bars = text => text.trim().split(/\s+/).map(token => token === '.' ? null : token === '-' ? '-' : midi(token));

const SONGS = {
    stage: {
        tempo: 138,
        chords: [['D3', 'F#3', 'A3'], ['B2', 'D3', 'F#3'], ['G2', 'B2', 'D3'], ['A2', 'C#3', 'E3']],
        bass: bars('D2 . D3 . D2 D2 . D3 B1 . B2 . B1 B1 . B2 G1 . G2 . G1 G1 . G2 A1 . A2 . A1 A1 C#2 E2'),
        lead: bars(`D5 - - A4 D5 - E5 F#5 - - E5 - D5 - C#5 - B4 - - F#4 B4 - C#5 D5 - - C#5 - B4 - A4 -
                    G4 - B4 - D5 - G5 - F#5 - - E5 - - D5 - E5 - - - A4 - C#5 - E5 - - - A5 - - -`),
        drums: 'K.h.S.h.K.hKS.hh',
        lead2: bars(`F#5 - - D5 F#5 - G5 A5 - - G5 - F#5 - E5 - D5 - - B4 D5 - E5 F#5 - - E5 - D5 - C#5 -
                     B4 - D5 - G5 - B5 - A5 - - G5 - - F#5 - E5 - - - C#5 - E5 - A5 - - - - - - -`)
    },
    boss: {
        tempo: 156,
        chords: [['E3', 'G3', 'B3'], ['C3', 'E3', 'G3'], ['D3', 'F#3', 'A3'], ['B2', 'D#3', 'F#3']],
        bass: bars('E2 E2 E3 E2 E2 E3 E2 E3 C2 C2 C3 C2 C2 C3 C2 C3 D2 D2 D3 D2 D2 D3 D2 D3 B1 B1 B2 B1 D#2 F#2 B2 D#3'),
        lead: bars(`E5 - B4 - E5 - F#5 G5 - - F#5 - E5 - D5 - C5 - - E5 G5 - C6 - B5 - G5 - E5 - - -
                    D5 - F#5 - A5 - - G5 F#5 - - E5 D5 - - - D#5 - F#5 - B5 - - A5 G5 - F#5 - D#5 - - -`),
        drums: 'K.hSK.hSKKhS.hSh'
    },
    arena: {
        tempo: 146,
        chords: [['A2', 'C3', 'E3'], ['F2', 'A2', 'C3'], ['G2', 'B2', 'D3'], ['E2', 'G#2', 'B2']],
        bass: bars('A1 . A2 A1 . A2 C2 E2 F1 . F2 F1 . F2 A1 C2 G1 . G2 G1 . G2 B1 D2 E1 . E2 E1 G#1 B1 E2 G#2'),
        lead: bars(`A4 - C5 E5 - D5 C5 - A4 - - G4 A4 - - - F4 - A4 C5 - D5 E5 - F5 - E5 - D5 - C5 -
                    D5 - - B4 G4 - B4 D5 G5 - F5 - E5 - D5 - E5 - - - B4 - - G#4 E5 - - - - - - -`),
        drums: 'K.hSK.hSK.hSKKhS'
    },
    menu: {
        tempo: 96,
        chords: [['D3', 'F#3', 'A3', 'C#4'], ['B2', 'D3', 'F#3', 'A3'], ['G2', 'B2', 'D3', 'F#3'], ['A2', 'C#3', 'E3', 'G3']],
        bass: bars('D2 . . . . . . . . . . . A2 . . . B1 . . . . . . . . . . . F#2 . . . G1 . . . . . . . . . . . D2 . . . A1 . . . . . . . E2 . . . A2 . . .'),
        lead: bars(`F#5 - - - E5 - - - D5 - - - A4 - - - D5 - - - C#5 - - - B4 - - - F#4 - - -
                    B4 - - - A4 - - - G4 - - - D5 - - - E5 - - - - - - - - - - - - - - -`),
        drums: '................'
    },
    clear: {
        tempo: 132, once: true,
        chords: [['D3', 'F#3', 'A3'], ['D3', 'F#3', 'A3']],
        bass: bars('D2 . . . A2 . . . D2 . . . . . . . D2 - - - - - - - - - - - - - - -'),
        lead: bars('A4 - D5 - F#5 - A5 - - - F#5 - A5 - - - D6 - - - - - - - - - - - - - - -'),
        drums: 'K...S...K.K.S...'
    }
};

class Music {
    constructor(context, output) {
        this.context = context;
        this.output = output;
        this.song = null;
        this.timer = null;
        const noise = this.noise = context.createBuffer(1, context.sampleRate * .5, context.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }

    play(name) {
        if (this.name === name) return;
        this.stop();
        const song = SONGS[name];
        if (!song) return;
        this.name = name;
        this.song = song;
        this.step = 0;
        this.next = this.context.currentTime + .08;
        this.timer = setInterval(() => this.schedule(), 25);
    }

    stop() {
        clearInterval(this.timer);
        this.timer = null;
        this.name = null;
        for (const voice of this.voices ?? []) try { voice.stop(); } catch { /* already ended */ }
        this.voices = [];
    }

    schedule() {
        const song = this.song, ctx = this.context;
        const stepTime = 60 / song.tempo / 4;
        while (this.next < ctx.currentTime + .15) {
            const step = this.step, time = this.next;
            const length = song.lead.length;
            if (song.once && step >= length) { this.stop(); return; }
            const bar = Math.floor(step / 16) % song.chords.length;
            const lead = (song.lead2 && Math.floor(step / length) % 2 === 1 ? song.lead2 : song.lead);
            const note = lead[step % length];
            if (typeof note === 'number') {
                let hold = 1;
                while (lead[(step + hold) % length] === '-' && hold < 16) hold++;
                this.voice(hz(note), time, hold * stepTime * .95, 'square', .05, 2600);
                this.voice(hz(note) * 1.005, time, hold * stepTime * .95, 'sawtooth', .025, 1800);
            }
            const bass = song.bass[step % song.bass.length];
            if (typeof bass === 'number') this.voice(hz(bass), time, stepTime * 1.8, 'sawtooth', .07, 520);
            if (step % 16 === 0) for (const name of song.chords[bar]) this.voice(hz(midi(name)), time, stepTime * 15.5, 'sawtooth', .018, 900, .25);
            const drum = song.drums[step % 16];
            if (drum === 'K') this.kick(time);
            else if (drum === 'S') this.snare(time);
            else if (drum === 'h') this.hat(time);
            this.step++;
            this.next += stepTime;
        }
    }

    voice(frequency, time, duration, type, level, cutoff, attack = .01) {
        const ctx = this.context;
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = frequency;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = cutoff;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(level, time + attack);
        gain.gain.setTargetAtTime(level * .6, time + attack, duration * .4);
        gain.gain.setTargetAtTime(0, time + duration, .05);
        osc.connect(filter).connect(gain).connect(this.output);
        osc.start(time);
        osc.stop(time + duration + .3);
    }

    kick(time) {
        const ctx = this.context;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.setValueAtTime(150, time);
        osc.frequency.exponentialRampToValueAtTime(42, time + .14);
        gain.gain.setValueAtTime(.32, time);
        gain.gain.exponentialRampToValueAtTime(.001, time + .22);
        osc.connect(gain).connect(this.output);
        osc.start(time);
        osc.stop(time + .25);
    }

    noiseHit(time, level, frequency, decay, type = 'bandpass') {
        const ctx = this.context;
        const source = ctx.createBufferSource();
        source.buffer = this.noise;
        const filter = ctx.createBiquadFilter();
        filter.type = type;
        filter.frequency.value = frequency;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(level, time);
        gain.gain.exponentialRampToValueAtTime(.001, time + decay);
        source.connect(filter).connect(gain).connect(this.output);
        source.start(time);
        source.stop(time + decay + .02);
    }

    snare(time) { this.noiseHit(time, .16, 1800, .16); this.noiseHit(time, .06, 200, .08, 'lowpass'); }
    hat(time) { this.noiseHit(time, .045, 8000, .04, 'highpass'); }
}

export class Audio {
    constructor() {
        this.context = null;
        this.buffers = new Map();
        this.volume = Number(localStorage.getItem('vectorwings.volume') ?? .7);
        this.musicVolume = Number(localStorage.getItem('vectorwings.music') ?? .55);
        this.muted = localStorage.getItem('vectorwings.muted') === '1';
        this.pending = null;
        this.lastPlayed = new Map();
    }

    unlock() {
        if (!this.context) {
            const Context = window.AudioContext || window.webkitAudioContext;
            if (!Context) return;
            const ctx = this.context = new Context();
            this.master = ctx.createGain();
            this.master.connect(ctx.destination);
            this.sfx = ctx.createGain();
            this.sfx.connect(this.master);
            this.musicGain = ctx.createGain();
            this.musicGain.connect(this.master);
            this.musicPlayer = new Music(ctx, this.musicGain);
            this.updateVolume();
            if (this.pending) { this.musicPlayer.play(this.pending); this.pending = null; }
        }
        if (this.context.state === 'suspended') void this.context.resume();
    }

    updateVolume() {
        if (!this.context) return;
        this.master.gain.value = this.muted ? 0 : 1;
        this.sfx.gain.value = this.volume;
        this.musicGain.gain.value = this.musicVolume * .8;
        localStorage.setItem('vectorwings.volume', String(this.volume));
        localStorage.setItem('vectorwings.music', String(this.musicVolume));
        localStorage.setItem('vectorwings.muted', this.muted ? '1' : '0');
    }

    play(name, level = 1) {
        const ctx = this.context;
        if (!ctx || this.muted || !EFFECTS[name]) return;
        const now = ctx.currentTime;
        if (now - (this.lastPlayed.get(name) ?? -1) < .035) return;
        this.lastPlayed.set(name, now);
        let buffer = this.buffers.get(name);
        if (!buffer) { buffer = render(ctx, EFFECTS[name]); this.buffers.set(name, buffer); }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const gain = ctx.createGain();
        gain.gain.value = level;
        source.connect(gain).connect(this.sfx);
        source.start();
    }

    music(name) {
        if (!this.context) { this.pending = name; return; }
        this.musicPlayer.play(name);
    }

    stopMusic() { this.musicPlayer?.stop(); }

    /** Engine drone: state 0 cruise, 1 boost, -1 brake, null silent. */
    engine(state) {
        const ctx = this.context;
        if (!ctx) return;
        if (!this.engineOsc) {
            const osc = this.engineOsc = ctx.createOscillator();
            osc.type = 'sawtooth';
            const noise = ctx.createBufferSource();
            const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
            noise.buffer = buffer;
            noise.loop = true;
            const filter = this.engineFilter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            const gain = this.engineGain = ctx.createGain();
            gain.gain.value = 0;
            const noiseGain = ctx.createGain();
            noiseGain.gain.value = .5;
            osc.connect(filter);
            noise.connect(noiseGain).connect(filter);
            filter.connect(gain).connect(this.sfx);
            osc.start();
            noise.start();
        }
        const now = ctx.currentTime;
        const level = state === null ? 0 : state > 0 ? .09 : .05;
        this.engineGain.gain.setTargetAtTime(level, now, .15);
        this.engineOsc.frequency.setTargetAtTime(state > 0 ? 92 : state < 0 ? 48 : 64, now, .2);
        this.engineFilter.frequency.setTargetAtTime(state > 0 ? 1400 : state < 0 ? 380 : 650, now, .2);
    }
}
