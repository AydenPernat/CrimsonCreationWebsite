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
    newsletterOptIn: optedIn, passwordSalt: 'a'.repeat(32), passwordHash: crypto.scryptSync('test-password', 'a'.repeat(32), 64).toString('hex')
});
const data = {
    accounts: [account('owner', ownerEmail, false), account('subscriber', subscriberEmail, true)],
    projects: [], admins: [], comments: {}, ratings: {}, contactRequests: [],
    sessions: [{ accountId: 'subscriber', tokenHash: crypto.createHash('sha256').update('subscriber-session').digest('hex'), expiresAt: Date.now() + 60000 }, { accountId: 'owner', tokenHash: crypto.createHash('sha256').update(sessionToken).digest('hex'), expiresAt: Date.now() + 60000 }]
};
for (const file of fs.readdirSync(__dirname)) {
    if (['server.js', 'data-store.cjs', 'account-tools.cjs'].includes(file) || file.endsWith('.html') || ['style.css', 'script.js', 'success.js', 'portal-tools.js'].includes(file)) {
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
    env: { ...process.env, DATABASE_URL: '', RENDER: '', PORT: String(port), CRIMSON_ADMIN_EMAILS: ownerEmail,
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
    const readStored = () => JSON.parse(fs.readFileSync(dataPath));
    const saveStored = value => fs.writeFileSync(dataPath, JSON.stringify(value));
    const readEmails = () => fs.readFileSync(path.join(testDir, 'emails.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const resetRequest = await post('/api/auth/forgot-password', { email: subscriberEmail });
    assert.equal(resetRequest.status, 200);
    assert.deepEqual(await resetRequest.json(), await (await post('/api/auth/forgot-password', { email: 'nobody@test.invalid' })).json());
    const resetEmail = readEmails().find(item => item.subject === 'Reset your Crimson Creations password');
    const resetToken = new URL(resetEmail.text.match(/https?:\/\/\S+/)[0]).hash.slice('#reset='.length);
    assert.equal(readStored().accounts.find(item => item.id === 'subscriber').resetTokenHash, crypto.createHash('sha256').update(resetToken).digest('hex'));
    await post('/api/auth/forgot-password', { email: subscriberEmail });
    assert.equal(readEmails().filter(item => item.subject === resetEmail.subject).length, 1, 'Email cooldown');
    assert.equal((await post('/api/auth/reset-password', { token: resetToken, password: 'short' })).status, 400);
    const expired = readStored();
    expired.accounts.find(item => item.id === 'subscriber').resetExpiresAt = Date.now() - 1;
    saveStored(expired);
    assert.equal((await post('/api/auth/reset-password', { token: resetToken, password: 'new-test-password' })).status, 400);
    expired.accounts.find(item => item.id === 'subscriber').resetExpiresAt = Date.now() + 60000;
    saveStored(expired);
    assert.equal((await post('/api/auth/reset-password', { token: resetToken, password: 'new-test-password' })).status, 200);
    assert.equal(readStored().sessions.some(item => item.accountId === 'subscriber'), false);
    assert.equal((await post('/api/auth/reset-password', { token: resetToken, password: 'other-password' })).status, 400);
    assert.equal((await post('/api/auth/signin', { email: subscriberEmail, password: 'test-password' })).status, 401);
    const subscriberSignin = await post('/api/auth/signin', { email: subscriberEmail, password: 'new-test-password' });
    assert.equal(subscriberSignin.status, 200);
    const subscriberCookie = subscriberSignin.headers.get('set-cookie').match(/crimson_session=([^;]+)/)[1];

    const oldVerification = readEmails().find(item => item.subject === 'Verify your Crimson Creations account' && item.to.includes('one@test.invalid'));
    const oldLink = oldVerification.text.match(/https?:\/\/\S+/)[0];
    assert.equal((await post('/api/auth/resend-verification', { email: 'one@test.invalid' })).status, 200);
    const newVerification = readEmails().filter(item => item.subject === oldVerification.subject && item.to.includes('one@test.invalid')).at(-1);
    assert.notEqual(newVerification.text, oldVerification.text);
    assert.equal((await fetch(oldLink, { redirect: 'manual' })).status, 400);
    const newLink = newVerification.text.match(/https?:\/\/\S+/)[0];
    assert.equal((await fetch(newLink, { redirect: 'manual' })).status, 302);
    assert.equal((await fetch(newLink, { redirect: 'manual' })).status, 400);

    const backupCredentials = { password: 'test-password', passphrase: 'a separate backup passphrase' };
    assert.equal((await post('/api/backups/export', backupCredentials)).status, 401);
    assert.equal((await post('/api/backups/export', { ...backupCredentials, password: 'new-test-password' }, subscriberCookie)).status, 403);
    const withAdmin = readStored();
    withAdmin.admins.push({ accountId: 'subscriber', name: 'Subscriber' });
    saveStored(withAdmin);
    assert.equal((await post('/api/backups/export', { ...backupCredentials, password: 'new-test-password' }, subscriberCookie)).status, 403, 'An admin is not the owner');
    assert.equal((await post('/api/backups/export', { ...backupCredentials, password: 'wrong' }, sessionToken)).status, 403);
    const project = { name: 'Restore me', description: 'A backup test', ownerEmail, projectType: 'website' };
    assert.equal((await post('/api/projects', project, sessionToken)).status, 201);
    const exported = await post('/api/backups/export', backupCredentials, sessionToken);
    assert.equal(exported.status, 200);
    assert.equal(exported.headers.get('cache-control'), 'no-store');
    const { backup } = await exported.json();
    assert.equal(JSON.stringify(backup).includes(ownerEmail), false);
    const { decryptBackup, encryptBackup } = require('./account-tools.cjs');
    const snapshot = decryptBackup(backup, backupCredentials.passphrase);
    assert.deepEqual(snapshot.data.sessions, []);
    assert.equal(snapshot.data.accounts.some(item => item.resetTokenHash || item.verificationTokenHash), false);
    const preview = await post('/api/backups/preview', { ...backupCredentials, backup }, sessionToken);
    assert.equal(preview.status, 200);
    assert.equal((await preview.json()).projects, 1);
    assert.equal((await post('/api/backups/preview', { ...backupCredentials, backup, passphrase: 'incorrect passphrase' }, sessionToken)).status, 400);
    assert.equal((await post('/api/backups/preview', { ...backupCredentials, backup: { ...backup, tag: '0'.repeat(32) } }, sessionToken)).status, 400);
    const malformed = structuredClone(snapshot.data);
    malformed.projects = 'not an array';
    const malformedBackup = encryptBackup(malformed, backupCredentials.passphrase);
    assert.equal((await post('/api/backups/restore', { ...backupCredentials, backup: malformedBackup, confirmation: 'RESTORE' }, sessionToken)).status, 400);
    assert.equal(readStored().projects.length, 1, 'Malformed backup must leave stored data untouched');
    const edited = readStored();
    edited.projects = [];
    edited.accounts.find(item => item.id === 'owner').passwordHash = crypto.scryptSync('changed-owner-password', 'a'.repeat(32), 64).toString('hex');
    saveStored(edited);
    backupCredentials.password = 'changed-owner-password';
    assert.equal((await post('/api/backups/restore', { ...backupCredentials, backup }, sessionToken)).status, 400);
    assert.equal(readStored().projects.length, 0, 'Missing confirmation must not overwrite data');
    assert.equal((await post('/api/backups/restore', { ...backupCredentials, backup, confirmation: 'RESTORE' }, sessionToken)).status, 200);
    assert.equal(readStored().projects.length, 1);
    assert.deepEqual(readStored().sessions, []);
    assert.equal(readStored().accounts.find(item => item.id === 'owner').passwordHash, edited.accounts.find(item => item.id === 'owner').passwordHash, 'Restore must not revive old passwords');
    assert.equal((await post('/api/auth/signin', { email: ownerEmail, password: 'changed-owner-password' })).status, 200);
    let limited;
    for (let attempt = 0; attempt < 11; attempt++) limited = await post('/api/auth/forgot-password', { email: 'nobody@test.invalid' });
    assert.equal(limited.status, 429);
    fs.writeFileSync(dataPath, '{broken');
    assert.equal((await fetch(base + '/api/projects')).status, 503);
    assert.equal((await post('/api/auth/signout', {}, sessionToken)).status, 503);
    assert.equal(fs.readFileSync(dataPath, 'utf8'), '{broken');
    console.log(`Smoke checks passed: account recovery, encrypted backup/restore, contact access, concurrent signup, newsletter controls, private routes, and ${localTargets.size} local links/assets.`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    if (testDir.startsWith(__dirname + path.sep)) fs.rmSync(testDir, { recursive: true, force: true });
});
