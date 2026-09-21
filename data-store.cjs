const fs = require('node:fs');
const { AsyncLocalStorage } = require('node:async_hooks');

const emptyData = () => ({ accounts: [], projects: [], admins: [], comments: {}, ratings: {}, contactRequests: [] });
function normalizeData(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Site data must contain an object.');
    return { ...emptyData(), ...data };
}

function createDataStore({ dataPath, databaseUrl, pool: suppliedPool }) {
    const context = new AsyncLocalStorage();
    const pool = suppliedPool || (databaseUrl ? new (require('pg').Pool)({
        connectionString: databaseUrl,
        max: 5,
        connectionTimeoutMillis: 15000
    }) : null);
    pool?.on?.('error', () => console.error('Database connection interrupted. Requests will retry with a new connection.'));

    const readLocal = () => {
        try { return normalizeData(JSON.parse(fs.readFileSync(dataPath, 'utf8'))); }
        catch (error) {
            if (error.code === 'ENOENT') return emptyData();
            throw error;
        }
    };
    return {
        async initialize() {
            if (!pool) return;
            await pool.query(`CREATE TABLE IF NOT EXISTS crimson_site_data (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                document JSONB NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )`);
            const existing = await pool.query('SELECT id FROM crimson_site_data WHERE id = 1');
            if (!existing.rows.length) {
                // Import once. A later deploy must never replace existing database data.
                await pool.query('INSERT INTO crimson_site_data (id, document) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING', [JSON.stringify(readLocal())]);
            }
        },
        read() {
            if (!pool) return readLocal();
            const state = context.getStore();
            if (!state) throw new Error('Database reads require a transaction.');
            return structuredClone(state.data);
        },
        write(data) {
            if (!pool) {
                fs.writeFileSync(`${dataPath}.tmp`, JSON.stringify(data, null, 2));
                fs.renameSync(`${dataPath}.tmp`, dataPath);
                return;
            }
            const state = context.getStore();
            if (!state) throw new Error('Database writes require a transaction.');
            state.data = structuredClone(normalizeData(data));
            state.dirty = true;
        },
        async run(handler) {
            if (!pool) { readLocal(); return handler(); }
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                // Serialize changes across requests and overlapping Render instances.
                const result = await client.query('SELECT document FROM crimson_site_data WHERE id = 1 FOR UPDATE');
                if (!result.rows.length) throw new Error('Site data is missing.');
                const state = { data: normalizeData(result.rows[0].document), dirty: false };
                const output = await context.run(state, handler);
                if (state.dirty) {
                    await client.query('UPDATE crimson_site_data SET document = $1::jsonb, updated_at = NOW() WHERE id = 1', [JSON.stringify(state.data)]);
                }
                await client.query('COMMIT');
                return output;
            } catch (error) {
                await client.query('ROLLBACK').catch(() => {});
                throw error;
            } finally { client.release(); }
        },
        async close() { await pool?.end(); }
    };
}

// Send cookies, redirects, and success bodies only after storage commits.
function registerApi(app, store, method, route, handler) {
    app[method](route, async (request, response) => {
        const actions = [];
        const reply = {};
        for (const name of ['status', 'setHeader', 'json', 'send', 'redirect']) {
            reply[name] = (...args) => { actions.push([name, args]); return reply; };
        }
        try {
            await store.run(() => handler(request, reply));
            for (const [name, args] of actions) response[name](...args);
        } catch (error) {
            console.error(`Site data request failed (${error.code || error.name || 'Error'}).`);
            response.status(503).json({ error: 'Site data is temporarily unavailable. Please try again.' });
        }
    });
}

module.exports = { createDataStore, registerApi };
