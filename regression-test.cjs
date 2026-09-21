const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const { createDataStore, registerApi } = require('./data-store.cjs');

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
        matchMedia: () => ({ matches: false }), clearTimeout() {}, setTimeout: () => 1,
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
