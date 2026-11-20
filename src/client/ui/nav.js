// Menu navigation like a console game: arrow keys / WASD / d-pad / stick move a focus cursor over [data-nav] items,
// Enter / Space / A activate, Escape / Backspace / B go back. Mouse and touch keep working (hover focuses, click activates).
const REPEAT_FIRST = .34, REPEAT_NEXT = .12;

export class Nav {
    constructor({ sound } = {}) {
        this.sound = sound ?? (() => {});
        this.root = null;
        this.current = null;
        this.handlers = {};
        this.enabled = true;
        this.held = null;
        this.holdTime = 0;
        this.padPrevious = [];
        this.lastDevice = 'keyboard';
        addEventListener('keydown', event => this.key(event), true);
        addEventListener('pointermove', event => {
            const item = event.target.closest?.('[data-nav]');
            if (item && this.root?.contains(item) && item !== this.current && !item.disabled) this.focus(item, false);
            if (this.lastDevice !== 'pointer') { this.lastDevice = 'pointer'; this.onDevice?.(this.lastDevice); }
        });
    }

    /** Activates a screen (or overlay): its items, optional handlers { back, move(dx, dy) → handled?, action, secondary }. */
    screen(root, handlers = {}, initial = null) {
        this.root = root;
        this.handlers = handlers;
        const items = this.items();
        const keep = initial ?? items.find(item => item.dataset.default !== undefined) ?? items[0] ?? null;
        this.focus(keep, false);
    }

    items() {
        if (!this.root) return [];
        return [...this.root.querySelectorAll('[data-nav]')].filter(item => !item.disabled && item.offsetParent !== null && !item.closest('[hidden]'));
    }

    focus(item, sound = true) {
        if (this.current === item) return;
        this.current?.classList.remove('focus');
        this.current = item;
        if (!item) return;
        item.classList.add('focus');
        if (document.activeElement && document.activeElement !== item && document.activeElement.matches?.('input,select')) document.activeElement.blur();
        if (item.matches('input,select')) item.focus({ preventScroll: true });
        item.scrollIntoView?.({ block: 'nearest' });
        if (sound) this.sound('move');
        this.handlers.focus?.(item);
    }

    key(event) {
        if (!this.enabled || !this.root) return;
        const typing = event.target.matches?.('input,select,textarea');
        const map = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0] };
        if (this.lastDevice !== 'keyboard') { this.lastDevice = 'keyboard'; this.onDevice?.(this.lastDevice); }
        if (typing && !['ArrowUp', 'ArrowDown', 'Escape', 'Enter'].includes(event.code) && !(event.code === 'Tab')) return;
        if (map[event.code] && !(typing && event.code.startsWith('Key'))) {
            event.preventDefault();
            event.stopPropagation();
            this.move(...map[event.code]);
        } else if ((event.code === 'Enter' || event.code === 'NumpadEnter' || (event.code === 'Space' && !typing))) {
            if (typing && event.target.form) return;
            event.preventDefault();
            event.stopPropagation();
            this.activate();
        } else if (event.code === 'Escape' || (event.code === 'Backspace' && !typing)) {
            event.preventDefault();
            event.stopPropagation();
            this.back();
        } else if (event.code === 'KeyY' || event.code === 'KeyT') {
            if (!typing && this.handlers.secondary) { event.preventDefault(); this.handlers.secondary(); }
        }
    }

    move(dx, dy) {
        if (this.handlers.move?.(dx, dy)) return;
        const items = this.items();
        if (!items.length) return;
        if (!this.current || !items.includes(this.current)) { this.focus(items[0]); return; }
        const from = this.current.getBoundingClientRect();
        const fx = from.left + from.width / 2, fy = from.top + from.height / 2;
        let best = null, bestScore = Infinity;
        for (const item of items) {
            if (item === this.current) continue;
            const r = item.getBoundingClientRect();
            const ix = r.left + r.width / 2, iy = r.top + r.height / 2;
            const along = dx ? (ix - fx) * dx : (iy - fy) * dy;
            if (along <= 4) continue;
            const across = dx ? Math.abs(iy - fy) : Math.abs(ix - fx);
            const score = along + across * 2.2;
            if (score < bestScore) { bestScore = score; best = item; }
        }
        if (!best && dy) {
            // wrap around in vertical lists
            const index = items.indexOf(this.current);
            best = items[(index + dy + items.length) % items.length];
        }
        if (best) this.focus(best);
    }

    activate() {
        if (this.handlers.action?.(this.current)) return;
        if (!this.current) return;
        this.sound('select');
        if (this.current.matches('input[type=checkbox]')) { this.current.checked = !this.current.checked; this.current.dispatchEvent(new Event('change', { bubbles: true })); return; }
        if (this.current.matches('input,select')) { this.current.form?.requestSubmit?.(); return; }
        this.current.click();
    }

    back() {
        if (this.handlers.back) { this.sound('back'); this.handlers.back(); }
    }

    /** Gamepad polling (call every frame while menus are open). */
    poll(dt) {
        let pad = null;
        try { pad = [...(navigator.getGamepads?.() ?? [])].find(Boolean) ?? null; } catch { pad = null; }
        if (!pad || !this.enabled) { this.padPrevious = []; return; }
        const pressed = i => !!pad.buttons[i]?.pressed;
        const edge = i => pressed(i) && !this.padPrevious[i];
        const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
        const direction = pressed(12) || ay < -.6 ? 'up' : pressed(13) || ay > .6 ? 'down' : pressed(14) || ax < -.6 ? 'left' : pressed(15) || ax > .6 ? 'right' : null;
        if (pad.buttons.some(b => b.pressed) || direction) {
            if (this.lastDevice !== 'gamepad') { this.lastDevice = 'gamepad'; this.onDevice?.(this.lastDevice); }
        }
        if (direction) {
            if (direction !== this.held) { this.held = direction; this.holdTime = -REPEAT_FIRST; this.moveBy(direction); }
            else {
                this.holdTime += dt;
                if (this.holdTime > 0) { this.holdTime -= REPEAT_NEXT; this.moveBy(direction); }
            }
        } else this.held = null;
        if (edge(0)) this.activate();
        if (edge(1)) this.back();
        if (edge(3) && this.handlers.secondary) this.handlers.secondary();
        this.padPrevious = pad.buttons.map(b => b.pressed);
    }

    moveBy(direction) {
        const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction];
        this.move(...d);
    }
}
