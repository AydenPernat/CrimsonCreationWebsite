const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const assert = require('assert/strict');

const testDir = fs.mkdtempSync(path.join(__dirname, '.smoke-'));
const port = 3200 + Math.floor(Math.random() * 1000);
const ownerEmail = 'owner@test.invalid';
const subscriberEmail = 'subscriber@test.invalid';
const sessionToken = 'test-session-token';
const account = (id, email, optedIn) => ({
    id, email, firstName: id, lastName: 'Test', verifiedAt: new Date().toISOString(),
    newsletterOptIn: optedIn, passwordHash: crypto.randomBytes(64).toString('hex')
});
const data = {
    accounts: [account('owner', ownerEmail, false), account('subscriber', subscriberEmail, true)],
    projects: [], admins: [], comments: {}, ratings: {}, contactRequests: [],
    sessions: [{ accountId: 'owner', tokenHash: crypto.createHash('sha256').update(sessionToken).digest('hex'), expiresAt: Date.now() + 60000 }]
};
for (const file of fs.readdirSync(__dirname)) {
    if (file === 'server.js' || file.endsWith('.html') || ['style.css', 'script.js', 'success.js'].includes(file)) {
        fs.copyFileSync(path.join(__dirname, file), path.join(testDir, file));
    }
}
fs.mkdirSync(path.join(testDir, 'img'));
fs.copyFileSync(path.join(__dirname, 'img', 'crimson-logo.jpg'), path.join(testDir, 'img', 'crimson-logo.jpg'));
fs.writeFileSync(path.join(testDir, 'data.json'), JSON.stringify(data));
fs.writeFileSync(path.join(testDir, 'mock.cjs'), `
const fs = require('fs');
global.fetch = async (_url, options) => {
    fs.appendFileSync(__dirname + '/emails.jsonl', options.body + '\\n');
    await new Promise(resolve => setTimeout(resolve, 250));
    return { ok: true, status: 200, json: async () => ({}) };
};
`);

const child = spawn(process.execPath, ['--require', path.join(testDir, 'mock.cjs'), path.join(testDir, 'server.js')], {
    cwd: testDir,
    env: { ...process.env, PORT: String(port), CRIMSON_ADMIN_EMAILS: ownerEmail,
        CRIMSON_PUBLIC_URL: `http://127.0.0.1:${port}`, RESEND_API_KEY: 'test', RESEND_FROM_EMAIL: ownerEmail },
    stdio: ['ignore', 'pipe', 'pipe']
});
let errors = '';
child.stderr.on('data', chunk => { errors += chunk; });
const base = `http://127.0.0.1:${port}`;
const post = (route, body, cookie) => fetch(base + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: `crimson_session=${cookie}` } : {}) },
    body: JSON.stringify(body)
});

(async () => {
    await new Promise((resolve, reject) => {
        child.stdout.once('data', resolve);
        child.once('error', reject);
        child.once('exit', code => reject(new Error(`Server exited ${code}: ${errors}`)));
    });
    const signup = email => post('/api/auth/signup', { firstName: 'New', lastName: 'User', email, password: 'test-password' });
    const anonymousContact = await fetch(base + '/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ name: 'Test', business: 'Test', email: 'contact@test.invalid', details: 'Test request' }) });
    assert.equal(anonymousContact.status, 401);
    const invalidContact = await fetch(base + '/api/contact', { method: 'POST', headers: { Cookie: `crimson_session=${sessionToken}`, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(invalidContact.status, 400);
    const [first, second, contact] = await Promise.all([
        signup('one@test.invalid'), signup('two@test.invalid'),
        fetch(base + '/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: `crimson_session=${sessionToken}` },
            body: new URLSearchParams({ name: 'Test', business: 'Test', email: 'contact@test.invalid', details: 'Test request' }) })
    ]);
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(contact.status, 200);
    let stored = JSON.parse(fs.readFileSync(path.join(testDir, 'data.json')));
    assert.equal(stored.accounts.length, 4);
    assert.equal(stored.contactRequests.length, 1);

    const missingRequest = await post('/api/newsletter/unsubscribe-request', { email: 'missing@test.invalid' });
    assert.equal(missingRequest.status, 200);
    const subscribedRequest = await post('/api/newsletter/unsubscribe-request', { email: subscriberEmail });
    assert.equal(subscribedRequest.status, 200);
    assert.deepEqual(await missingRequest.json(), await subscribedRequest.json());
    let emails = fs.readFileSync(path.join(testDir, 'emails.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(emails.filter(email => email.subject === 'Leave the Crimson Creations newsletter').length, 1);

    const newsletter = await post('/api/newsletter', { subject: 'Test update', message: 'Hello' }, sessionToken);
    assert.equal(newsletter.status, 200);
    emails = fs.readFileSync(path.join(testDir, 'emails.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const sent = emails.find(email => email.subject === 'Test update');
    assert.ok(sent);
    const token = new URL(sent.text.match(/Unsubscribe: (\S+)/)[1]).searchParams.get('token');
    assert.match(token, /^[a-f0-9]{64}$/);
    const unsubscribe = await post('/api/newsletter/unsubscribe', { token });
    assert.equal(unsubscribe.status, 200);
    stored = JSON.parse(fs.readFileSync(path.join(testDir, 'data.json')));
    assert.equal(stored.accounts.find(item => item.email === subscriberEmail).newsletterOptIn, false);
    assert.equal((await post('/api/newsletter/unsubscribe', { token })).status, 409);
    assert.equal((await post('/api/newsletter/unsubscribe', { token: 'bad' })).status, 400);
    assert.equal((await post('/api/newsletter/subscription', { subscribed: true })).status, 401);
    assert.equal((await post('/api/newsletter/subscription', { subscribed: 'yes' }, sessionToken)).status, 400);
    const subscribe = await post('/api/newsletter/subscription', { subscribed: true }, sessionToken);
    assert.equal(subscribe.status, 200);
    assert.equal((await subscribe.json()).subscribed, true);
    const meSubscribed = await fetch(base + '/api/auth/me', { headers: { Cookie: `crimson_session=${sessionToken}` } });
    assert.equal((await meSubscribed.json()).account.newsletterOptIn, true);
    const leave = await post('/api/newsletter/subscription', { subscribed: false }, sessionToken);
    assert.equal((await leave.json()).subscribed, false);
    assert.equal((await fetch(base + '/missing-page')).status, 404);
    for (const privatePath of ['/data.json', '/DATA.JSON', '/server.js', '/smoke-test.cjs', '/admins.html', '/admin.js']) {
        assert.equal((await fetch(base + privatePath)).status, 404, privatePath);
    }
    for (const publicPath of ['/services', '/style.css', '/script.js', '/img/crimson-logo.jpg']) {
        assert.equal((await fetch(base + publicPath)).status, 200, publicPath);
    }
    const legacyPage = await fetch(base + '/services.html?service=test', { redirect: 'manual' });
    assert.equal(legacyPage.status, 301);
    assert.equal(legacyPage.headers.get('location'), '/services?service=test');
    const localTargets = new Set();
    for (const file of fs.readdirSync(testDir).filter(name => name.endsWith('.html'))) {
        const markup = fs.readFileSync(path.join(testDir, file), 'utf8');
        for (const match of markup.matchAll(/(?:href|src)="([^"]+)"/g)) {
            const target = new URL(match[1], `${base}/${file}`);
            if (target.origin === base) localTargets.add(target.pathname + target.search);
        }
    }
    for (const target of localTargets) {
        assert.ok((await fetch(base + target)).status < 400, `Broken local link: ${target}`);
    }
    const dataPath = path.join(testDir, 'data.json');
    fs.writeFileSync(dataPath, '{broken');
    assert.equal((await fetch(base + '/api/projects')).status, 503);
    assert.equal((await post('/api/auth/signout', {}, sessionToken)).status, 503);
    assert.equal(fs.readFileSync(dataPath, 'utf8'), '{broken');
    console.log(`Smoke checks passed: contact access, concurrent signup, newsletter controls, private routes, and ${localTargets.size} local links/assets.`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    if (testDir.startsWith(__dirname + path.sep)) fs.rmSync(testDir, { recursive: true, force: true });
});
