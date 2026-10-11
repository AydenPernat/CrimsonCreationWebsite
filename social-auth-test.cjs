const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { registerSocialAuth } = require('./social-auth.cjs');

test('OAuth state, PKCE, verified identities, account linking and single-use magic links', async () => {
    const keys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'CRIMSON_PUBLIC_URL', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL'];
    const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    keys.forEach(key => { process.env[key] = 'test'; });
    process.env.CRIMSON_PUBLIC_URL = 'https://studio.test';
    const originalFetch = global.fetch;
    let data = { accounts: [], sessions: [], oauthFlows: [] };
    let githubId = 42, githubEmail = 'git@test.invalid';
    let viewer = null, calls = [], profile = { sub: 'google-1', email: 'client@test.invalid', email_verified: true, name: 'Test Client' };
    const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
    const routes = {};
    registerSocialAuth({ api: (method, route, handler) => { routes[`${method} ${route}`] = handler; },
        readData: () => structuredClone(data), writeData: value => { data = structuredClone(value); },
        currentAccount: () => viewer, createSession: account => { data.sessions.push(account.id); return 'session-token'; },
        normalizeEmail: value => String(value || '').trim().toLowerCase(), hashToken,
        hashPassword: () => ({ passwordSalt: 'a'.repeat(32), passwordHash: 'b'.repeat(128) }), allowAuthAttempt: () => true, secureCookie: '; Secure', port: 3000 });
    const run = async (method, route, req = {}) => {
        const result = { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; return this; }, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, redirect(url) { this.location = url; return this; } };
        await routes[`${method} ${route}`]({ params: {}, query: {}, headers: {}, body: {}, ...req }, result);
        return result;
    };
    const begin = async provider => {
        const result = await run('get', '/api/auth/oauth/:provider', { params: { provider } });
        const url = new URL(result.location);
        const browserCookie = result.headers['Set-Cookie'].split(';')[0];
        assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
        assert.ok(result.headers['Set-Cookie'].includes('HttpOnly'));
        return { params: { provider }, query: { state: url.searchParams.get('state'), code: 'authorization-code' }, headers: { cookie: browserCookie } };
    };
    global.fetch = async (url, options) => {
        calls.push({ url, options });
        const body = url.endsWith('/token') || url.includes('access_token') ? { access_token: 'provider-token' }
            : url.endsWith('/userinfo') ? profile
            : url.endsWith('/user/emails') ? [{ email: githubEmail, verified: true, primary: true }]
            : url.endsWith('/user') ? { id: githubId, name: 'Git Client' } : { id: 'email-id' };
        return { ok: true, json: async () => body };
    };
    try {
        const providers = await run('get', '/api/auth/providers');
        assert.deepEqual(providers.body, { google: true, github: true, magic: true });
        let flow = await begin('google');
        let result = await run('get', '/api/auth/oauth/:provider/callback', { ...flow, headers: { cookie: 'crimson_oauth=wrong' } });
        assert.equal(result.location, '/portal?authError=invalid');
        assert.equal(calls.length, 0);
        const verifier = data.oauthFlows[0].verifier;
        result = await run('get', '/api/auth/oauth/:provider/callback', flow);
        assert.equal(result.location, '/portal');
        assert.equal(data.accounts.length, 1);
        assert.equal(data.accounts[0].oauthGoogleId, 'google-1');
        assert.equal(calls[0].options.body.get('code_verifier'), verifier);
        assert.ok(result.headers['Set-Cookie'].some(cookie => cookie.startsWith('crimson_session=')));
        const callCount = calls.length;
        assert.equal((await run('get', '/api/auth/oauth/:provider/callback', flow)).location, '/portal?authError=invalid');
        assert.equal(calls.length, callCount, 'Replayed OAuth state must never reach provider');
        flow = await begin('google');
        profile = { ...profile, sub: 'google-2' };
        assert.equal((await run('get', '/api/auth/oauth/:provider/callback', flow)).location, '/portal?authError=existing');
        assert.equal(data.accounts.length, 1, 'Existing email is not auto-linked');
        data.accounts[0].email = 'client@icloud.invalid';
        viewer = data.accounts[0];
        flow = await begin('github');
        assert.equal((await run('get', '/api/auth/oauth/:provider/callback', flow)).location, '/portal', 'An authenticated client can connect a different verified provider email');
        assert.equal(data.accounts[0].oauthGithubEmail, 'git@test.invalid');
        assert.equal(data.accounts[0].email, 'client@icloud.invalid', 'Connecting a provider keeps the primary contact email');
        assert.equal(data.accounts[0].oauthGoogleEmail, 'client@test.invalid', 'Primary, Google, and GitHub emails can all differ');
        assert.equal(data.accounts.length, 1, 'Linking a different email keeps one portal account');
        viewer = null;
        flow = await begin('github');
        assert.equal((await run('get', '/api/auth/oauth/:provider/callback', flow)).location, '/portal');
        assert.equal(data.accounts.length, 1, 'Signing in with the linked identity reuses the portal account');
        viewer = null;
        flow = await begin('google');
        profile = { ...profile, email: 'unverified@test.invalid', email_verified: false };
        assert.equal((await run('get', '/api/auth/oauth/:provider/callback', flow)).location, '/portal?authError=provider');
        assert.equal(data.accounts.length, 1);
        githubId = 43;
        githubEmail = 'another-git@test.invalid';
        flow = await begin('github');
        assert.equal((await run('get', '/api/auth/oauth/:provider/callback', flow)).location, '/portal');
        assert.equal(data.accounts[1].oauthGithubId, '43');
        viewer = data.accounts[1];
        profile = { sub: 'google-git-client', email: 'different-google@test.invalid', email_verified: true, name: 'Git Client' };
        flow = await begin('google');
        assert.equal((await run('get', '/api/auth/oauth/:provider/callback', flow)).location, '/portal');
        assert.equal(data.accounts[1].oauthGoogleId, 'google-git-client', 'Signed-in client can connect a different verified Google email');
        assert.equal(data.accounts[1].oauthGoogleEmail, 'different-google@test.invalid');
        assert.equal(data.accounts.length, 2, 'Connecting a provider does not create another account');
        profile = { ...profile, sub: 'google-1', email: 'client@test.invalid' };
        flow = await begin('google');
        assert.equal((await run('get', '/api/auth/oauth/:provider/callback', flow)).location, '/portal?authError=link', 'A provider identity cannot be moved from another portal account');
        assert.equal(data.accounts[1].oauthGoogleId, 'google-git-client');
        viewer = data.accounts[0];
        flow = await begin('google');
        viewer = null;
        assert.equal((await run('get', '/api/auth/oauth/:provider/callback', flow)).location, '/portal?authError=link', 'Linking requires the original portal sign-in to remain active');
        viewer = null;
        const missing = await run('post', '/api/auth/magic-link', { body: { email: 'missing@test.invalid' } });
        const existing = await run('post', '/api/auth/magic-link', { body: { email: 'client@icloud.invalid' } });
        assert.deepEqual(existing.body, missing.body, 'Email request does not disclose account existence');
        const email = JSON.parse(calls.at(-1).options.body);
        const token = email.text.match(/#magic=([a-f0-9]{64})/)[1];
        assert.equal(data.accounts[0].magicTokenHash, hashToken(token));
        const emailsBefore = calls.length;
        await run('post', '/api/auth/magic-link', { body: { email: 'client@icloud.invalid' } });
        assert.equal(calls.length, emailsBefore, 'Cooldown prevents duplicate email');
        data.accounts[0].magicExpiresAt = Date.now() - 1;
        assert.equal((await run('post', '/api/auth/magic-link/consume', { body: { token } })).statusCode, 400);
        data.accounts[0].magicExpiresAt = Date.now() + 60000;
        assert.equal((await run('post', '/api/auth/magic-link/consume', { body: { token } })).statusCode, 200);
        assert.equal((await run('post', '/api/auth/magic-link/consume', { body: { token } })).statusCode, 400);
        delete process.env.GOOGLE_CLIENT_ID;
        assert.equal((await run('get', '/api/auth/oauth/:provider', { params: { provider: 'google' } })).location, '/portal?authError=unavailable');
    } finally {
        global.fetch = originalFetch;
        for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
});
