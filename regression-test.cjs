const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const { createDataStore, registerApi } = require('./data-store.cjs');

test('selected menu trails use measured SVG lengths, stage the second bloom, and stop while hidden', () => {
    const source = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
    const frames = new Map();
    let frameId = 0;
    const listeners = {};
    const media = matches => ({ matches, addEventListener(type, fn) { this.changed = fn; } });
    const mobile = media(true);
    const reduced = media(false);
    const makeElement = () => ({ dataset: {}, children: [], attributes: {}, style: {}, classList: { add() {} },
        setAttribute(name, value) { this.attributes[name] = value; }, append(child) { this.children.push(child); }, getTotalLength: () => 400 });
    const link = { clientWidth: 342, clientHeight: 48, append(element) { this.orbit = element; } };
    let open = false;
    const nav = { querySelectorAll: () => [link], classList: { contains: () => open } };
    const document = { hidden: false, getElementById: id => id === 'navbar' ? nav : null, querySelector: () => null,
        createElementNS: makeElement, addEventListener(type, fn) { listeners[type] = fn; } };
    const context = { document, window: { matchMedia: query => query.includes('820px') ? mobile : reduced,
        addEventListener(type, fn) { listeners[type] = fn; } },
        requestAnimationFrame(fn) { const id = ++frameId; frames.set(id, fn); return id; },
        cancelAnimationFrame(id) { frames.delete(id); } };
    vm.createContext(context);
    vm.runInContext(source.slice(0, source.indexOf('// Keep internal navigation')) + '\nfunction syncOrbits() { selectedNavOrbits.forEach(orbit => orbit.sync()); }', context);
    const trails = link.orbit.children;
    const advance = time => { const entries = [...frames]; frames.clear(); entries.forEach(([, fn]) => fn(time)); };
    assert.equal(trails.length, 80);
    assert.equal(frames.size, 0, 'A closed phone menu must not use animation frames');
    assert.equal(trails[0].attributes.pathLength, undefined, 'Do not depend on normalized SVG pathLength');
    assert.equal(trails[0].style.strokeDasharray, '4.8 395.2');
    open = true; context.syncOrbits(); advance(0);
    assert.equal(trails[0].style.opacity, '1');
    assert.equal(trails[0].style.strokeDashoffset, '0px');
    assert.equal(trails[40].style.opacity, '0', 'Start with only one head at top center');
    advance(2300);
    assert.equal(trails[40].style.opacity, '0');
    advance(2400);
    assert.equal(trails[0].style.strokeDashoffset, '-200px');
    assert.equal(trails[40].style.opacity, '1');
    assert.equal(trails[40].style.strokeDashoffset, '0px');
    advance(4200);
    assert.equal(trails[79].style.opacity, '1', 'Both complete fading tails become visible');
    const mobileTail = parseFloat(trails[39].style.strokeDashoffset) - parseFloat(trails[0].style.strokeDashoffset);
    open = false; context.syncOrbits();
    assert.equal(frames.size, 0);
    assert.equal(trails[0].style.opacity, '0');
    mobile.matches = false; mobile.changed(); advance(5000); advance(8000);
    const desktopTail = parseFloat(trails[39].style.strokeDashoffset) - parseFloat(trails[0].style.strokeDashoffset);
    assert.ok(mobileTail > desktopTail, 'Phone tails stay longer than desktop tails');
    reduced.matches = true; reduced.changed();
    assert.equal(frames.size, 0);
    assert.equal(trails[40].style.strokeDashoffset, '-200px', 'Reduced motion keeps two static opposite blooms');
    document.hidden = true; listeners.visibilitychange();
    assert.equal(trails[0].style.opacity, '0');
    document.hidden = false; listeners.visibilitychange();
    assert.equal(trails[0].style.opacity, '1');
});

test('failed sign-out keeps the session visible and successful sign-out clears it', async () => {
    const source = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
    let click;
    let fail = true;
    let notice;
    let signedOutEvents = 0;
    const session = { id: 'owner' };
    const context = {
        portalSignout: { disabled: false, addEventListener(_event, handler) { click = handler; } },
        currentSession: session, portalPreview: { hidden: false },
        portalLayout: { classList: { add() {} } }, portalStatus: {}, showSigninPanel() {},
        apiRequest: async () => { if (fail) throw new Error('Connection interrupted'); },
        showSiteDialog: async options => { notice = options; },
        window: { dispatchEvent() { signedOutEvents++; } }, CustomEvent: class {}
    };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('if (portalSignout) {'), source.indexOf('const ratingButtons')), context);
    await click();
    assert.equal(context.currentSession, session);
    assert.equal(context.portalPreview.hidden, false);
    assert.match(notice.message, /still signed in/);
    assert.equal(context.portalSignout.disabled, false);
    assert.equal(signedOutEvents, 0);
    fail = false;
    await click();
    assert.equal(context.currentSession, null);
    assert.equal(context.portalPreview.hidden, true);
    assert.equal(signedOutEvents, 1);
});

test('projects persist across restart/deploy; concurrent saves and failed commits are safe', async () => {
    const dir = fs.mkdtempSync(path.join(__dirname, '.storage-test-'));
    const dataPath = path.join(dir, 'data.json');
    let db = new PGlite(path.join(dir, 'database'));
    let queue = Promise.resolve();
    let failCommit = false;
    const pool = {
        query: (...args) => db.query(...args),
        async connect() {
            const previous = queue;
            let release;
            queue = new Promise(resolve => { release = resolve; });
            await previous;
            return {
                query: (...args) => {
                    if (failCommit && args[0] === 'COMMIT') throw new Error('Simulated commit failure');
                    return db.query(...args);
                },
                release
            };
        }
    };
    const makeStore = () => createDataStore({ dataPath, pool });
    try {
        fs.writeFileSync(dataPath, JSON.stringify({ projects: [{ id: 'existing' }] }));
        let store = makeStore();
        await store.initialize();
        await Promise.all(['one', 'two'].map(id => store.run(async () => {
            const data = store.read();
            data.projects.push({ id });
            await new Promise(resolve => setTimeout(resolve, 10));
            store.write(data);
        })));
        await db.close();
        // A new deployment contains old repository data, while the DB stays intact.
        fs.writeFileSync(dataPath, JSON.stringify({ projects: [] }));
        db = new PGlite(path.join(dir, 'database'));
        store = makeStore();
        await store.initialize();
        await store.run(() => assert.deepEqual(store.read().projects.map(p => p.id), ['existing', 'one', 'two']));
        let endpoint;
        registerApi({ post: (_route, handler) => { endpoint = handler; } }, store, 'post', '/api/test', (_req, res) => {
            const data = store.read();
            data.projects.push({ id: 'failed' });
            store.write(data);
            res.setHeader('Set-Cookie', 'should-not-be-sent').status(201).json({ ok: true });
        });
        const reply = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; }, setHeader() { assert.fail('Cookie sent before commit'); } };
        failCommit = true;
        await endpoint({}, reply);
        failCommit = false;
        assert.equal(reply.code, 503);
        await store.run(() => assert.equal(store.read().projects.length, 3));
        assert.deepEqual(JSON.parse(fs.readFileSync(dataPath)).projects, []);
        // Existing DB data does not depend on a valid copy in the new checkout.
        fs.writeFileSync(dataPath, '{broken');
        await makeStore().initialize();
    } finally {
        await db.close();
        if (path.dirname(dir) === __dirname) fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('quick touch swipes survive pointercancel, viewport resize, and a second finger', () => {
    const source = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
    const listeners = {};
    const arcs = [];
    let copies = 0;
    const classes = () => ({ values: new Set(), add(v) { this.values.add(v); }, remove(v) { this.values.delete(v); } });
    const ctx = { setTransform() {}, clearRect() {}, drawImage() { copies++; }, beginPath() {}, arc(x, y) { arcs.push([x, y]); }, fill() {}, createRadialGradient() { return { addColorStop() {} }; } };
    const canvas = () => ({ width: 300, height: 150, style: {}, classList: classes(), getContext: () => ctx });
    const trail = canvas();
    const cursorGlow = { classList: classes(), style: { setProperty() {} } };
    const window = {
        ontouchstart: null, innerWidth: 390, innerHeight: 844, devicePixelRatio: 2,
        matchMedia: () => ({ matches: false, addEventListener() {} }), clearTimeout() {}, setTimeout: () => 1,
        addEventListener(name, fn, options) { (listeners[name] ||= []).push(fn); if (name.startsWith('touch')) assert.equal(options.passive, true); }
    };
    vm.runInNewContext(source.slice(source.indexOf('if (cursorGlow) {'), source.indexOf('const guidanceCopy')), {
        window, cursorGlow, document: { createElement: canvas, body: { appendChild: () => trail } }
    });
    const fire = (type, extra = {}) => (listeners[type] || []).forEach(fn => fn({ type, ...extra }));
    const finger = (x, y, identifier = 0) => ({ identifier, clientX: x, clientY: y });
    fire('touchstart', { changedTouches: [finger(10, 10)] });
    assert.deepEqual(arcs.at(-1), [10, 10]);
    fire('pointercancel', { pointerType: 'touch' });
    assert.equal(trail.classList.values.has('is-fading'), false);
    fire('touchmove', { touches: [finger(120, 150)] });
    assert.deepEqual(arcs.at(-1), [120, 150]);
    fire('touchend', { changedTouches: [finger(20, 20, 1)] });
    assert.equal(trail.classList.values.has('is-fading'), false);
    const previousCopies = copies;
    window.innerHeight = 780;
    fire('resize');
    assert.ok(copies > previousCopies);
    fire('touchend', { changedTouches: [finger(240, 250)] });
    assert.deepEqual(arcs.at(-1), [240, 250]);
    assert.equal(trail.classList.values.has('is-fading'), true);
    fire('touchstart', { changedTouches: [finger(30, 30)] });
    fire('touchend', { changedTouches: [finger(90, 100)] });
    assert.deepEqual(arcs.at(-1), [90, 100]);
});
