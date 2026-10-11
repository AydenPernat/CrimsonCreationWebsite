const crypto = require('node:crypto');

function registerSocialAuth({ api, readData, writeData, currentAccount, createSession, normalizeEmail, hashToken, hashPassword, allowAuthAttempt, secureCookie, port }) {
    const base = () => new URL(process.env.CRIMSON_PUBLIC_URL || `http://localhost:${port}`).origin;
    const config = provider => {
        const prefix = provider.toUpperCase();
        return { id: process.env[`${prefix}_CLIENT_ID`], secret: process.env[`${prefix}_CLIENT_SECRET`] };
    };
    const enabled = provider => ['google', 'github'].includes(provider) && Boolean(config(provider).id && config(provider).secret);
    const cookie = token => `crimson_session=${token}; HttpOnly; SameSite=Lax; Path=/${secureCookie}`;
    const flowCookie = value => `crimson_oauth=${value}; HttpOnly; SameSite=Lax; Path=/api/auth/oauth; Max-Age=${value ? 600 : 0}${secureCookie}`;
    const jsonFetch = async (url, options = {}) => {
        const result = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
        if (!result.ok) throw new Error('Provider request failed');
        return result.json();
    };
    api('get', '/api/auth/providers', (_req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.json({ google: enabled('google'), github: enabled('github'), magic: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) });
    });
    api('get', '/api/auth/oauth/:provider', (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const provider = req.params.provider;
        if (!enabled(provider)) return res.status(503).json({ error: 'This sign-in provider is not configured yet. Use another sign-in method.' });
        if (!allowAuthAttempt(req, res)) return;
        const tab = String(req.headers['x-crimson-tab'] || '');
        if (!/^[a-f0-9]{64}$/.test(tab)) return res.status(400).json({ error: 'Reload the page before using social sign-in.' });
        const state = crypto.randomBytes(32).toString('hex');
        const browserToken = crypto.randomBytes(32).toString('hex');
        const verifier = crypto.randomBytes(32).toString('base64url');
        const account = currentAccount(req);
        const data = readData();
        data.oauthFlows = (data.oauthFlows || []).filter(flow => flow.expiresAt > Date.now());
        data.oauthFlows.push({ stateHash: hashToken(state), browserHash: hashToken(browserToken), tabHash: hashToken(tab), provider, verifier,
            accountId: account?.id || '', next: req.query.next === 'contact' ? '/contact' : '/portal', expiresAt: Date.now() + 600000 });
        writeData(data);
        const url = new URL(provider === 'google' ? 'https://accounts.google.com/o/oauth2/v2/auth' : 'https://github.com/login/oauth/authorize');
        const params = { client_id: config(provider).id, redirect_uri: `${base()}/api/auth/oauth/${provider}/callback`,
            response_type: 'code', scope: provider === 'google' ? 'openid email profile' : 'read:user user:email', state,
            code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' };
        for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
        res.setHeader('Set-Cookie', flowCookie(browserToken));
        res.json({ url: url.toString() });
    });
    api('get', '/api/auth/oauth/:provider/callback', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        const provider = req.params.provider;
        const browserToken = req.headers.cookie?.match(/(?:^|;\s*)crimson_oauth=([^;]+)/)?.[1] || '';
        const data = readData();
        const flow = (data.oauthFlows || []).find(item => item.provider === provider && item.stateHash === hashToken(String(req.query.state || '')) &&
            item.browserHash === hashToken(browserToken) && item.expiresAt > Date.now());
        res.setHeader('Set-Cookie', flowCookie(''));
        if (!flow || !enabled(provider)) return res.redirect('/portal?authError=invalid');
        data.oauthFlows = data.oauthFlows.filter(item => item !== flow);
        writeData(data);
        if (req.query.error || typeof req.query.code !== 'string') return res.redirect('/portal?authError=cancelled');
        try {
            const credentials = config(provider);
            const tokens = await jsonFetch(provider === 'google' ? 'https://oauth2.googleapis.com/token' : 'https://github.com/login/oauth/access_token', {
                method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ client_id: credentials.id, client_secret: credentials.secret, code: req.query.code,
                    redirect_uri: `${base()}/api/auth/oauth/${provider}/callback`, grant_type: 'authorization_code', code_verifier: flow.verifier })
            });
            if (!tokens.access_token || tokens.error) throw new Error('No access token');
            const headers = { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json', 'User-Agent': 'Crimson-Creations' };
            let profile, email, subject, name;
            if (provider === 'google') {
                profile = await jsonFetch('https://openidconnect.googleapis.com/v1/userinfo', { headers });
                if (profile.email_verified !== true || !profile.sub) throw new Error('Unverified identity');
                email = normalizeEmail(profile.email); subject = String(profile.sub); name = profile.name || '';
            } else {
                profile = await jsonFetch('https://api.github.com/user', { headers });
                const emails = await jsonFetch('https://api.github.com/user/emails', { headers });
                email = normalizeEmail(emails.find(item => item.primary && item.verified)?.email || emails.find(item => item.verified)?.email);
                if (!profile.id) throw new Error('Missing identity');
                subject = String(profile.id); name = profile.name || profile.login || '';
            }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('No verified email');
            const latest = readData();
            const identityKey = provider === 'google' ? 'oauthGoogleId' : 'oauthGithubId';
            let account = latest.accounts.find(item => item[identityKey] === subject);
            const signedIn = currentAccount(req, flow.tabHash);
            const linking = flow.accountId && signedIn?.id === flow.accountId;
            if (flow.accountId && !linking) return res.redirect('/portal?authError=link');
            if (linking) {
                if (account && account.id !== signedIn.id) return res.redirect('/portal?authError=link');
                account = latest.accounts.find(item => item.id === signedIn.id);
                if (!account?.verifiedAt || (account[identityKey] && account[identityKey] !== subject)) return res.redirect('/portal?authError=link');
            } else if (!account) {
                // Existing accounts must prove their current login before connecting a provider.
                if (latest.accounts.some(item => normalizeEmail(item.email) === email)) return res.redirect('/portal?authError=existing');
                const parts = name.trim().split(/\s+/);
                account = { id: crypto.randomBytes(12).toString('hex'), email, firstName: parts.shift() || 'Client', lastName: parts.join(' '),
                    newsletterOptIn: false, passwordSet: false, verifiedAt: new Date().toISOString(), ...hashPassword(crypto.randomBytes(48).toString('hex')) };
                latest.accounts.push(account);
            }
            if (!account.verifiedAt) throw new Error('Unverified account');
            account[identityKey] = subject;
            account[provider === 'google' ? 'oauthGoogleEmail' : 'oauthGithubEmail'] = email;
            writeData(latest);
            res.setHeader('Set-Cookie', [flowCookie(''), cookie(createSession(account, { tabHash: flow.tabHash, browserToken: req.headers.cookie?.match(/(?:^|;\s*)crimson_session=([^;]+)/)?.[1] }))]);
            res.redirect(flow.next);
        } catch {
            res.redirect('/portal?authError=provider');
        }
    });
    const magicPending = new Set();
    const generic = { message: 'If you have a verified account, a sign-in link is on its way. Check your inbox and spam folder.' };
    api('post', '/api/auth/magic-link', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        if (!allowAuthAttempt(req, res)) return;
        const email = normalizeEmail(req.body?.email);
        if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
        if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) return res.status(503).json({ error: 'Email sign-in is temporarily unavailable.' });
        const data = readData();
        const account = data.accounts.find(item => normalizeEmail(item.email) === email && item.verifiedAt);
        if (!account || magicPending.has(account.id) || Date.now() - (account.magicSentAt || 0) < 60000) return res.json(generic);
        const token = crypto.randomBytes(32).toString('hex');
        magicPending.add(account.id);
        try {
            await jsonFetch('https://api.resend.com/emails', { method: 'POST',
                headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL, to: [email], subject: 'Sign in to Crimson Creations',
                    text: `Sign in: ${base()}/portal#magic=${token}\n\nThis link expires in 15 minutes and works once. If you did not request it, ignore this email.` }) });
            const latest = readData();
            const current = latest.accounts.find(item => item.id === account.id && item.verifiedAt && normalizeEmail(item.email) === email);
            if (current) {
                current.magicTokenHash = hashToken(token); current.magicExpiresAt = Date.now() + 900000; current.magicSentAt = Date.now();
                writeData(latest);
            }
        } catch { /* Avoid revealing registered email addresses. */ }
        finally { magicPending.delete(account.id); }
        res.json(generic);
    });
    api('post', '/api/auth/magic-link/consume', (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        if (!allowAuthAttempt(req, res)) return;
        const tab = String(req.headers['x-crimson-tab'] || '');
        if (!/^[a-f0-9]{64}$/.test(tab)) return res.status(400).json({ error: 'Reload the page before signing in.' });
        const token = String(req.body?.token || '');
        const data = readData();
        const account = data.accounts.find(item => item.verifiedAt && item.magicTokenHash === hashToken(token) && item.magicExpiresAt > Date.now());
        if (!account || !/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error: 'This sign-in link is invalid or expired. Request another link.' });
        delete account.magicTokenHash; delete account.magicExpiresAt;
        writeData(data);
        res.setHeader('Set-Cookie', cookie(createSession(account, { tabHash: hashToken(tab), browserToken: req.headers.cookie?.match(/(?:^|;\s*)crimson_session=([^;]+)/)?.[1] }))); 
        res.json({ ok: true });
    });
}
module.exports = { registerSocialAuth };
