// VectorWings in the browser and in the app: game menus (controller navigation), the campaign map, MatGame connection
// (online / offline in the app), lobby, the match and the result tally.
import * as signalR from '@microsoft/signalr';
import { connect, host, LocalTransport, OnlineTransport, servers } from '../VectorWings.Module/wwwroot/matgame/index.js';
import { Stage } from './render/stage.js';
import { Effects } from './render/fx.js';
import { SHIPS } from './render/models.js';
import { Hud, CREW, SLOT_CREW } from './hud.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Game } from './game/game.js';
import { MenuScene } from './menu-scene.js';
import { Overworld } from './overworld.js';
import { Nav } from './ui/nav.js';
import { LEVELS } from './level.js';
import { LoopbackRoom } from './net/loopback.js';
import './worlds/all.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const GAME = 'vectorwings';
const MODE_NAMES = { Campaign: 'KAMPAGNE', Battle: 'KERNJAGD', Timed: 'TREFFER AUF ZEIT' };
const WORLD_NAMES = ['FLUSSTAL VON KASKADE', 'GLUTSCHLUCHT', 'GÜRTEL VON VEYRA', 'ALTGLANZ'];
const PROMPTS = {
    press: [['a', 'START']],
    pilot: [['a', 'WÄHLEN'], ['b', 'ZURÜCK']],
    main: [['ud', 'WÄHLEN'], ['a', 'OK'], ['b', 'ZURÜCK']],
    multi: [['a', 'BEITRETEN'], ['y', 'AKTUALISIEREN'], ['b', 'ZURÜCK']],
    map: [['lr', 'MISSION'], ['a', 'STARTEN'], ['y', 'CREW AN/AUS'], ['b', 'ZURÜCK']],
    hangar: [['lr', 'SCHIFF'], ['a', 'FLIEGEN'], ['b', 'ZURÜCK']],
    lobby: [['a', 'WÄHLEN'], ['b', 'VERLASSEN']],
    options: [['lr', 'ÄNDERN'], ['b', 'ZURÜCK']],
    help: [['b', 'ZURÜCK']]
};

class App {
    constructor() {
        const quality = params.get('quality') ?? localStorage.getItem('vectorwings.quality') ?? 'auto';
        this.stage = new Stage($('flight'), { quality });
        this.fx = new Effects(this.stage);
        this.hud = new Hud();
        this.input = new Input();
        this.audio = new Audio();
        this.nav = new Nav({ sound: kind => this.audio.play(kind === 'move' ? 'click' : kind === 'back' ? 'empty' : 'select', kind === 'move' ? .6 : 1) });
        this.nav.onDevice = () => this.prompts();
        this.ship = Number(localStorage.getItem('vectorwings.ship') ?? 0) % SHIPS.length;
        this.mission = Number(localStorage.getItem('vectorwings.mission') ?? 0) % 4;
        this.mode = 'Campaign';
        this.screen = null;
        this.hangarReturn = 'main';
        this.state = null;
        this.slot = -1;
        this.game = null;
        this.backdrop = null;
        this.progress = null;
        this.cleared = new Set(JSON.parse(localStorage.getItem('vectorwings.cleared') ?? '[]'));
        this.transport = null;
        this.needsPilot = false;
        this.generation = 0;
        this.busy = false;
        this.last = performance.now();
        document.body.classList.toggle('touch', matchMedia('(any-pointer: coarse)').matches || navigator.maxTouchPoints > 0);
        this.bind();
        this.settings();
        this.showShip(false);
        $('version').textContent = document.querySelector('meta[name=matgame-version]')?.content || 'dev';
        this.go('press');
        this.stage.engine.runRenderLoop(() => this.frame());
        window.__app = this;
    }

    frame() {
        const now = performance.now();
        const dt = Math.min(.05, (now - this.last) / 1000);
        this.last = now;
        if (this.game) this.game.tick(dt);
        else this.backdrop?.tick(dt);
        if (!this.game || !$('pause').hidden || !$('result').hidden) this.nav.poll(dt);
        if (this.screen === 'map' && this.backdrop instanceof Overworld && !this.game) this.placeBadges();
        this.fx.update(dt);
        this.stage.update(dt);
        const logic = performance.now();
        this.stage.scene.render();
        const done = performance.now();
        const perf = window.__perf ??= { logic: 0, render: 0, frame: 0 };
        perf.logic = perf.logic * .95 + (logic - now) * .05;
        perf.render = perf.render * .95 + (done - logic) * .05;
        perf.frame = perf.frame * .95 + dt * 1000 * .05;
        this.frames = (this.frames ?? 0) + 1;
        if (now - (this.fpsAt ?? 0) > 1000) { window.__fps = this.frames; this.frames = 0; this.fpsAt = now; }
    }

    notice(message = '') {
        $('notice').textContent = message;
        clearTimeout(this.noticeTimer);
        if (message) this.noticeTimer = setTimeout(() => { $('notice').textContent = ''; }, 5000);
    }

    async task(action) {
        if (this.busy) return;
        this.busy = true;
        this.notice();
        try { await action(); }
        catch (error) { console.error(error); this.notice(error.message ?? String(error)); }
        finally { this.busy = false; }
    }

    // ─── Backdrops ──────────────────────────────────────────────────────────────────

    useBackdrop(kind) {
        if (this.game) return;
        const want = kind === 'map' ? Overworld : MenuScene;
        if (!(this.backdrop instanceof want) || (kind === 'map' && this.backdrop.stale)) {
            this.backdrop?.dispose();
            this.fx.clear();
            if (kind === 'map') {
                this.backdrop = new Overworld(this.stage, { design: this.ship, unlocked: this.unlocked(), cleared: [...this.clearedMissions()],
                    medals: this.progress?.medals ?? [], selected: Math.min(this.mission, this.unlocked() - 1) });
                this.backdrop.onArrive = index => { this.selectMission(index); this.audio.play('ring', .5); };
                this.backdrop.onMove = () => this.audio.play('roll', .5);
                this.buildBadges();
            } else this.backdrop = new MenuScene(this.stage);
        }
        if (this.backdrop instanceof MenuScene) {
            if (kind === 'hangar') this.backdrop.showHangar(this.ship, this.slot >= 0 ? this.slot : 0);
            else this.backdrop.showFlight();
        }
    }

    clearedMissions() {
        return new Set([...(this.progress?.cleared ?? []), ...this.cleared]);
    }

    unlocked() {
        if ((params.has('preview') && !params.has('locked')) || params.has('unlock')) return 4;
        const cleared = this.clearedMissions();
        let open = 1;
        while (open < 4 && cleared.has(open - 1)) open++;
        return open;
    }

    // ─── Screens ────────────────────────────────────────────────────────────────────

    go(screen) {
        this.screen = screen;
        document.body.dataset.screen = screen;
        for (const section of document.querySelectorAll('.screen')) section.hidden = section.id !== 'screen-' + screen;
        this.useBackdrop(screen === 'map' ? 'map' : screen === 'hangar' ? 'hangar' : 'menu');
        const section = $('screen-' + screen);
        const handlers = { back: () => this.back(screen) };
        if (screen === 'press') handlers.back = null;
        if (screen === 'main') handlers.focus = item => { $('menu-info').textContent = item.dataset.info ?? ''; };
        if (screen === 'map') {
            handlers.move = (dx, dy) => {
                const direction = dx || dy;
                if (!(this.backdrop instanceof Overworld)) return true;
                if (!this.backdrop.step(direction > 0 ? 1 : -1)) {
                    const next = this.backdrop.index + (direction > 0 ? 1 : -1);
                    if (next >= this.backdrop.unlocked && next < 4) { this.audio.play('empty'); this.notice(`Gesperrt – schließe zuerst Mission ${next} ab.`); }
                } else this.selectMission(this.backdrop.route?.target ?? this.backdrop.index);
                return true;
            };
            handlers.action = item => {
                if (item?.id === 'bots') return false;
                void this.task(() => this.create('Campaign'));
                return true;
            };
            handlers.secondary = () => { $('bots').checked = !$('bots').checked; this.audio.play('click'); };
            this.selectMission(this.backdrop?.index ?? this.mission);
        }
        if (screen === 'hangar') {
            handlers.move = dx => {
                if (!dx) return false;
                this.ship = (this.ship + dx + SHIPS.length) % SHIPS.length;
                this.showShip();
                return true;
            };
        }
        if (screen === 'options') {
            handlers.move = dx => {
                const item = this.nav.current;
                if (!dx || !item) return false;
                if (item.type === 'range') { item.value = String(Number(item.value) + dx * 5); item.dispatchEvent(new Event('input')); return true; }
                if (item.tagName === 'SELECT') { item.selectedIndex = (item.selectedIndex + dx + item.options.length) % item.options.length; item.dispatchEvent(new Event('change')); return true; }
                return false;
            };
        }
        if (screen === 'multi') handlers.secondary = () => this.task(() => this.refresh());
        this.nav.screen(section, handlers);
        this.prompts();
    }

    back(screen) {
        switch (screen) {
            case 'pilot': this.go('press'); break;
            case 'main': this.go('press'); break;
            case 'hangar': this.go(this.state?.state === 'Lobby' ? 'lobby' : this.hangarReturn); break;
            case 'lobby': void this.task(() => this.leave()); break;
            default: this.go('main');
        }
    }

    prompts() {
        const pad = this.nav.lastDevice === 'gamepad';
        const glyph = key => {
            if (key === 'lr') return '<kbd>◀</kbd><kbd>▶</kbd>';
            if (key === 'ud') return '<kbd>▲</kbd><kbd>▼</kbd>';
            if (pad) return `<kbd class="pad ${key}">${key.toUpperCase()}</kbd>`;
            return `<kbd>${{ a: 'ENTER', b: 'ESC', y: 'T', x: 'X' }[key]}</kbd>`;
        };
        $('prompts').innerHTML = (PROMPTS[this.screen] ?? []).map(([key, label]) => `<span>${glyph(key)}${label}</span>`).join('');
    }

    bind() {
        document.addEventListener('click', event => {
            this.audio.unlock();
            const target = event.target.closest('[data-go]');
            if (!target) return;
            const go = target.dataset.go;
            if (go === 'campaign') { this.mode = 'Campaign'; this.go('map'); }
            else if (go === 'Battle' || go === 'Timed') void this.task(() => this.create(go));
            else if (go === 'multi') { this.go('multi'); void this.task(() => this.refresh()); }
            else if (go === 'hangar') { if (this.screen !== 'hangar') this.hangarReturn = this.screen; this.go('hangar'); }
            else this.go(go);
        });
        $('press').onclick = () => { this.audio.unlock(); this.audio.play('go'); this.go(this.needsPilot ? 'pilot' : 'main'); };
        $('ship-prev').onclick = () => { this.ship = (this.ship + SHIPS.length - 1) % SHIPS.length; this.showShip(); };
        $('ship-next').onclick = () => { this.ship = (this.ship + 1) % SHIPS.length; this.showShip(); };
        $('ship-choose').onclick = () => this.task(async () => {
            localStorage.setItem('vectorwings.ship', String(this.ship));
            this.audio.play('select');
            if (this.backdrop instanceof Overworld) this.backdrop.stale = true;
            if (this.state?.state === 'Lobby') this.showSeat(await this.transport.invoke('Ship', this.ship));
            else this.go(this.hangarReturn);
        });
        $('create').onclick = () => this.task(() => this.create('Campaign'));
        $('launch').onclick = () => this.task(async () => { this.audio.unlock(); this.showSeat(await this.transport.invoke('Start')); });
        $('lobby-leave').onclick = () => this.task(() => this.leave());
        $('quit').onclick = () => this.task(() => this.leave());
        $('resume').onclick = () => this.pause(false);
        $('pause-camera').onclick = () => { this.game?.toggleCamera(); this.pause(false); };
        $('touch-pause').onclick = () => this.pause(true);
        $('result-close').onclick = () => this.task(() => this.leave());
        $('join').onsubmit = event => { event.preventDefault(); void this.task(() => this.join($('room-code').value)); };
        $('sound').onclick = () => { this.audio.unlock(); this.audio.muted = !this.audio.muted; this.audio.updateVolume(); this.syncSound(); };
        $('portal').hidden = host.isApp;
        $('portal').onclick = () => { location.href = '/'; };
        $('login').onclick = () => { location.href = '/Account/Login?returnUrl=%2Fvectorwings%2F'; };
        $('menu-server').hidden = !host.isApp;
        this.syncSound();
        document.addEventListener('pointerdown', () => this.audio.unlock(), { once: true });
        addEventListener('keydown', () => this.audio.unlock(), { once: true });
    }

    syncSound() {
        $('sound').textContent = this.audio.muted ? 'TON AUS' : 'TON AN';
    }

    settings() {
        $('set-volume').value = String(Math.round(this.audio.volume * 100));
        $('set-music').value = String(Math.round(this.audio.musicVolume * 100));
        $('set-invert').checked = this.input.invertY;
        $('set-cockpit').checked = localStorage.getItem('vectorwings.camera') === 'cockpit';
        $('set-quality').value = localStorage.getItem('vectorwings.quality') ?? 'auto';
        $('set-volume').oninput = e => { this.audio.unlock(); this.audio.volume = e.target.value / 100; this.audio.updateVolume(); this.audio.play('laser'); };
        $('set-music').oninput = e => { this.audio.unlock(); this.audio.musicVolume = e.target.value / 100; this.audio.updateVolume(); };
        $('set-invert').onchange = e => this.input.setInvert(e.target.checked);
        $('set-cockpit').onchange = e => localStorage.setItem('vectorwings.camera', e.target.checked ? 'cockpit' : 'chase');
        $('set-quality').onchange = e => localStorage.setItem('vectorwings.quality', e.target.value);
    }

    showShip(sound = true) {
        const ship = SHIPS[this.ship];
        $('ship-name').textContent = ship.name.toUpperCase();
        $('ship-model').textContent = ship.model.toUpperCase();
        $('ship-text').textContent = ship.text;
        $('stat-speed').style.width = ship.speed * 100 + '%';
        $('stat-power').style.width = ship.power * 100 + '%';
        $('stat-agility').style.width = ship.agility * 100 + '%';
        $('stat-shield').style.width = ship.shield / 1.4 + '%';
        if (this.screen === 'hangar') this.backdrop?.showHangar?.(this.ship, this.slot >= 0 ? this.slot : 0);
        if (sound) this.audio.play('click');
    }

    // ─── Campaign map ───────────────────────────────────────────────────────────────

    buildBadges() {
        const done = this.clearedMissions(), medals = new Set(this.progress?.medals ?? []), open = this.unlocked();
        $('map-badges').replaceChildren(...LEVELS.missions.map((m, i) => {
            const badge = document.createElement('button');
            badge.textContent = String(i + 1);
            badge.title = m.name;
            badge.className = i >= open ? 'locked' : medals.has(i) ? 'medal' : done.has(i) ? 'done' : '';
            badge.onclick = () => {
                if (!(this.backdrop instanceof Overworld)) return;
                if (i >= open) { this.audio.play('empty'); this.notice(`Gesperrt – schließe zuerst Mission ${i} ab.`); return; }
                if (i === this.backdrop.index && !this.backdrop.route) { void this.task(() => this.create('Campaign')); return; }
                this.backdrop.go(i);
                this.selectMission(i);
            };
            return badge;
        }));
    }

    placeBadges() {
        const spots = this.backdrop.badges();
        [...$('map-badges').children].forEach((badge, i) => {
            const s = spots[i];
            badge.hidden = !s.visible;
            const current = i === (this.backdrop.route?.target ?? this.backdrop.index);
            badge.style.transform = `translate(${s.x}px, ${s.y - (current ? 26 + Math.sin(performance.now() / 180) * 4 : 0)}px)${current ? ' scale(1.25)' : ''}`;
            badge.classList.toggle('current', current);
        });
    }

    selectMission(index) {
        this.mission = index;
        localStorage.setItem('vectorwings.mission', String(index));
        const m = LEVELS.missions[index];
        $('mission-index').textContent = String(index + 1);
        $('mission-name').textContent = m.name.toUpperCase();
        $('mission-sub').textContent = m.subtitle;
        $('mission-boss').textContent = m.boss.toUpperCase();
        $('map-world').textContent = 'WELT ' + (index + 1) + ' · ' + WORLD_NAMES[index];
        const best = this.progress?.best?.[index];
        $('mission-best').textContent = best ? best.toLocaleString('de-DE') : '–';
        $('mission-medal').textContent = (this.progress?.medals ?? []).includes(index) ? 'ERFLOGEN' : `AB ${m.medal} TREFFERN`;
        $('create').textContent = this.transport && this.transport.mode !== 'offline' ? 'LOBBY ERÖFFNEN' : 'STARTEN';
    }

    pause(on) {
        if (!this.game) return;
        $('pause').hidden = !on;
        this.input.enabled = !on;
        this.input.reset();
        this.nav.enabled = on;
        if (on) this.nav.screen($('pause'), { back: () => this.pause(false) });
    }

    // ─── Connection ─────────────────────────────────────────────────────────────────

    async boot() {
        const attempt = ++this.generation;
        const former = this.transport;
        this.transport = null;
        if (former?.mode === 'online') await former.stop();
        const context = await connect({ game: GAME });
        if (attempt !== this.generation) return;
        $('version').textContent = context.info.version;
        $('server-form').hidden = !host.isApp;
        if (host.isApp) $('server-form').elements.server.value = context.server ?? '';
        $('server-form').onsubmit = event => {
            event.preventDefault();
            void this.task(async () => { await servers.select(event.target.elements.server.value); await this.boot(); this.go(this.needsPilot ? 'pilot' : 'main'); });
        };
        $('offline').onclick = () => this.task(async () => { await servers.select(null); await this.boot(); this.go('main'); });
        if (host.isApp && (!context.entry || context.problem)) {
            $('network').textContent = 'OFFLINE';
            $('guest').hidden = true;
            this.needsPilot = false;
            await this.startTransport(new LocalTransport({ game: GAME }));
            return;
        }
        if (context.problem) throw context.problem;
        const session = context.session;
        $('network').textContent = 'MATGAME ONLINE';
        if (session.signedIn) {
            this.needsPilot = false;
            $('guest').hidden = true;
            $('pilot-chip').hidden = false;
            $('pilot-chip').textContent = (session.account.name ?? session.account.displayName ?? '').toUpperCase();
            await this.startTransport(new OnlineTransport({ signalR, session, base: context.entry.path }));
            return;
        }
        this.needsPilot = true;
        $('guest').hidden = false;
        $('link').hidden = !host.isApp;
        $('login').hidden = host.isApp;
        $('pilot-hint').textContent = 'Als Gast fliegst du sofort los. Mit einem MatGame-Konto bleiben Fortschritt und Medaillen auf allen Geräten.';
        $('guest').onsubmit = event => {
            event.preventDefault();
            void this.task(async () => { await session.guest(event.target.elements.name.value); await this.boot(); this.go('main'); });
        };
        $('link').onclick = () => this.task(async () => {
            await session.deviceLogin({ onCode: details => this.notice('Gerätecode · ' + (details.code ?? details.userCode ?? details)) });
            await this.boot();
            this.go('main');
        });
    }

    async startTransport(next) {
        this.transport = next;
        next.on('Frame', seat => { if (next === this.transport && this.state?.code === seat.frame.code) this.showSeat(seat); });
        next.onClose(() => { if (next === this.transport) void this.reconnect(next).catch(error => this.notice(error.message)); });
        await next.start();
        if (next !== this.transport) return;
        $('menu-multi').disabled = next.mode === 'offline';
        $('bots-label').hidden = next.mode === 'offline';
        await this.refresh().catch(error => this.notice(error.message));
    }

    async reconnect(next) {
        const code = this.state?.code;
        $('network').textContent = 'VERBINDUNG UNTERBROCHEN';
        for (const delay of [500, 1500, 3000, 5000]) {
            await new Promise(resolve => setTimeout(resolve, delay));
            if (next !== this.transport) return;
            try { await next.start(); } catch { continue; }
            $('network').textContent = 'MATGAME ONLINE';
            if (code && this.state?.code === code) {
                try { await this.join(code); } catch { await this.leave(); this.notice('Die Partie ist bereits beendet.'); }
            } else await this.refresh();
            return;
        }
        if (this.state) await this.leave().catch(() => {});
        this.notice('Keine Verbindung. Lade die Seite neu, um MatGame erneut zu verbinden.');
    }

    async refresh() {
        const transport = this.transport;
        if (!transport?.connected || this.state) return;
        const [rooms, progress] = await Promise.all([transport.invoke('List'), transport.request('GET', '/progress').catch(() => null)]);
        if (transport !== this.transport || this.state) return;
        if (progress) {
            this.progress = progress;
            for (const m of progress.cleared ?? []) this.cleared.add(m);
            $('progress').textContent = `${this.clearedMissions().size}/4 MISSIONEN · ${(progress.medals?.length ?? 0)} MEDAILLEN · BESTWERT ${progress.bestScore.toLocaleString('de-DE')}`;
            if (this.backdrop instanceof Overworld) this.backdrop.stale = true;
        }
        $('rooms').replaceChildren(...rooms.map(room => {
            const button = document.createElement('button');
            button.className = 'slab room';
            button.dataset.nav = '';
            button.innerHTML = `<span><b></b>${room.returning ? 'WEITERSPIELEN' : room.running ? 'EINSTEIGEN' : 'BEITRETEN'} · ${MODE_NAMES[room.mode] ?? room.mode}<small></small></span>`;
            button.querySelector('b').textContent = room.code;
            button.querySelector('small').textContent = (room.mode === 'Campaign' ? room.mission + ' · ' : '') + room.humans + '/4 Piloten';
            button.onclick = () => this.task(() => this.join(room.code));
            return button;
        }));
        if (!rooms.length) $('rooms').innerHTML = '<p class="empty">Gerade fliegt niemand. Eröffne selbst eine Staffel!</p>';
        if (this.screen === 'multi') this.nav.screen($('screen-multi'), { back: () => this.back('multi'), secondary: () => this.task(() => this.refresh()) },
            this.nav.current?.isConnected ? this.nav.current : null);
    }

    async create(mode) {
        this.audio.unlock();
        this.mode = mode;
        if (params.has('preview') && !this.transport) { this.preview(mode, this.mission); return; }
        if (!this.transport) throw new Error('Noch keine Verbindung zu MatGame.');
        if (mode === 'Campaign' && this.mission >= this.unlocked()) throw new Error('Diese Mission ist noch gesperrt.');
        const seat = await this.transport.invoke('Create', mode, this.mission, $('bots').checked || this.transport.mode === 'offline' || mode !== 'Campaign', this.ship);
        this.showSeat(seat);
        if (this.transport.mode === 'offline') this.showSeat(await this.transport.invoke('Start'));
    }

    async join(code) {
        this.audio.unlock();
        this.showSeat(await this.transport.invoke('Join', code.trim().toUpperCase(), this.ship));
    }

    async leave() {
        const campaign = this.state?.mode === 'Campaign';
        try { if (!this.room) await this.transport?.invoke('Leave'); } catch { /* the room may already be gone */ }
        this.room?.dispose();
        this.room = null;
        this.endGame();
        this.state = null;
        this.slot = -1;
        $('result').hidden = true;
        $('pause').hidden = true;
        document.body.classList.add('menu');
        this.nav.enabled = true;
        if (!params.has('preview')) await this.refresh().catch(() => {});
        this.go(campaign ? 'map' : 'main');
    }

    // ─── Seats and frames ───────────────────────────────────────────────────────────

    showSeat({ slot, frame }) {
        if (this.state?.code === frame.code && frame.time < this.state.time - 1 && frame.state === this.state.state) return;
        this.state = frame;
        this.slot = slot;
        if (frame.state === 'Lobby') {
            if (this.screen !== 'lobby') this.go('lobby');
            this.lobby(frame);
            return;
        }
        if (frame.state === 'Playing' || (frame.state === 'Finished' && this.game)) {
            if (!this.game) this.startGame(frame, slot);
            else this.game.applyFrame(frame);
        }
    }

    lobby(frame) {
        const mission = LEVELS.missions[frame.mission];
        $('lobby-title').textContent = frame.mode === 'Campaign' ? 'MISSION ' + (frame.mission + 1) + ' · ' + mission.name.toUpperCase() : MODE_NAMES[frame.mode];
        $('lobby-code').textContent = frame.code;
        $('lobby-briefing').textContent = frame.mode === 'Campaign' ? mission.intro[0][1]
            : frame.mode === 'Battle' ? 'Jedes Schiff trägt drei Schildkerne. Treffer und Bomben zerstören einen, ein Boost-Rammstoß von hinten klaut ihn. Wer zuletzt fliegt, gewinnt.'
                : 'Drei Minuten Allrange-Kampf. Jeder Abschuss zählt, nach dem Absturz geht es gleich weiter.';
        $('launch').hidden = frame.leader !== this.slot;
        $('lobby-hint').textContent = frame.leader === this.slot ? 'Teile den Raumcode mit deiner Staffel. Freie Plätze fliegt die Crew.' : 'Warte auf den Staffelführer …';
        const cards = [];
        for (let slot = 0; slot < 4; slot++) {
            const p = frame.pilots.find(q => q.slot === slot);
            const li = document.createElement('li');
            li.style.animationDelay = slot * 60 + 'ms';
            if (!p) { li.className = 'empty'; li.textContent = 'FREI · ' + CREW[SLOT_CREW[slot]].name.toUpperCase(); cards.push(li); continue; }
            li.innerHTML = `<i class="portrait" style="background-image:url(${CREW[SLOT_CREW[slot]].image})"></i><b></b><small></small><span class="tag"></span>`;
            li.querySelector('b').textContent = p.name;
            li.querySelector('small').textContent = (SHIPS[p.ship]?.model ?? '').toUpperCase();
            const tag = li.querySelector('.tag');
            tag.textContent = p.slot === frame.leader ? 'FÜHRUNG' : p.slot === this.slot ? 'DU' : 'PILOT';
            tag.classList.toggle('lead', p.slot === frame.leader);
            tag.classList.toggle('me', p.slot === this.slot && p.slot !== frame.leader);
            cards.push(li);
        }
        $('lobby-pilots').replaceChildren(...cards);
        if (this.screen === 'lobby') this.nav.screen($('screen-lobby'), { back: () => this.back('lobby') },
            this.nav.current?.isConnected && this.nav.current.offsetParent ? this.nav.current : null);
    }

    startGame(frame, slot) {
        this.backdrop?.dispose();
        this.backdrop = null;
        this.fx.clear();
        document.body.classList.remove('menu');
        $('result').hidden = true;
        this.nav.enabled = false;
        this.input.enabled = true;
        this.input.reset();
        this.game = new Game(this, { frame, slot, send: report => this.send(report) });
    }

    send(report) {
        if (this.room) this.room.report(report);
        else void this.transport?.send('Report', report);
    }

    endGame() {
        if (this.game) {
            this.game.dispose();
            this.game = null;
            this.input.enabled = false;
            this.audio.engine(null);
        }
        this.audio.music('menu');
    }

    finished(frame, game) {
        const campaign = frame.mode === 'Campaign';
        const def = campaign ? LEVELS.missions.find(m => m.id === frame.mission) : null;
        const own = frame.pilots.find(p => p.slot === this.slot);
        const team = frame.pilots.reduce((sum, p) => sum + p.hits, 0);
        const winners = frame.pilots.filter(p => frame.winners.includes(p.slot));
        if (campaign && frame.success) {
            this.cleared.add(def.id);
            localStorage.setItem('vectorwings.cleared', JSON.stringify([...this.cleared]));
            if (def.id < 3) this.mission = def.id + 1;
        }
        $('result-kicker').textContent = campaign ? 'MISSION ' + (def.id + 1) + ' · ' + def.name.toUpperCase() : MODE_NAMES[frame.mode];
        $('result-title').textContent = frame.success === null ? 'ABGEBROCHEN' : campaign ? (frame.success ? 'MISSION ERFÜLLT' : 'MISSION GESCHEITERT')
            : winners.some(p => p.slot === this.slot) ? (winners.length > 1 ? 'UNENTSCHIEDEN' : 'SIEG!') : 'SIEG FÜR ' + winners.map(p => p.name.toUpperCase()).join(', ');
        $('result-medal').hidden = !(campaign && frame.success && team >= def.medal);
        let rank = '';
        if (campaign && frame.success) rank = team >= def.medal ? 'S' : team >= def.medal * .8 ? 'A' : team >= def.medal * .55 ? 'B' : 'C';
        else if (!campaign) rank = String([...frame.pilots].sort((a, b) => (b.cores - a.cores) || (b.score - a.score)).findIndex(p => p.slot === this.slot) + 1) + '.';
        $('result-rank').textContent = rank;
        const lines = campaign ? [['TREFFER STAFFEL', team], ['DEINE TREFFER', own?.hits ?? 0], ['PUNKTE', own?.score ?? 0]] : [['TREFFER', own?.hits ?? 0], ['PUNKTE', own?.score ?? 0]];
        $('result-tally').innerHTML = lines.map(([label]) => `<div><span>${label}</span><b>0</b></div>`).join('');
        const rows = [...frame.pilots].sort((a, b) => b.score - a.score);
        $('result-table').innerHTML = '<tr><th>PILOT</th><th>TREFFER</th><th>PUNKTE</th></tr>' + rows.map(p =>
            `<tr class="${p.slot === this.slot ? 'me' : ''}"><td></td><td>${p.hits}</td><td>${p.score.toLocaleString('de-DE')}</td></tr>`).join('');
        [...$('result-table').querySelectorAll('tr')].slice(1).forEach((tr, i) => { tr.firstElementChild.textContent = rows[i].name; });
        if (campaign && !frame.success) this.hud.card('MISSION GESCHEITERT', '', 'fail', 2);
        setTimeout(() => {
            if (this.game !== game) return;
            $('result').hidden = false;
            this.nav.enabled = true;
            this.nav.screen($('result'), { back: () => this.task(() => this.leave()) });
            this.tally(lines);
        }, campaign && frame.success ? 400 : 1600);
    }

    tally(lines) {
        const cells = [...$('result-tally').querySelectorAll('b')];
        const start = performance.now();
        let ticks = -1;
        const step = () => {
            const u = Math.min(1, (performance.now() - start) / 1100);
            cells.forEach((cell, i) => { cell.textContent = Math.round(lines[i][1] * (1 - Math.pow(1 - u, 3))).toLocaleString('de-DE'); });
            if (u < 1) {
                if (Math.floor(u * 20) !== ticks) { ticks = Math.floor(u * 20); this.audio.play('click', .4); }
                requestAnimationFrame(step);
            } else this.audio.play('ring');
        };
        requestAnimationFrame(step);
    }

    // ─── Preview without a host (?preview) ──────────────────────────────────────────

    preview(mode = params.get('mode') ?? 'Campaign', mission = Number(params.get('mission') ?? 0)) {
        const room = this.room = new LoopbackRoom({ mode, mission, name: 'Pilot', ship: Number(params.get('ship') ?? this.ship), bots: params.get('bots') !== '0' });
        if (params.has('t')) room.time = Number(params.get('t'));
        if (params.has('god')) room.pilots[0].maxShield = room.pilots[0].shield = 9999;
        if (params.has('clean')) document.body.classList.add('clean');
        room.weak = params.has('weak');
        room.on(frame => this.showSeat({ slot: 0, frame }));
    }
}

const app = new App();
if (params.has('preview')) {
    $('network').textContent = 'VORSCHAU';
    const screen = params.get('preview');
    if (screen === '1') app.preview();
    else if (screen && screen !== 'menu' && document.getElementById('screen-' + screen)) app.go(screen);
} else {
    void app.boot().catch(error => app.notice(error.message));
}
app.audio.music('menu');
