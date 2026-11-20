// The flight instruments (DOM over the canvas): pilot card, wing, score, boss bar, radio, reticles, title cards, radar.
export const SLOT_CREW = ['mira', 'brakk', 'sola', 'pip'];
export const CREW = {
    mira: { name: 'Mira', role: 'Staffelführerin', image: 'img/crew/mira.svg' },
    brakk: { name: 'Brakk', role: 'Schütze', image: 'img/crew/brakk.svg' },
    sola: { name: 'Sola', role: 'Aufklärerin', image: 'img/crew/sola.svg' },
    pip: { name: 'Pip', role: 'Navigator', image: 'img/crew/pip.svg' },
    rico: { name: 'Rico', role: 'Waschbär', image: 'img/crew/rico.svg' },
    penny: { name: 'Penny', role: 'Pinguin', image: 'img/crew/penny.svg' },
    bo: { name: 'Bo', role: 'Bär', image: 'img/crew/bo.svg' },
    nima: { name: 'Nima', role: 'Roter Panda', image: 'img/crew/nima.svg' }
};
export const AVATARS = Object.keys(CREW);
export const avatarOf = (pilot, slot) => CREW[pilot?.avatar] ? pilot.avatar : SLOT_CREW[(slot ?? pilot?.slot ?? 0) % 4];
const $ = id => document.getElementById(id);

export class Hud {
    constructor() {
        this.root = $('hud');
        this.comms = [];
        this.commUntil = 0;
        this.typing = null;
        this.cache = new Map();
        this.wingCards = new Map();
        this.radarDots = new Map();
        this.cardTimer = null;
    }

    set(id, value, prop = 'textContent') {
        const key = id + prop;
        if (this.cache.get(key) === value) return;
        this.cache.set(key, value);
        const element = typeof id === 'string' ? $(id) : id;
        if (prop === 'width') element.style.width = value;
        else if (prop === 'hidden') element.hidden = value;
        else element[prop] = value;
    }

    show(on, mode = 'Campaign') {
        this.root.hidden = !on;
        this.root.dataset.mode = mode;
        if (!on) { this.comms = []; $('comm').hidden = true; this.letterbox(false); $('card').hidden = true; }
    }

    pilot(p) {
        $('hud-portrait').style.backgroundImage = `url(${CREW[p.crew]?.image ?? CREW.mira.image})`;
        this.set('hud-lives', '×' + Math.max(0, p.lives));
        this.set('hud-lives', p.arena, 'hidden');
        const ratio = Math.max(0, Math.min(1, p.shield / p.max));
        this.set('hud-shield', (ratio * 100).toFixed(1) + '%', 'width');
        $('hud-shield').parentElement.classList.toggle('low', ratio < .3);
        this.set('hud-bombs', '◆'.repeat(Math.min(9, p.bombs)) || '–');
        this.set('hud-laser', ['', 'LASER', 'DOPPELLASER', 'HYPERLASER'][p.laser] ?? 'LASER');
        this.set('hud-score', String(Math.max(0, p.score)).padStart(6, '0'));
        this.set('hud-hits', String(p.hits).padStart(3, '0'));
        this.set('hud-meter', (p.meter * 100).toFixed(0) + '%', 'width');
        $('hud-meter').parentElement.classList.toggle('hot', !!p.overheat);
        $('hud-meter').parentElement.classList.toggle('boost', !!p.boosting);
        this.set('hud-charge', (p.charge * 100).toFixed(0) + '%', 'width');
        $('hud-charge').parentElement.hidden = !p.charge;
        $('hud-cores').hidden = !p.arena || p.mode !== 'Battle';
        if (p.arena && p.mode === 'Battle') this.set('hud-cores', '●'.repeat(Math.max(0, p.cores)) + '○'.repeat(Math.max(0, 3 - p.cores)));
    }

    wing(list) {
        const container = $('hud-wing');
        for (const [slot, card] of this.wingCards) if (!list.some(p => p.slot === slot)) { card.remove(); this.wingCards.delete(slot); }
        for (const p of list) {
            let card = this.wingCards.get(p.slot);
            if (!card) {
                card = document.createElement('div');
                card.className = 'wing-card';
                card.innerHTML = '<i class="portrait"></i><div><b></b><span class="bar"><i></i></span></div>';
                card.querySelector('.portrait').style.backgroundImage = `url(${CREW[p.crew].image})`;
                container.append(card);
                this.wingCards.set(p.slot, card);
            }
            const label = card.querySelector('b');
            const text = p.name + (p.alive ? '' : p.out ? ' · raus' : ' · Reparatur');
            if (label.textContent !== text) label.textContent = text;
            card.querySelector('.bar i').style.width = Math.max(0, p.ratio * 100) + '%';
            card.classList.toggle('down', !p.alive);
            card.classList.toggle('low', p.ratio < .3);
        }
    }

    boss(name, ratio, visible, phase) {
        $('hud-boss').hidden = !visible;
        if (!visible) return;
        this.set('boss-name', name);
        this.set('boss-bar', (Math.max(0, ratio) * 100).toFixed(1) + '%', 'width');
        this.set('boss-phase', phase ?? '');
    }

    timer(text) {
        this.set('hud-timer', text ?? '');
        this.set('hud-timer', !text, 'hidden');
    }

    /** Radio message (speaker key from CREW). Messages queue; each stays ~3.6 s. */
    comm(speaker, text, priority = false) {
        if (priority) this.comms.unshift([speaker, text]);
        else if (this.comms.length < 4) this.comms.push([speaker, text]);
    }

    updateComm(now) {
        const box = $('comm');
        if (now < this.commUntil) return;
        const next = this.comms.shift();
        if (!next) { box.hidden = true; return; }
        const [speaker, text] = next;
        const crew = CREW[speaker] ?? CREW.mira;
        box.hidden = false;
        $('comm-portrait').style.backgroundImage = `url(${crew.image})`;
        $('comm-name').textContent = crew.name;
        const line = $('comm-text');
        line.textContent = '';
        clearInterval(this.typing);
        let i = 0;
        this.typing = setInterval(() => {
            line.textContent = text.slice(0, ++i);
            if (i >= text.length) clearInterval(this.typing);
        }, 18);
        box.classList.remove('pop');
        void box.offsetWidth;
        box.classList.add('pop');
        this.commUntil = now + Math.max(2.8, text.length * .055);
    }

    /** Big title card in the middle: style 'mission' | 'warning' | 'clear' | 'fail' | 'count'. */
    card(title, subtitle = '', style = 'mission', seconds = 3) {
        const card = $('card');
        card.dataset.style = style;
        $('card-title').textContent = title;
        $('card-sub').textContent = subtitle;
        card.hidden = false;
        card.classList.remove('in');
        void card.offsetWidth;
        card.classList.add('in');
        clearTimeout(this.cardTimer);
        this.cardTimer = setTimeout(() => { card.hidden = true; }, seconds * 1000);
    }

    letterbox(on) {
        document.body.classList.toggle('letterbox', on);
    }

    reticles(near, far, lock, visible) {
        const n = $('reticle-near'), f = $('reticle-far'), l = $('lock');
        n.hidden = f.hidden = !visible || !near.visible;
        if (visible && near.visible) {
            n.style.transform = `translate(${near.x}px, ${near.y}px)`;
            f.style.transform = `translate(${far.x}px, ${far.y}px)`;
        }
        l.hidden = !lock;
        if (lock) l.style.transform = `translate(${lock.x}px, ${lock.y}px)`;
    }

    feedback(kind) {
        const n = $('reticle-far');
        n.dataset.feedback = kind;
        clearTimeout(this.feedbackTimer);
        this.feedbackTimer = setTimeout(() => { n.dataset.feedback = ''; }, 120);
    }

    popup(x, y, text, color = '#ffe08a') {
        const node = document.createElement('div');
        node.className = 'popup';
        node.textContent = text;
        node.style.left = x + 'px';
        node.style.top = y + 'px';
        node.style.color = color;
        $('popups').append(node);
        setTimeout(() => node.remove(), 900);
    }

    damage(strength = 1) {
        const d = $('damage');
        d.style.opacity = String(Math.min(1, .45 + strength * .4));
        clearTimeout(this.damageTimer);
        this.damageTimer = setTimeout(() => { d.style.opacity = '0'; }, 90);
    }

    radar(contacts, visible) {
        const dial = $('radar');
        dial.hidden = !visible;
        if (!visible) return;
        for (const [id, dot] of this.radarDots) if (!contacts.some(c => c.id === id)) { dot.remove(); this.radarDots.delete(id); }
        for (const c of contacts) {
            let dot = this.radarDots.get(c.id);
            if (!dot) { dot = document.createElement('i'); dial.append(dot); this.radarDots.set(c.id, dot); }
            dot.style.left = (50 + c.x * 44) + '%';
            dot.style.top = (50 - c.y * 44) + '%';
            dot.style.background = c.color;
            dot.className = c.kind ?? '';
        }
    }

    tags(list) {
        const container = $('tags');
        container.replaceChildren(...list.map(t => {
            const node = document.createElement('span');
            node.textContent = t.text;
            node.style.transform = `translate(${t.x}px, ${t.y}px)`;
            node.style.borderColor = t.color;
            return node;
        }));
    }
}
