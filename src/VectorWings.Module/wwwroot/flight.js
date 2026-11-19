import { createRenderer } from './vendor/flight-bundle.js';
import * as signalR from './vendor/signalr-bundle.js';
import { connect, host, LocalTransport, OnlineTransport, servers } from './matgame/index.js';

const el = id => document.getElementById(id);
const game = 'vectorwings';
const keys = new Set();
const controls = 'ArrowLeft ArrowRight ArrowDown ArrowUp Space KeyW KeyA KeyS KeyD KeyQ KeyC ShiftLeft ControlLeft'.split(' ');
const labels = { Campaign: 'Kampagne', Cores: 'Schildkerne', Timed: 'Treffer auf Zeit' };
let transport, renderer, state, audio;
let slot = -1, mode = 'Campaign', mission = 0, generation = 0;
let busy = false, muted = false, padCamera = false;
let cockpit = localStorage.getItem('vectorwings.camera') === 'cockpit';
let nextTone = 0;

const notice = (message = '') => el('notice').textContent = message;
try { renderer = createRenderer(el('flight'), el('reticle')); }
catch (error) { console.error(error); notice('Die Flugansicht benötigt WebGL.'); }
el('version').textContent = document.querySelector('meta[name=matgame-version]').content;
el('server-form').hidden = !host.isApp;
el('portal').hidden = host.isApp;
el('login').hidden = host.isApp;

async function task(action) {
    if (busy) return;
    busy = true;
    notice();
    try { await action(); }
    catch (error) { notice(error.message); }
    finally { busy = false; }
}
function enableSound() {
    if (typeof AudioContext === 'undefined') return;
    audio ??= new AudioContext();
    void audio.resume().catch(() => {});
}
function tone(from, to, duration) {
    if (!audio || muted) return;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const now = audio.currentTime;
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(to, now + duration);
    gain.gain.setValueAtTime(.06, now);
    gain.gain.exponentialRampToValueAtTime(.001, now + duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
}
function setCamera(next) {
    cockpit = next;
    localStorage.setItem('vectorwings.camera', next ? 'cockpit' : 'chase');
    renderer?.cockpit(next);
    document.body.classList.toggle('cockpit', next);
    el('camera').textContent = next ? 'Verfolger [C]' : 'Cockpit [C]';
    el('camera').setAttribute('aria-pressed', String(next));
}
setCamera(cockpit);

function select(container, attribute, selected) {
    for (const button of el(container).querySelectorAll(attribute))
        button.setAttribute('aria-pressed', String(button === selected));
}
el('modes').onclick = event => {
    const button = event.target.closest('[data-mode]');
    if (!button) return;
    mode = button.dataset.mode;
    select('modes', '[data-mode]', button);
    el('missions').hidden = mode !== 'Campaign';
    el('rule').hidden = mode === 'Campaign';
    el('rule').textContent = mode === 'Cores' ? 'Drei Kerne pro Schiff. Wer zuletzt fliegt, gewinnt.'
        : 'Drei Minuten, ein Punkt pro Treffer. Nach dem Abschuss startet dein Schiff neu.';
};
el('missions').onclick = event => {
    const button = event.target.closest('[data-mission]');
    if (!button) return;
    mission = Number(button.dataset.mission);
    select('missions', '[data-mission]', button);
};

function showSeat({ frame, slot: pilotSlot }) {
    if (state?.code === frame.code && frame.tick < state.tick) return;
    const previous = state;
    if (state?.code !== frame.code || state?.state !== frame.state) { keys.clear(); nextTone = 0; }
    state = frame;
    slot = pilotSlot;
    renderer?.setFrame(frame, slot);
    el('briefing').hidden = true;
    el('online-panel').hidden = true;
    el('lobby').hidden = frame.state !== 'Lobby';
    document.body.classList.toggle('flying', frame.state !== 'Lobby');
    el('hud').hidden = frame.state !== 'Playing';
    el('result').hidden = frame.state !== 'Finished';
    if (frame.state === 'Lobby') {
        el('lobby-title').textContent = frame.mission.name;
        el('lobby-code').textContent = frame.code;
        el('lobby-briefing').textContent = frame.mission.briefing;
        el('launch').hidden = frame.leader !== slot;
        el('lobby-pilots').replaceChildren(...frame.pilots.map(pilot => {
            const row = document.createElement('li');
            row.textContent = pilot.name + (frame.leader === pilot.slot ? ' · Staffelchef' : '');
            return row;
        }));
    } else if (frame.state === 'Playing') updateHud(frame, previous);
    else {
        const winners = frame.pilots.filter(pilot => frame.winners.includes(pilot.slot)).map(pilot => pilot.name);
        const own = frame.pilots.find(pilot => pilot.slot === slot);
        el('result-title').textContent = frame.success == null ? 'Partie beendet' : frame.mode === 'Campaign'
            ? frame.success ? 'Mission erfüllt' : 'Mission gescheitert' : winners.length === 1 ? 'Rundensieg' : 'Unentschieden';
        el('result-detail').textContent = [winners.join(', '), (own?.points ?? 0).toLocaleString('de-DE') + ' Punkte'].filter(Boolean).join(' · ');
        el('result-close').focus();
    }
}
function updateHud(frame, previous) {
    const own = frame.pilots.find(pilot => pilot.slot === slot);
    if (!own) return;
    const old = previous?.pilots.find(pilot => pilot.slot === slot);
    el('hud-name').textContent = own.name + (own.alive ? '' : frame.mode === 'Timed' ? ' · Neustart' : ' · Zuschauer');
    el('hud-shield').textContent = frame.mode === 'Campaign' ? 'Schild ' + own.shield + '%'
        : '◆'.repeat(own.shield) + '◇'.repeat(3 - own.shield);
    el('hud-weapon').textContent = frame.mode === 'Campaign'
        ? ['Laser', 'Doppellaser', 'Verstärkter Doppellaser'][own.weapon - 1] : labels[frame.mode];
    el('hud-score').textContent = String(own.points).padStart(6, '0');
    el('hud-time').textContent = frame.mode === 'Timed'
        ? Math.floor(frame.timeLeft / 60) + ':' + String(frame.timeLeft % 60).padStart(2, '0') : '';
    el('reticle').hidden = !own.alive;
    el('boss-hud').hidden = !frame.boss;
    if (frame.boss) {
        el('boss-name').textContent = frame.boss.name;
        el('boss-health').max = frame.boss.maximum;
        el('boss-health').value = frame.boss.health;
        el('boss-phase').textContent = 'Phase ' + frame.boss.phase + (frame.boss.exposed ? ' · Schwachstelle offen' : ' · Gepanzert');
        if (!previous?.boss) tone(125, 234, .5);
    }
    el('radio').textContent = frame.boss ? (frame.boss.exposed ? 'Mira: Jetzt auf die Schwachstelle!' : 'Tavi: Panzerung geschlossen!')
        : frame.tick < 250 ? frame.mission.briefing : [1, 3].includes(frame.mission.id) ? 'Eskorte · ' + frame.escort + '%'
            : frame.mode === 'Cores' ? frame.pilots.filter(pilot => pilot.alive).length + ' Schiffe im Spiel' : '';
    el('radio').hidden = !el('radio').textContent;
    if (old && old.shield > own.shield) tone(146, 64, .2);
    if (old && old.weapon < own.weapon) tone(440, 880, .27);
}

async function leave() {
    try { await transport?.invoke('Leave'); }
    finally {
        state = null;
        slot = -1;
        keys.clear();
        document.body.classList.remove('flying');
        for (const id of ['hud', 'result', 'lobby']) el(id).hidden = true;
        el('briefing').hidden = false;
        el('online-panel').hidden = false;
        renderer?.preview();
        await refresh();
    }
}
async function join(code) {
    enableSound();
    showSeat(await transport.invoke('Join', code));
}
async function refresh() {
    if (!transport?.connected || state) return;
    const next = transport;
    const [rooms, progress] = await Promise.all([next.invoke('List'), next.request('GET', '/progress')]);
    if (next !== transport || state) return;
    el('rooms').replaceChildren(...rooms.map(room => {
        const button = document.createElement('button');
        button.textContent = (room.returning ? 'Weiterspielen' : 'Beitreten') + ' · ' + room.mission + ' · ' + room.humans + '/4';
        button.onclick = () => task(() => join(room.code));
        return button;
    }));
    if (rooms.length === 0 && next.mode !== 'offline') el('rooms').textContent = 'Keine beitretbaren Partien.';
    el('progress').textContent = progress.missions + '/4 Missionen abgeschlossen · ' +
        progress.bestScore.toLocaleString('de-DE') + ' Punkte Bestwert';
    el('progress').hidden = false;
}
async function reconnect(next) {
    const code = state?.code;
    el('network').textContent = 'Verbindung unterbrochen';
    for (const delay of [500, 1500, 3000]) {
        await new Promise(resolve => setTimeout(resolve, delay));
        if (next !== transport) return;
        try { await next.start(); }
        catch { continue; }
        el('network').textContent = 'MatGame verbunden';
        if (code && state?.code === code) {
            try { await join(code); }
            catch { await leave(); notice('Die Partie ist bereits beendet.'); }
        } else await refresh();
        return;
    }
    if (state) await leave().catch(() => {});
    el('create').disabled = true;
    notice('Keine Verbindung. Lade die Seite neu, um MatGame erneut zu verbinden.');
}
async function startTransport(next) {
    transport = next;
    next.on('Frame', value => {
        if (next === transport && state?.code === value.frame.code) showSeat(value);
    });
    next.onClose(() => {
        if (next === transport) void reconnect(next).catch(error => notice(error.message));
    });
    await next.start();
    if (next !== transport) return;
    el('join').hidden = next.mode === 'offline';
    el('refresh').hidden = next.mode === 'offline';
    el('bots-label').hidden = next.mode === 'offline';
    el('guest').hidden = true;
    el('create').textContent = next.mode === 'offline' ? 'Spielen' : 'Lobby eröffnen';
    el('create').disabled = !renderer;
    await refresh();
}
async function boot() {
    const attempt = ++generation;
    const former = transport;
    transport = null;
    if (former?.mode === 'online') await former.stop();
    el('rooms').replaceChildren();
    el('progress').hidden = true;
    el('create').disabled = true;
    el('join').hidden = true;
    const context = await connect({ game });
    if (attempt !== generation) return;
    el('version').textContent = context.info.version;
    if (host.isApp) el('server-form').elements.server.value = context.server ?? '';
    if (host.isApp && (!context.entry || context.problem)) {
        el('network').textContent = 'Offline · auf diesem Gerät';
        el('guest').hidden = true;
        el('link').hidden = true;
        await startTransport(new LocalTransport({ game }));
        return;
    }
    if (context.problem) throw context.problem;
    const session = context.session;
    el('network').textContent = session.signedIn ? 'MatGame · ' + (session.account.name ?? session.account.displayName) : 'MatGame';
    if (session.signedIn) {
        el('link').hidden = true;
        await startTransport(new OnlineTransport({ signalR, session, base: context.entry.path }));
        return;
    }
    el('guest').hidden = false;
    el('link').hidden = !host.isApp;
    el('guest').onsubmit = event => {
        event.preventDefault();
        void task(async () => { await session.guest(event.target.elements.name.value); await boot(); });
    };
    el('link').onclick = () => task(async () => {
        await session.deviceLogin({ onCode: details => notice('Gerätecode · ' + (details.code ?? details.userCode ?? details)) });
        await boot();
    });
}
el('server-form').onsubmit = event => {
    event.preventDefault();
    void task(async () => { await servers.select(event.target.elements.server.value); await boot(); });
};
el('offline').onclick = () => task(async () => { await servers.select(null); await boot(); });
el('join').onsubmit = event => { event.preventDefault(); void task(() => join(el('room-code').value)); };
el('create').onclick = () => task(async () => {
    enableSound();
    showSeat(await transport.invoke('Create', mode, mission, el('bots').checked));
    if (transport.mode === 'offline') showSeat(await transport.invoke('Start'));
});
el('launch').onclick = () => task(async () => { enableSound(); showSeat(await transport.invoke('Start')); });
for (const id of ['lobby-leave', 'quit', 'result-close']) el(id).onclick = () => task(leave);
el('refresh').onclick = () => task(refresh);
el('camera').onclick = () => setCamera(!cockpit);
el('sound').onclick = () => {
    muted = !muted;
    el('sound').textContent = muted ? 'Ton aus' : 'Ton an';
    el('sound').setAttribute('aria-pressed', String(!muted));
    if (!muted) enableSound();
};
window.addEventListener('keydown', event => {
    if (state?.state !== 'Playing' || !controls.includes(event.code)) return;
    event.preventDefault();
    if (event.code === 'KeyC' && !event.repeat) setCamera(!cockpit);
    keys.add(event.code);
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => keys.clear());
setInterval(() => {
    if (state?.state !== 'Playing' || !transport?.connected) return;
    const pad = Array.from(navigator.getGamepads?.() ?? []).find(Boolean);
    const axis = index => Math.abs(pad?.axes[index] ?? 0) < .15 ? 0 : pad.axes[index];
    const button = index => !!pad?.buttons[index]?.pressed;
    const pressed = (...options) => options.some(key => keys.has(key));
    const x = Number(pressed('ArrowRight', 'KeyD')) - Number(pressed('ArrowLeft', 'KeyA')) || axis(0);
    const y = Number(pressed('ArrowUp', 'KeyW')) - Number(pressed('ArrowDown', 'KeyS')) || -axis(1);
    const fire = pressed('Space') || button(0) || button(7);
    if (button(3) && !padCamera) setCamera(!cockpit);
    padCamera = button(3);
    void transport.send('Input', { x, y, fire, boost: pressed('ShiftLeft') || button(5),
        brake: pressed('ControlLeft') || button(4), roll: pressed('KeyQ') || button(2) });
    if (fire && state.pilots.find(pilot => pilot.slot === slot)?.alive && state.tick >= nextTone) {
        tone(370, 144, .09);
        nextTone = state.tick + 8;
    }
}, 50);
void boot().catch(error => notice(error.message));
