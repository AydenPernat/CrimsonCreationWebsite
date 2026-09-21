const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

try {
    fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(line => {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    });
} catch {
    // Environment variables can be supplied by the host instead.
}

const app = express();
const port = process.env.PORT || 3000;
const dataPath = path.join(__dirname, 'data.json');
const { createDataStore, registerApi } = require('./data-store.cjs');
const store = createDataStore({ dataPath, databaseUrl: process.env.DATABASE_URL });
const api = (method, route, handler) => registerApi(app, store, method, route, handler);
const configuredAdminEmails = (process.env.CRIMSON_ADMIN_EMAILS || '').split(',').map(normalizeEmail).filter(Boolean);
const secureCookie = process.env.NODE_ENV === 'production' ? '; Secure' : '';
const authAttempts = new Map();
const contactAttempts = new Map();
const unsubscribeAttempts = new Map();

app.use(express.json({ limit: '100kb' }));
app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' https://cdnjs.cloudflare.com https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; form-action 'self'");
    if (process.env.NODE_ENV === 'production') response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});
const cleanPageRoutes = {
    '/': 'index.html',
    '/services': 'services.html',
    '/projects': 'projects.html',
    '/project': 'project.html',
    '/about': 'about.html',
    '/contact': 'contact.html',
    '/portal': 'portal.html',
    '/unsubscribe': 'unsubscribe.html',
    '/success': 'success.html'
};

app.get('/index.html', (request, response) => {
    const suffix = request.url.slice('/index.html'.length);
    response.redirect(301, suffix ? `/${suffix}` : '/');
});
Object.entries(cleanPageRoutes).forEach(([cleanPath, fileName]) => {
    app.get(cleanPath, (_request, response) => response.sendFile(path.join(__dirname, fileName)));
});
app.get('/home', (_request, response) => response.redirect('/'));
app.get('/home.html', (_request, response) => response.redirect(301, '/'));
Object.entries(cleanPageRoutes).forEach(([cleanPath, fileName]) => {
    if (cleanPath === '/') return;
    app.get(`/${fileName}`, (request, response) => response.redirect(301, `${cleanPath}${request.url.slice(fileName.length + 1)}`));
});
['style.css', 'script.js', 'success.js'].forEach(fileName => {
    app.get(`/${fileName}`, (_request, response) => response.sendFile(path.join(__dirname, fileName)));
});
app.use('/img', express.static(path.join(__dirname, 'img')));

const readData = () => store.read();
const writeData = data => store.write(data);

function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    return { passwordSalt: salt, passwordHash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

function escapeHtml(value) {
    return String(value || '').replace(/[&<>\"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[character]));
}

async function sendVerificationEmail(email, token) {
    if (!process.env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY is missing.' };
    const baseUrl = process.env.CRIMSON_PUBLIC_URL || `http://localhost:${port}`;
    const verificationUrl = `${baseUrl}/api/auth/verify?token=${encodeURIComponent(token)}`;
    const result = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL || 'Crimson Creations <onboarding@resend.dev>',
            to: [email],
            subject: 'Verify your Crimson Creations account',
            html: `<p>Hi,</p><p>Please verify your Crimson Creations account by clicking <a href="${verificationUrl}">this verification link</a>.</p><p>If you did not create this account, you can safely ignore this email.</p><p>Crimson Creations</p>`,
            text: `Hi,\n\nPlease verify your Crimson Creations account by opening this link:\n${verificationUrl}\n\nIf you did not create this account, you can safely ignore this email.\n\nCrimson Creations`
        })
    });
    if (result.ok) return { ok: true };
    const body = await result.json().catch(() => ({}));
    const reason = body.message || `Resend returned HTTP ${result.status}.`;
    console.error(`Resend rejected verification email: ${reason}`);
    return { ok: false, error: 'Resend rejected the verification email. Check the sender address and Resend recipient restrictions.' };
}

function unsubscribeToken(account) {
    const key = account.passwordHash || account.hash;
    return crypto.createHmac('sha256', key).update(`newsletter-unsubscribe:${account.id}`).digest('hex');
}

async function sendNewsletterEmail(account, subject, message) {
    const baseUrl = process.env.CRIMSON_PUBLIC_URL || `http://localhost:${port}`;
    const unsubscribeUrl = new URL('/unsubscribe', baseUrl);
    unsubscribeUrl.searchParams.set('token', unsubscribeToken(account));
    const result = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL,
            to: [normalizeEmail(account.email)],
            subject,
            text: `${message}\n\nYou received this because you opted in to Crimson Creations updates.\nUnsubscribe: ${unsubscribeUrl}`,
            html: `<div>${escapeHtml(message).replace(/\r?\n/g, '<br>')}</div><p>You received this because you opted in to Crimson Creations updates.</p><p><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a></p>`
        })
    });
    return result.ok;
}

async function sendUnsubscribeRequestEmail(account) {
    const baseUrl = process.env.CRIMSON_PUBLIC_URL || `http://localhost:${port}`;
    const unsubscribeUrl = new URL('/unsubscribe', baseUrl);
    unsubscribeUrl.searchParams.set('token', unsubscribeToken(account));
    const result = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL,
            to: [normalizeEmail(account.email)],
            subject: 'Leave the Crimson Creations newsletter',
            text: `Use this link to remove your email from the Crimson Creations newsletter: ${unsubscribeUrl}\n\nIf you did not request this, ignore this email.`,
            html: `<p>Use this link to <a href="${escapeHtml(unsubscribeUrl)}">remove your email from the Crimson Creations newsletter</a>.</p><p>If you did not request this, ignore this email.</p>`
        })
    });
    return result.ok;
}

function passwordMatches(password, account) {
    const salt = account.passwordSalt || account.salt;
    const storedHash = account.passwordHash || account.hash;
    if (!salt || !storedHash) return false;
    const actual = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(storedHash, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function publicAccount(account) {
    if (!account) return null;
    const email = normalizeEmail(account.email);
    const isOwner = configuredAdminEmails.includes(email);
    const isAdmin = isOwner || readData().admins.some(admin => admin.accountId === account.id);
    return { firstName: account.firstName, lastName: account.lastName, email, role: isOwner ? 'owner' : isAdmin ? 'admin' : 'client', newsletterOptIn: account.newsletterOptIn === true };
}

function deleteAccountData(data, accountId) {
    const targetAccount = data.accounts.find(account => account.id === accountId);
    if (!targetAccount) return { error: 'Account not found.' };
    if (configuredAdminEmails.includes(normalizeEmail(targetAccount.email))) return { error: 'The owner account cannot be removed.' };

    const targetEmail = normalizeEmail(targetAccount.email);
    data.accounts = data.accounts.filter(account => account.id !== accountId);
    data.sessions = (data.sessions || []).filter(session => session.accountId !== accountId);
    data.admins = (data.admins || []).filter(admin => admin.accountId !== accountId);
    data.comments = Object.fromEntries(Object.entries(data.comments || {}).map(([projectId, comments]) => [
        projectId,
        (Array.isArray(comments) ? comments : []).filter(comment => normalizeEmail(comment.email) !== targetEmail)
    ]));
    data.ratings = Object.fromEntries(Object.entries(data.ratings || {}).map(([projectId, ratings]) => {
        const nextRatings = { ...(ratings || {}) };
        Object.keys(nextRatings).forEach(email => {
            if (normalizeEmail(email) === targetEmail) delete nextRatings[email];
        });
        return [projectId, nextRatings];
    }));
    data.contactRequests = (data.contactRequests || []).filter(contactRequest => normalizeEmail(contactRequest.email || contactRequest.accountEmail) !== targetEmail);
    return { ok: true, email: targetEmail };
}

function currentAccount(request) {
    const token = request.headers.cookie?.match(/crimson_session=([^;]+)/)?.[1];
    if (!token) return null;
    const data = readData();
    const session = data.sessions?.find(item => item.tokenHash === hashToken(token) && item.expiresAt > Date.now());
    return session ? data.accounts.find(account => account.id === session.accountId) : null;
}

function createSession(account) {
    const token = crypto.randomBytes(32).toString('hex');
    const data = readData();
    data.sessions = (data.sessions || []).filter(session => session.expiresAt > Date.now());
    data.sessions.push({ accountId: account.id, tokenHash: hashToken(token), expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    writeData(data);
    return token;
}

function requireAccount(request, response, adminOnly = false) {
    const account = currentAccount(request);
    if (!account) { response.status(401).json({ error: 'Sign in required.' }); return null; }
    if (adminOnly && !['admin', 'owner'].includes(publicAccount(account).role)) { response.status(403).json({ error: 'Administrator access required.' }); return null; }
    return account;
}

function allowAuthAttempt(request, response) {
    const key = request.ip || 'unknown';
    const now = Date.now();
    const attempts = (authAttempts.get(key) || []).filter(timestamp => now - timestamp < 15 * 60 * 1000);
    if (attempts.length >= 10) { response.status(429).json({ error: 'Too many attempts. Please try again later.' }); return false; }
    attempts.push(now); authAttempts.set(key, attempts); return true;
}

api('get', '/api/auth/me', (request, response) => response.json({ account: publicAccount(currentAccount(request)) }));

api('post', '/api/auth/signup', async (request, response) => {
    if (!allowAuthAttempt(request, response)) return;
    const { firstName, lastName, email, password } = request.body || {};
    const normalizedEmail = normalizeEmail(email);
    if (!firstName || !lastName || !normalizedEmail || typeof password !== 'string' || password.length < 8) return response.status(400).json({ error: 'Use a name, valid email, and password with at least 8 characters.' });
    if (readData().accounts.some(account => normalizeEmail(account.email) === normalizedEmail)) return response.status(409).json({ error: 'That email already has an account.' });
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const account = { id: crypto.randomBytes(12).toString('hex'), firstName: String(firstName).trim(), lastName: String(lastName).trim(), email: normalizedEmail, newsletterOptIn: request.body?.newsletterOptIn === true, verifiedAt: null, verificationTokenHash: hashToken(verificationToken), verificationExpiresAt: Date.now() + 24 * 60 * 60 * 1000, ...hashPassword(password) };
    let verificationResult;
    try { verificationResult = await sendVerificationEmail(normalizedEmail, verificationToken); } catch { verificationResult = { ok: false, error: 'The email service could not be reached.' }; }
    if (!verificationResult.ok) return response.status(503).json({ error: verificationResult.error });
    const data = readData();
    if (data.accounts.some(item => normalizeEmail(item.email) === normalizedEmail)) return response.status(409).json({ error: 'That email already has an account.' });
    data.accounts.push(account);
    writeData(data);
    response.status(201).json({ message: 'Check your email to verify the account before signing in. If you do not see it, check your Spam or Junk folder.' });
});

api('get', '/api/auth/verify', (request, response) => {
    const token = String(request.query.token || '');
    const data = readData();
    const account = data.accounts.find(item => item.verificationTokenHash === hashToken(token) && item.verificationExpiresAt > Date.now());
    if (!account) return response.status(400).send('This verification link is invalid or expired.');
    account.verifiedAt = new Date().toISOString();
    delete account.verificationTokenHash;
    delete account.verificationExpiresAt;
    if (configuredAdminEmails.includes(normalizeEmail(account.email)) && !data.admins.some(admin => admin.accountId === account.id)) data.admins.push({ accountId: account.id, name: `${account.firstName} ${account.lastName}` });
    writeData(data);
    const sessionToken = createSession(account);
    response.setHeader('Set-Cookie', `crimson_session=${sessionToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secureCookie}`);
    response.redirect('/portal?verified=1');
});

api('post', '/api/auth/signin', (request, response) => {
    if (!allowAuthAttempt(request, response)) return;
    const { email, password } = request.body || {};
    const account = readData().accounts.find(item => normalizeEmail(item.email) === normalizeEmail(email));
    if (!account) return response.status(404).json({ error: 'No account was found for that email.' });
    if (typeof password !== 'string' || !passwordMatches(password, account)) return response.status(401).json({ error: 'The password is incorrect.' });
    if (!account.verifiedAt) return response.status(403).json({ error: 'Verify your email before signing in.' });
    const token = createSession(account);
    response.setHeader('Set-Cookie', `crimson_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secureCookie}`);
    response.json({ account: publicAccount(account) });
});

api('post', '/api/auth/signout', (request, response) => {
    const token = request.headers.cookie?.match(/crimson_session=([^;]+)/)?.[1];
    if (token) { const data = readData(); data.sessions = (data.sessions || []).filter(session => session.tokenHash !== hashToken(token)); writeData(data); }
    response.setHeader('Set-Cookie', `crimson_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookie}`);
    response.json({ ok: true });
});

api('get', '/api/projects', (_request, response) => {
    const data = readData();
    const projects = data.projects.map(project => {
        const ratings = Object.values(data.ratings[project.id] || {});
        return { ...project, rating: ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : 0, ratingCount: ratings.length };
    });
    response.json({ projects, websiteCount: projects.filter(project => project.projectType !== 'game').length });
});

api('get', '/api/projects/:id/feedback', (request, response) => {
    const data = readData();
    if (!data.projects.some(project => project.id === request.params.id)) return response.status(404).json({ error: 'Project not found.' });
    const comments = Array.isArray(data.comments[request.params.id]) ? data.comments[request.params.id] : [];
    const viewer = currentAccount(request);
    const viewerIsAdmin = viewer && ['admin', 'owner'].includes(publicAccount(viewer).role);
    const ratings = Object.values(data.ratings[request.params.id] || {});
    const average = ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : 0;
    const viewerRating = viewer ? Number(data.ratings[request.params.id]?.[normalizeEmail(viewer.email)] || 0) : 0;
    const project = data.projects.find(item => item.id === request.params.id);
    response.json({ comments: comments.map(comment => ({
        ...comment,
        email: undefined,
        rating: Number(data.ratings[request.params.id]?.[normalizeEmail(comment.email)] || 0),
        isOwner: normalizeEmail(comment.email) === normalizeEmail(project.ownerEmail),
        canDelete: Boolean(viewer && (viewerIsAdmin || normalizeEmail(viewer.email) === normalizeEmail(comment.email)))
    })), rating: average, count: ratings.length, viewerRating });
});

api('put', '/api/projects/:id/feedback/rating', (request, response) => {
    const account = requireAccount(request, response);
    if (!account) return;
    const rating = Number(request.body?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return response.status(400).json({ error: 'Rating must be between 1 and 5.' });
    const data = readData();
    if (!data.projects.some(project => project.id === request.params.id)) return response.status(404).json({ error: 'Project not found.' });
    if (!data.ratings[request.params.id]) data.ratings[request.params.id] = {};
    const accountEmail = normalizeEmail(account.email);
    data.ratings[request.params.id][accountEmail] = rating;
    const projectComments = Array.isArray(data.comments[request.params.id]) ? data.comments[request.params.id] : [];
    projectComments.forEach(comment => {
        if (normalizeEmail(comment.email) === accountEmail) comment.rating = rating;
    });
    writeData(data);
    response.json({ ok: true });
});

api('post', '/api/projects/:id/feedback/comments', (request, response) => {
    const account = requireAccount(request, response);
    if (!account) return;
    const subject = String(request.body?.subject || '').trim();
    const message = String(request.body?.message || '').trim();
    if (!subject || !message || subject.length > 160 || message.length > 4000) return response.status(400).json({ error: 'Add a subject and comment within the allowed length.' });
    const data = readData();
    if (!data.projects.some(project => project.id === request.params.id)) return response.status(404).json({ error: 'Project not found.' });
    if (!Array.isArray(data.comments[request.params.id])) data.comments[request.params.id] = [];
    const rating = Number(data.ratings[request.params.id]?.[normalizeEmail(account.email)] || 0);
    const comment = { id: crypto.randomBytes(12).toString('hex'), name: `${account.firstName} ${account.lastName}`.trim(), email: normalizeEmail(account.email), rating, subject, message, createdAt: new Date().toISOString() };
    data.comments[request.params.id].push(comment);
    writeData(data);
    response.status(201).json({ comment });
});

api('delete', '/api/projects/:id/feedback/comments/:commentId', (request, response) => {
    const account = requireAccount(request, response);
    if (!account) return;
    const data = readData();
    if (!data.projects.some(project => project.id === request.params.id)) return response.status(404).json({ error: 'Project not found.' });
    const comments = Array.isArray(data.comments[request.params.id]) ? data.comments[request.params.id] : [];
    const comment = comments.find(item => item.id === request.params.commentId);
    const isAdmin = ['admin', 'owner'].includes(publicAccount(account).role);
    if (!comment) return response.status(404).json({ error: 'Comment not found.' });
    if (!isAdmin && normalizeEmail(comment.email) !== normalizeEmail(account.email)) return response.status(403).json({ error: 'You can only delete your own comment.' });
    data.comments[request.params.id] = comments.filter(item => item.id !== request.params.commentId);
    writeData(data);
    response.json({ ok: true });
});

function normalizeProjectPayload(input = {}) {
    const projectType = input.projectType === 'game' ? 'game' : input.projectType === 'website' ? 'website' : '';
    const project = {
        name: String(input.name || '').trim().slice(0, 160),
        description: String(input.description || '').trim().slice(0, 4000),
        tags: String(input.tags || '').trim().slice(0, 500),
        link: String(input.link || '').trim().slice(0, 500),
        ownerEmail: normalizeEmail(input.ownerEmail).slice(0, 200),
        badges: String(input.badges || '').trim().slice(0, 500),
        direction: String(input.direction || '').trim().slice(0, 1000),
        structure: String(input.structure || '').trim().slice(0, 1000),
        focus: String(input.focus || '').trim().slice(0, 1000),
        buildTitle: String(input.buildTitle || '').trim().slice(0, 240),
        buildDescription: String(input.buildDescription || '').trim().slice(0, 2000),
        projectType
    };
    if (!project.name || !project.description || !project.ownerEmail || !projectType) return { error: 'Name, description, owner email, and project type are required.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(project.ownerEmail)) return { error: 'Enter a valid project owner email.' };
    if (project.link) {
        try {
            const url = new URL(project.link);
            if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
        } catch { return { error: 'The project link must be a valid http or https URL.' }; }
    }
    return { project };
}

api('post', '/api/projects', (request, response) => {
    if (!requireAccount(request, response, true)) return;
    const normalized = normalizeProjectPayload(request.body);
    if (normalized.error) return response.status(400).json({ error: normalized.error });
    const project = { ...normalized.project, id: `project-${Date.now()}-${crypto.randomBytes(4).toString('hex')}` };
    const data = readData(); data.projects.push(project); writeData(data);
    response.status(201).json({ project });
});

api('put', '/api/projects/:id', (request, response) => {
    if (!requireAccount(request, response, true)) return;
    const data = readData(); const index = data.projects.findIndex(project => project.id === request.params.id);
    if (index < 0) return response.status(404).json({ error: 'Project not found.' });
    const normalized = normalizeProjectPayload(request.body);
    if (normalized.error) return response.status(400).json({ error: normalized.error });
    data.projects[index] = { ...normalized.project, id: request.params.id }; writeData(data);
    response.json({ project: data.projects[index] });
});

api('delete', '/api/projects/:id', (request, response) => {
    if (!requireAccount(request, response, true)) return;
    const data = readData(); const nextProjects = data.projects.filter(project => project.id !== request.params.id);
    if (nextProjects.length === data.projects.length) return response.status(404).json({ error: 'Project not found.' });
    data.projects = nextProjects; writeData(data); response.json({ ok: true });
});

api('get', '/api/admins', (request, response) => {
    if (!requireAccount(request, response, true)) return;
    const data = readData();
    const roster = configuredAdminEmails.map(email => {
        const account = data.accounts.find(item => normalizeEmail(item.email) === email);
        return { accountId: account?.id, name: `${account?.firstName || 'Site'} ${account?.lastName || 'Owner'}`.trim(), email, isOwner: true };
    });
    data.admins.forEach(admin => {
        if (roster.some(item => item.accountId === admin.accountId || normalizeEmail(item.email) === normalizeEmail(admin.email))) return;
        const account = data.accounts.find(item => item.id === admin.accountId);
        roster.push({ accountId: admin.accountId, name: admin.name || `${account?.firstName || 'Administrator'} ${account?.lastName || ''}`.trim(), email: normalizeEmail(admin.email || account?.email), isOwner: false });
    });
    response.json({ admins: roster });
});

api('get', '/api/newsletter/subscribers', (request, response) => {
    if (!requireAccount(request, response, true)) return;
    const data = readData();
    const subscribers = (data.accounts || [])
        .filter(account => account.verifiedAt && account.newsletterOptIn === true && normalizeEmail(account.email))
        .map(account => ({
            accountId: account.id,
            name: `${account.firstName || 'Subscriber'} ${account.lastName || ''}`.trim(),
            email: normalizeEmail(account.email),
            verifiedAt: account.verifiedAt
        }))
        .sort((first, second) => `${first.name} ${first.email}`.localeCompare(`${second.name} ${second.email}`));
    response.json({ subscribers });
});

api('delete', '/api/newsletter/subscribers/:accountId', (request, response) => {
    const requester = requireAccount(request, response, true);
    if (!requester) return;
    const data = readData();
    const targetAccount = data.accounts.find(account => account.id === request.params.accountId);
    if (!targetAccount) return response.status(404).json({ error: 'Subscriber not found.' });
    if (configuredAdminEmails.includes(normalizeEmail(targetAccount.email))) return response.status(403).json({ error: 'The owner subscription cannot be removed.' });
    targetAccount.newsletterOptIn = false;
    writeData(data);
    response.json({ ok: true });
});

api('post', '/api/newsletter/unsubscribe-request', async (request, response) => {
    const email = normalizeEmail(request.body?.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response.status(400).json({ error: 'Enter a valid email address.' });
    const key = request.ip || 'unknown';
    const now = Date.now();
    const attempts = (unsubscribeAttempts.get(key) || []).filter(timestamp => now - timestamp < 60 * 60 * 1000);
    if (attempts.length >= 5) return response.status(429).json({ error: 'Too many requests. Please try again later.' });
    attempts.push(now); unsubscribeAttempts.set(key, attempts);
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) return response.status(503).json({ error: 'Email delivery is temporarily unavailable.' });
    const account = readData().accounts.find(item => normalizeEmail(item.email) === email && item.verifiedAt && item.newsletterOptIn === true);
    if (account) {
        try {
            if (!await sendUnsubscribeRequestEmail(account)) console.error('Resend rejected an unsubscribe request email.');
        } catch (error) {
            console.error(`Unsubscribe request email failed: ${error.message}`);
        }
    }
    response.json({ message: 'If that email is subscribed, we sent a link to remove it from the newsletter.' });
});

api('post', '/api/newsletter/unsubscribe', (request, response) => {
    const data = readData();
    const token = String(request.body?.token || '');
    let targetAccount;
    if (token) {
        if (!/^[a-f0-9]{64}$/.test(token)) return response.status(400).json({ error: 'This unsubscribe link is invalid.' });
        const provided = Buffer.from(token, 'hex');
        targetAccount = data.accounts.find(item => {
            if (!(item.passwordHash || item.hash)) return false;
            return crypto.timingSafeEqual(provided, Buffer.from(unsubscribeToken(item), 'hex'));
        });
        if (!targetAccount) return response.status(400).json({ error: 'This unsubscribe link is invalid.' });
    } else {
        const account = requireAccount(request, response);
        if (!account) return;
        targetAccount = data.accounts.find(item => item.id === account.id);
    }
    if (!targetAccount) return response.status(404).json({ error: 'Account not found.' });
    if (targetAccount.newsletterOptIn !== true) return response.status(409).json({ error: 'This email is not currently subscribed.' });
    targetAccount.newsletterOptIn = false;
    writeData(data);
    response.json({ ok: true });
});

api('post', '/api/newsletter/subscription', (request, response) => {
    const account = requireAccount(request, response);
    if (!account) return;
    if (typeof request.body?.subscribed !== 'boolean') return response.status(400).json({ error: 'Choose whether to subscribe or unsubscribe.' });
    const data = readData();
    const targetAccount = data.accounts.find(item => item.id === account.id);
    if (!targetAccount) return response.status(404).json({ error: 'Account not found.' });
    targetAccount.newsletterOptIn = request.body.subscribed;
    writeData(data);
    response.json({ subscribed: targetAccount.newsletterOptIn });
});

api('get', '/api/accounts', (request, response) => {
    if (!requireAccount(request, response, true)) return;
    const data = readData();
    const accounts = (data.accounts || [])
        .map(account => ({
            accountId: account.id,
            name: `${account.firstName || 'Account'} ${account.lastName || ''}`.trim(),
            email: normalizeEmail(account.email),
            verifiedAt: account.verifiedAt || null,
            newsletterOptIn: account.newsletterOptIn === true
        }))
        .sort((first, second) => `${first.name} ${first.email}`.localeCompare(`${second.name} ${second.email}`));
    response.json({ accounts });
});

api('delete', '/api/accounts/:accountId', (request, response) => {
    const requester = requireAccount(request, response, true);
    if (!requester) return;
    if (!configuredAdminEmails.includes(normalizeEmail(requester.email))) return response.status(403).json({ error: 'Only the owner can delete account data.' });
    const data = readData();
    const result = deleteAccountData(data, request.params.accountId);
    if (result.error) return response.status(result.error === 'Account not found.' ? 404 : 403).json({ error: result.error });
    writeData(data);
    response.json({ ok: true, email: result.email });
});

api('post', '/api/newsletter', async (request, response) => {
    const account = requireAccount(request, response, true);
    if (!account) return;
    const subject = String(request.body?.subject || '').trim();
    const message = String(request.body?.message || '').trim();
    if (!subject || !message || subject.length > 160 || message.length > 5000) {
        return response.status(400).json({ error: 'Add a subject and message within the allowed length.' });
    }
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
        return response.status(503).json({ error: 'Newsletter sending is not configured yet.' });
    }

    const recipients = readData().accounts.filter(item => item.verifiedAt && item.newsletterOptIn === true && normalizeEmail(item.email));
    let sent = 0;
    let failed = 0;
    for (const recipient of recipients) {
        try {
            if (await sendNewsletterEmail(recipient, subject, message)) sent += 1;
            else failed += 1;
        } catch (error) {
            failed += 1;
            console.error(`Newsletter delivery failed: ${error.message}`);
        }
    }
    if (sent === 0 && failed > 0) return response.status(502).json({ error: 'The newsletter could not be delivered to any opted-in subscribers.', sent, failed });
    response.json({ ok: true, sent, failed, total: recipients.length });
});

api('post', '/api/admins', (request, response) => {
    if (!requireAccount(request, response, true)) return;
    const email = normalizeEmail(request.body?.email);
    if (!email) return response.status(400).json({ error: 'A valid email is required.' });
    const data = readData();
    const targetAccount = data.accounts.find(item => normalizeEmail(item.email) === email);
    if (!targetAccount || !targetAccount.verifiedAt) return response.status(403).json({ error: 'That person must verify their email before receiving administrator access.' });
    if (!data.admins.some(admin => admin.accountId === targetAccount.id)) data.admins.push({ accountId: targetAccount.id, name: String(request.body.name || `${targetAccount.firstName} ${targetAccount.lastName}`).trim(), email });
    writeData(data); response.status(201).json({ ok: true });
});

api('delete', '/api/admins/:accountId', (request, response) => {
    const requester = requireAccount(request, response, true);
    if (!requester) return;
    if (!configuredAdminEmails.includes(normalizeEmail(requester.email))) return response.status(403).json({ error: 'Only the owner can remove administrators.' });
    const data = readData();
    const target = data.accounts.find(account => account.id === request.params.accountId);
    if (!target || configuredAdminEmails.includes(normalizeEmail(target.email))) return response.status(403).json({ error: 'The owner account cannot be removed.' });
    const nextAdmins = data.admins.filter(admin => admin.accountId !== request.params.accountId);
    if (nextAdmins.length === data.admins.length) return response.status(404).json({ error: 'Administrator not found.' });
    data.admins = nextAdmins;
    writeData(data);
    response.json({ ok: true });
});

app.use(express.urlencoded({ extended: false }));
api('post', '/api/contact', async (request, response) => {
    const signedInAccount = requireAccount(request, response);
    if (!signedInAccount) return;
    const body = request.body || {};
    const name = String(body.name || '').trim();
    const business = String(body.business || '').trim();
    const email = normalizeEmail(body.email);
    const details = String(body.details || '').trim();
    if (!name || !business || !details || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return response.status(400).json({ error: 'Add your name, business, valid email, and project details.' });
    }
    const key = request.ip || 'unknown';
    const now = Date.now();
    const attempts = (contactAttempts.get(key) || []).filter(timestamp => now - timestamp < 60 * 60 * 1000);
    if (attempts.length >= 5) return response.status(429).json({ message: 'Too many requests. Please try again later.' });
    attempts.push(now); contactAttempts.set(key, attempts);
    if (body.botcheck) return response.json({ success: true });
    const data = readData();
    const contactRequest = {
        id: crypto.randomBytes(12).toString('hex'),
        accountEmail: normalizeEmail(signedInAccount?.email),
        name: name.slice(0, 120),
        business: business.slice(0, 160),
        email: email.slice(0, 200),
        phone: String(body.phone || '').trim().slice(0, 80),
        budget: String(body.budget || '').trim().slice(0, 120),
        pages: String(body.pages || '').trim().slice(0, 300),
        details: details.slice(0, 4000),
        projectGoal: String(body.project_goal || '').trim().slice(0, 1000),
        projectStyle: String(body.project_style || '').trim().slice(0, 1000),
        projectPages: String(body.project_pages || '').trim().slice(0, 1000),
        projectTimeline: String(body.project_timeline || '').trim().slice(0, 1000),
        status: 'pending',
        progress: 0,
        notifications: [],
        createdAt: new Date().toISOString()
    };
    data.contactRequests.push(contactRequest);
    writeData(data);
    const recipient = configuredAdminEmails[0];
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL || !recipient) {
        return response.status(202).json({ success: true, message: 'Your request was saved. Email notifications are not configured yet.' });
    }
    const text = [
        `Name: ${contactRequest.name}`,
        `Business: ${contactRequest.business}`,
        `Email: ${contactRequest.email}`,
        `Phone: ${contactRequest.phone || 'Not provided'}`,
        `Budget: ${contactRequest.budget || 'Not provided'}`,
        `Pages: ${contactRequest.pages || 'Not provided'}`,
        '',
        `Project details: ${contactRequest.details}`,
        `Goal: ${contactRequest.projectGoal || 'Not provided'}`,
        `Style: ${contactRequest.projectStyle || 'Not provided'}`,
        `Suggested pages: ${contactRequest.projectPages || 'Not provided'}`,
        `Timeline: ${contactRequest.projectTimeline || 'Not provided'}`
    ].join('\n');
    const html = text.split('\n').map(line => line ? `<p>${escapeHtml(line)}</p>` : '<br>').join('');
    try {
        const result = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: process.env.RESEND_FROM_EMAIL,
                to: [recipient],
                reply_to: contactRequest.email,
                subject: `New website request from ${contactRequest.name}`,
                text,
                html
            })
        });
        const body = await result.json().catch(() => ({}));
        if (!result.ok) {
            console.error(`Resend rejected contact request: ${body.message || `HTTP ${result.status}`}`);
            return response.status(202).json({ success: true, message: 'Your request was saved, but the email notification could not be delivered.' });
        }
        response.json({ success: true, message: 'Request sent.' });
    } catch (error) {
        console.error(`Resend contact request failed: ${error.message}`);
        response.status(202).json({ success: true, message: 'Your request was saved, but the email notification is temporarily unavailable.' });
    }
});

api('get', '/api/contact-requests', (request, response) => {
    if (!requireAccount(request, response, true)) return;
    const data = readData();
    response.json({ requests: (data.contactRequests || []).map(item => ({
        ...item,
        progress: Number.isFinite(Number(item.progress)) ? Math.max(0, Math.min(100, Number(item.progress))) : 0,
        notifications: Array.isArray(item.notifications) ? item.notifications : []
    })).sort((first, second) => new Date(first.createdAt) - new Date(second.createdAt)) });
});

api('get', '/api/my-workspace', (request, response) => {
    const account = requireAccount(request, response);
    if (!account) return;
    const email = normalizeEmail(account.email);
    const data = readData();
    const requests = (data.contactRequests || [])
        .filter(item => normalizeEmail(item.accountEmail || item.email) === email)
        .map(item => ({
            ...item,
            progress: Number.isFinite(Number(item.progress)) ? Math.max(0, Math.min(100, Number(item.progress))) : 0,
            notifications: Array.isArray(item.notifications) ? item.notifications : []
        }));
    response.json({ requests });
});

api('patch', '/api/contact-requests/:id', (request, response) => {
    if (!requireAccount(request, response, true)) return;
    const status = String(request.body?.status || '').toLowerCase();
    if (status && !['pending', 'confirmed', 'completed'].includes(status)) return response.status(400).json({ error: 'Choose pending, confirmed, or completed.' });
    const data = readData();
    const contactRequest = (data.contactRequests || []).find(item => item.id === request.params.id);
    if (!contactRequest) return response.status(404).json({ error: 'Request not found.' });
    if (status) contactRequest.status = status;
    if (!Array.isArray(contactRequest.notifications)) contactRequest.notifications = [];
    const hasProgress = request.body?.progress !== undefined;
    const progress = hasProgress ? Number(request.body.progress) : Number(contactRequest.progress || 0);
    if (hasProgress && (!Number.isInteger(progress) || progress < 0 || progress > 100)) return response.status(400).json({ error: 'Progress must be a whole number from 0 to 100.' });
    if (hasProgress) contactRequest.progress = progress;
    if (contactRequest.status === 'completed') contactRequest.progress = 100;
    const note = String(request.body?.note || '').trim().slice(0, 1000);
    if (note || hasProgress || status === 'completed') {
        contactRequest.notifications.push({
            id: crypto.randomBytes(12).toString('hex'),
            message: note || (contactRequest.status === 'completed' ? 'Your project has been completed.' : `Project progress updated to ${contactRequest.progress}%.`),
            progress: contactRequest.progress,
            createdAt: new Date().toISOString()
        });
    }
    writeData(data);
    response.json({ request: contactRequest });
});

api('delete', '/api/contact-requests/:id', (request, response) => {
    if (!requireAccount(request, response, true)) return;
    const data = readData();
    const requests = data.contactRequests || [];
    const nextRequests = requests.filter(item => item.id !== request.params.id);
    if (nextRequests.length === requests.length) return response.status(404).json({ error: 'Request not found.' });
    data.contactRequests = nextRequests;
    writeData(data);
    response.json({ ok: true });
});

api('delete', '/api/my-workspace/notifications/:notificationId', (request, response) => {
    const account = requireAccount(request, response);
    if (!account) return;
    const data = readData();
    const email = normalizeEmail(account.email);
    let removed = false;
    (data.contactRequests || []).forEach(contactRequest => {
        if (normalizeEmail(contactRequest.accountEmail || contactRequest.email) !== email || !Array.isArray(contactRequest.notifications)) return;
        const nextNotifications = contactRequest.notifications.filter(notification => notification.id !== request.params.notificationId);
        if (nextNotifications.length !== contactRequest.notifications.length) {
            contactRequest.notifications = nextNotifications;
            removed = true;
        }
    });
    if (!removed) return response.status(404).json({ error: 'Notification not found.' });
    writeData(data);
    response.json({ ok: true });
});

app.use('/api', (_request, response) => response.status(404).json({ error: 'API endpoint not found.' }));
app.get('*', (_request, response) => response.status(404).sendFile(path.join(__dirname, '404.html')));
async function start() {
    if (process.env.RENDER && !process.env.DATABASE_URL) {
        throw new Error('Set DATABASE_URL to an external PostgreSQL database before starting on Render. Local files do not survive redeploys.');
    }
    await store.initialize();
    app.listen(port, '0.0.0.0', () => console.log(`Crimson Creations is running on port ${port}`));
}
start().catch(error => {
    console.error(process.env.DATABASE_URL ? `Database startup failed (${error.code || error.name}). Check DATABASE_URL and database availability.` : error.message);
    process.exitCode = 1;
    store.close();
});
