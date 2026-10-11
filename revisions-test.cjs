const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const vm = require('node:vm');

test('own-account revision clicks save without replacing the row and show failures inline', async () => {
    const source = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
    let click;
    let fail = false;
    let preventions = 0;
    const balance = { textContent: 'Revisions available: 0' };
    const status = { textContent: '' };
    const minus = { dataset: { revisionAccountId: 'owner', revisionDelta: '-1' }, disabled: true };
    const plus = { dataset: { revisionAccountId: 'owner', revisionDelta: '1' }, disabled: false };
    const buttons = [minus, plus];
    const row = { querySelector: selector => selector.includes('status') ? status : balance, querySelectorAll: () => buttons };
    plus.closest = selector => selector === '[data-managed-account]' ? row : { querySelectorAll: () => buttons };
    const session = { id: 'owner', email: 'owner@example.test', revisions: 0 };
    let portalBalance = 0;
    const context = {
        accountManagementList: { addEventListener(_type, handler) { click = handler; } },
        currentAccountIsAdmin: () => true, currentSession: session, getAccount: () => session,
        revisionUpdatesPending: new Set(), accountManagementCache: [{ accountId: 'owner', revisions: 0 }],
        normalizeEmail: email => String(email || '').trim().toLowerCase(),
        renderPortalRevisions: () => { portalBalance = session.revisions; },
        apiRequest: async (route, options) => {
            assert.equal(route, '/api/accounts/owner/revisions');
            assert.equal(options.method, 'PATCH');
            assert.equal(JSON.parse(options.body).delta, 1);
            if (fail) throw new Error('Test connection interrupted');
            return { account: { accountId: 'owner', email: session.email, revisions: 1 } };
        }
    };
    vm.runInNewContext(source.slice(source.indexOf('if (accountManagementList) {'), source.indexOf("accountManagementSearch?.addEventListener")), context);
    const event = { target: { closest: () => plus }, preventDefault() { preventions++; }, stopPropagation() {} };
    await click(event);
    assert.equal(preventions, 1, 'Cancel navigation/submission on revision clicks');
    assert.equal(session.revisions, 1);
    assert.equal(portalBalance, 1);
    assert.equal(balance.textContent, 'Revisions available: 1');
    assert.equal(status.textContent, 'Saved. 1 revision available.');
    assert.equal(minus.disabled, false);
    assert.equal(plus.disabled, false);
    fail = true;
    await click(event);
    assert.equal(balance.textContent, 'Revisions available: 1');
    assert.match(status.textContent, /Could not save revisions: Test connection interrupted/);
    assert.equal(plus.disabled, false);
});

test('revision permissions, balances, redemption, retries, and account summaries', async () => {
    const dir = fs.mkdtempSync(path.join(__dirname, '.revisions-test-'));
    const port = 4300 + Math.floor(Math.random() * 1000);
    const tab = 'c'.repeat(64);
    const ownerToken = 'a'.repeat(64);
    const clientToken = 'b'.repeat(64);
    const hash = value => crypto.createHash('sha256').update(value).digest('hex');
    const now = new Date().toISOString();
    const account = (id, email) => ({ id, email, firstName: id, lastName: 'Test', verifiedAt: now, passwordSet: true,
        passwordSalt: 'd'.repeat(32), passwordHash: crypto.scryptSync('test-password', 'd'.repeat(32), 64).toString('hex') });
    const owner = account('owner', 'owner@example.test');
    const client = { ...account('client', 'client@example.test'), newsletterOptIn: true, oauthGoogleId: 'sample', oauthGoogleEmail: 'linked@example.test' };
    const request = (id, status, kind) => ({ id, status, kind, accountEmail: client.email, name: 'Client Test', email: client.email,
        business: 'Client business', details: 'Website work', createdAt: now, progress: status === 'completed' ? 100 : 0, notifications: [] });
    const data = { accounts: [owner, client], projects: [], admins: [], comments: {}, ratings: {},
        contactRequests: [request('website-done','completed','website'), request('revision-done','completed','revision'), request('active','confirmed','website')],
        sessions: [owner, client].map((item,index) => ({ accountId:item.id, tokenHash:hash(index ? clientToken : ownerToken), tabHash:hash(tab), expiresAt:Date.now()+600000 })) };
    for (const file of ['server.js','data-store.cjs','account-tools.cjs','social-auth.cjs']) fs.copyFileSync(path.join(__dirname,file),path.join(dir,file));
    fs.writeFileSync(path.join(dir,'data.json'),JSON.stringify(data));
    const child = spawn(process.execPath,[path.join(dir,'server.js')],{cwd:dir,env:{...process.env,PORT:String(port),DATABASE_URL:'',RENDER:'',CRIMSON_ADMIN_EMAILS:owner.email,RESEND_API_KEY:'',RESEND_FROM_EMAIL:''},stdio:['ignore','pipe','pipe']});
    let stderr = '';
    child.stderr.on('data',chunk => { stderr += chunk; });
    const call = async (route,method='GET',body,token) => {
        const result = await fetch(`http://127.0.0.1:${port}${route}`,{method,headers:{'Content-Type':'application/json','X-Crimson-Tab':tab,...(token ? {Cookie:`crimson_session=${token}`} : {})},...(body === undefined ? {} : {body:JSON.stringify(body)})});
        return {status:result.status,body:await result.json()};
    };
    const stored = () => JSON.parse(fs.readFileSync(path.join(dir,'data.json')));
    const patch = (delta,token=ownerToken) => call('/api/accounts/client/revisions','PATCH',{delta},token);
    const revision = () => ({request_kind:'revision',revision_request_id:crypto.randomUUID(),details:'Update my homepage',email:'spoof@example.test',name:'Spoof'});
    try {
        await new Promise((resolve,reject) => { child.stdout.once('data',resolve); child.once('error',reject); child.once('exit',code => reject(new Error(`Server exited ${code}: ${stderr}`))); });
        assert.equal((await call('/api/accounts')).status,401);
        assert.equal((await call('/api/accounts','GET',undefined,clientToken)).status,403);
        const summary = (await call('/api/accounts','GET',undefined,ownerToken)).body.accounts.find(item => item.accountId === 'client');
        assert.equal(summary.revisions,0);
        assert.equal(summary.completedWebsites,1,'Completed revisions must not count as finished websites');
        assert.equal(summary.activeWebsites,1);
        assert.equal(summary.createdAt,null,'Do not invent dates for older accounts');
        assert.equal(summary.newsletterOptIn,true);
        assert.equal(summary.providerEmails.google,'linked@example.test');
        assert.equal(summary.passwordHash,undefined);
        assert.equal((await patch(1,clientToken)).status,403);
        assert.equal((await patch(1,null)).status,401);
        assert.equal((await patch(0)).status,400);
        assert.equal((await patch('1')).status,400);
        assert.equal((await patch(-1)).status,409);
        const ownRevision = await call('/api/accounts/owner/revisions','PATCH',{delta:1},ownerToken);
        assert.equal(ownRevision.status,200,'Owners can add revisions to their own account');
        assert.equal(ownRevision.body.account.revisions,1);
        assert.equal((await call('/api/auth/me','GET',undefined,ownerToken)).body.account.revisions,1);
        assert.equal((await call('/api/my-workspace','GET',undefined,ownerToken)).body.revisions,1);
        assert.equal((await call('/api/accounts/owner/revisions','PATCH',{delta:-1},ownerToken)).body.account.revisions,0);
        assert.equal((await call('/api/contact','POST',revision())).status,401);
        assert.equal((await call('/api/contact','POST',revision(),clientToken)).status,409);
        assert.equal((await patch(1)).body.account.revisions,1);
        assert.equal((await patch(1)).body.account.revisions,2);
        assert.equal((await patch(-1)).body.account.revisions,1);
        assert.equal((await call('/api/auth/me','GET',undefined,clientToken)).body.account.revisions,1);
        assert.equal((await call('/api/contact','POST',{...revision(),details:''},clientToken)).status,400);
        assert.equal(stored().accounts.find(item => item.id === 'client').revisions,1,'Invalid requests must not use a revision');
        const first = revision();
        const competing = revision();
        const responses = await Promise.all([call('/api/contact','POST',first,clientToken),call('/api/contact','POST',competing,clientToken)]);
        assert.deepEqual(responses.map(item=>item.status).sort(),[202,409],'Only one request can consume the last revision');
        const saved = stored().contactRequests.find(item => item.revisionRequestId);
        assert.equal(saved.email,client.email,'A revision belongs to the authenticated account');
        assert.equal(saved.name,'client Test');
        assert.equal(saved.business,'Website revision');
        assert.equal(stored().accounts.find(item=>item.id==='client').revisions,0);
        const duplicate = saved.revisionRequestId === first.revision_request_id ? first : competing;
        assert.equal((await call('/api/contact','POST',duplicate,clientToken)).status,200);
        assert.equal(stored().contactRequests.length,4,'Retries must not create another request or spend twice');
        assert.equal((await call('/api/my-workspace','GET',undefined,clientToken)).body.revisions,0);
        const totals = (await call('/api/accounts','GET',undefined,ownerToken)).body.accounts.find(item=>item.accountId==='client');
        assert.equal(totals.completedWebsites,1);
        assert.equal(totals.revisionRequests,2);
    } finally {
        child.kill();
        if (child.exitCode === null) await new Promise(resolve => child.once('exit',resolve));
        const resolved = path.resolve(dir);
        if (path.dirname(resolved) === path.resolve(__dirname) && path.basename(resolved).startsWith('.revisions-test-')) fs.rmSync(resolved,{recursive:true,force:true});
    }
});
