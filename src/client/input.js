// Keyboard, gamepad and touch → one input sample per frame.
// Held: x, y, fire, charge, boost, brake, tilt.  Pulses (true for one sample): roll, bomb, loop, camera, pause.
const KEYS = {
    left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'],
    fire: ['Space', 'KeyJ'], charge: ['KeyF', 'KeyK'], bomb: ['KeyB', 'KeyL', 'KeyX'], boost: ['ShiftLeft', 'ShiftRight'],
    brake: ['ControlLeft', 'ControlRight', 'AltLeft'], rollLeft: ['KeyQ'], rollRight: ['KeyE'], loop: ['KeyR', 'KeyI'],
    camera: ['KeyC'], pause: ['Escape', 'KeyP']
};
const ALL = new Set(Object.values(KEYS).flat());
const TAP = .22;

export class Input {
    constructor() {
        this.keys = new Set();
        this.pulses = new Set();
        this.enabled = false;
        this.invertY = localStorage.getItem('vectorwings.invert') === '1';
        this.rollHeld = { left: 0, right: 0 };
        this.padPrevious = [];
        this.touch = installTouch(this);
        this.mouse = installMouse(this);
        addEventListener('keydown', event => {
            if (!this.enabled || !ALL.has(event.code)) return;
            if (event.target?.closest?.('input,textarea,select')) return;
            event.preventDefault();
            if (event.repeat) return;
            this.keys.add(event.code);
            for (const action of ['bomb', 'loop', 'camera', 'pause']) if (KEYS[action].includes(event.code)) this.pulses.add(action);
        });
        addEventListener('keyup', event => {
            if (!ALL.has(event.code)) return;
            this.keys.delete(event.code);
        });
        addEventListener('blur', () => this.reset());
        document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });
    }

    reset() {
        this.mouse?.reset();
        this.keys.clear();
        this.pulses.clear();
        this.touch.reset();
    }

    held(action) {
        return KEYS[action].some(key => this.keys.has(key));
    }

    pad() {
        try { return [...(navigator.getGamepads?.() ?? [])].find(Boolean) ?? null; }
        catch { return null; }
    }

    sample(dt) {
        const pad = this.pad();
        const axis = i => { const v = pad?.axes[i] ?? 0; return Math.abs(v) < .16 ? 0 : v; };
        const button = i => !!pad?.buttons[i]?.pressed;
        const pressed = i => button(i) && !this.padPrevious[i];
        const touch = this.touch, mouse = this.mouse;
        let x = (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0) || touch.x || axis(0) || (button(15) ? 1 : 0) - (button(14) ? 1 : 0) || mouse.x;
        let y = (this.held('up') ? 1 : 0) - (this.held('down') ? 1 : 0) || touch.y || -axis(1) || (button(12) ? 1 : 0) - (button(13) ? 1 : 0) || mouse.y;
        if (this.invertY) y = -y;
        const out = {
            x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)),
            fire: this.held('fire') || button(0) || touch.held('fire') || mouse.left,
            charge: this.held('charge') || button(2) || touch.held('charge') || mouse.right,
            boost: this.held('boost') || button(5) || touch.held('boost'),
            brake: this.held('brake') || button(4) || touch.held('brake'),
            bomb: this.pulses.has('bomb') || pressed(1) || touch.pulse('bomb') || mouse.take('bomb'),
            loop: this.pulses.has('loop') || pressed(3) || touch.pulse('loop'),
            camera: this.pulses.has('camera') || pressed(8),
            pause: this.pulses.has('pause') || pressed(9),
            tilt: 0, roll: 0
        };
        // Roll keys: a short tap is a barrel roll, holding tilts the ship.
        const left = this.held('rollLeft') || button(6), right = this.held('rollRight') || button(7);
        for (const [side, down, sign] of [['left', left, -1], ['right', right, 1]]) {
            if (down) {
                this.rollHeld[side] += dt;
                if (this.rollHeld[side] > TAP) out.tilt = sign;
            } else {
                if (this.rollHeld[side] > 0 && this.rollHeld[side] <= TAP) out.roll = sign;
                this.rollHeld[side] = 0;
            }
        }
        const wheel = mouse.take('rollLeft') ? -1 : mouse.take('rollRight') ? 1 : 0;
        if (wheel) out.roll = wheel;
        if (touch.pulse('roll')) out.roll = out.x < -.2 ? -1 : out.x > .2 ? 1 : (this.lastRoll = -(this.lastRoll || 1));
        this.padPrevious = pad ? pad.buttons.map(b => b.pressed) : [];
        this.pulses.clear();
        touch.sampled();
        return out;
    }

    setInvert(value) {
        this.invertY = value;
        localStorage.setItem('vectorwings.invert', value ? '1' : '0');
    }
}

function installTouch(input) {
    const stick = document.getElementById('stick');
    const buttons = [...document.querySelectorAll('[data-action]')];
    const held = new Map(), pulses = new Set();
    let pointer = null, bounds = null;
    const state = {
        x: 0, y: 0,
        held: action => [...held.values()].includes(action),
        pulse: action => pulses.has(action),
        sampled: () => pulses.clear(),
        reset() { center(); held.clear(); pulses.clear(); buttons.forEach(b => b.classList.remove('held')); }
    };
    function center() {
        pointer = null;
        state.x = state.y = 0;
        if (stick) stick.firstElementChild.style.transform = '';
    }
    if (!stick) return state;
    function steer(event) {
        if (pointer !== event.pointerId) return;
        const radius = bounds.width * .38;
        const dx = (event.clientX - bounds.left - bounds.width / 2) / radius;
        const dy = (event.clientY - bounds.top - bounds.height / 2) / radius;
        const limit = Math.max(1, Math.hypot(dx, dy));
        state.x = dx / limit;
        state.y = -dy / limit;
        stick.firstElementChild.style.transform = `translate(${state.x * radius}px, ${-state.y * radius}px)`;
    }
    stick.addEventListener('pointerdown', event => {
        if (pointer !== null) return;
        event.preventDefault();
        pointer = event.pointerId;
        bounds = stick.getBoundingClientRect();
        stick.setPointerCapture(pointer);
        steer(event);
    });
    stick.addEventListener('pointermove', steer);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
        stick.addEventListener(type, event => { if (pointer === event.pointerId) center(); });
    for (const button of buttons) {
        const action = button.dataset.action;
        button.addEventListener('pointerdown', event => {
            event.preventDefault();
            button.setPointerCapture(event.pointerId);
            held.set(event.pointerId, action);
            pulses.add(action);
            button.classList.add('held');
        });
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
            button.addEventListener(type, event => {
                held.delete(event.pointerId);
                button.classList.toggle('held', [...held.values()].includes(action));
            });
    }
    void input;
    return state;
}

/** Mouse in flight: the pointer's offset from the centre is the stick, left fires, right charges, wheel click bombs, wheel rolls. */
function installMouse(input) {
    const canvas = document.getElementById('flight');
    const marker = document.getElementById('mouse-aim');
    const pulses = new Set();
    const state = {
        x: 0, y: 0, left: false, right: false, active: false,
        enabled: localStorage.getItem('vectorwings.mouse') !== '0',
        take(name) { const had = pulses.has(name); pulses.delete(name); return had; },
        reset() { state.left = state.right = false; state.x = state.y = 0; pulses.clear(); state.active = false; show(); }
    };
    function show() {
        const on = state.enabled && state.active && input.enabled;
        document.body.classList.toggle('mouse-flight', on);
        if (marker) marker.hidden = !on;
    }
    function move(event) {
        if (event.pointerType !== 'mouse' || !input.enabled || !state.enabled) return;
        const rect = canvas.getBoundingClientRect();
        const reach = Math.min(rect.width, rect.height) * .34;
        const x = (event.clientX - rect.left - rect.width / 2) / reach, y = -(event.clientY - rect.top - rect.height / 2) / reach;
        const length = Math.hypot(x, y);
        const dead = .07;
        const k = length < dead ? 0 : Math.min(1, (length - dead) / (1 - dead)) / (length || 1);
        state.x = x * k;
        state.y = y * k;
        state.active = true;
        if (marker) marker.style.transform = 'translate(' + event.clientX + 'px, ' + event.clientY + 'px)';
        show();
    }
    addEventListener('pointermove', move);
    canvas.addEventListener('pointerdown', event => {
        if (event.pointerType !== 'mouse' || !input.enabled || !state.enabled) return;
        event.preventDefault();
        move(event);
        if (event.button === 0) state.left = true;
        if (event.button === 2) state.right = true;
        if (event.button === 1) pulses.add('bomb');
    });
    addEventListener('pointerup', event => {
        if (event.pointerType !== 'mouse') return;
        if (event.button === 0) state.left = false;
        if (event.button === 2) state.right = false;
    });
    canvas.addEventListener('contextmenu', event => { if (input.enabled) event.preventDefault(); });
    canvas.addEventListener('auxclick', event => { if (input.enabled) event.preventDefault(); });
    canvas.addEventListener('wheel', event => {
        if (!input.enabled || !state.enabled) return;
        event.preventDefault();
        pulses.add(event.deltaY < 0 ? 'rollLeft' : 'rollRight');
    }, { passive: false });
    setInterval(show, 300);
    return state;
}
