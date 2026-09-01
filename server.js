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
const configuredAdminEmails = (process.env.CRIMSON_ADMIN_EMAILS || '').split(',').map(normalizeEmail).filter(Boolean);
const secureCookie = process.env.NODE_ENV === 'production' ? '; Secure' : '';
const authAttempts = new Map();
const contactAttempts = new Map();

app.use(express.json({ limit: '100kb' }));
app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; font-src 'self' https://cdnjs.cloudflare.com; img-src 'self' data: https:; connect-src 'self'; form-action 'self'");
    if (process.env.NODE_ENV === 'production') response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});
app.use((request, response, next) => request.path === '/data.json' ? response.sendStatus(404) : next());
app.use(express.static(__dirname));

function readData() {
    try {
        const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        return { accounts: [], projects: [], admins: [], comments: {}, ratings: {}, contactRequests: [], ...data };
    } catch {
        return { accounts: [], projects: [], admins: [], comments: {}, ratings: {}, contactRequests: [] };
    }
}

function writeData(data) {
    const temporaryPath = `${dataPath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(data, null, 2));
    fs.renameSync(temporaryPath, dataPath);
}

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
    return { firstName: account.firstName, lastName: account.lastName, email, role: isOwner ? 'owner' : isAdmin ? 'admin' : 'client' };
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

app.get('/api/auth/me', (request, response) => response.json({ account: publicAccount(currentAccount(request)) }));

app.post('/api/auth/signup', async (request, response) => {
    if (!allowAuthAttempt(request, response)) return;
    const { firstName, lastName, email, password } = request.body || {};
    const normalizedEmail = normalizeEmail(email);
    if (!firstName || !lastName || !normalizedEmail || typeof password !== 'string' || password.length < 8) return response.status(400).json({ error: 'Use a name, valid email, and password with at least 8 characters.' });
    const data = readData();
    if (data.accounts.some(account => normalizeEmail(account.email) === normalizedEmail)) return response.status(409).json({ error: 'That email already has an account.' });
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const account = { id: crypto.randomBytes(12).toString('hex'), firstName: String(firstName).trim(), lastName: String(lastName).trim(), email: normalizedEmail, verifiedAt: null, verificationTokenHash: hashToken(verificationToken), verificationExpiresAt: Date.now() + 24 * 60 * 60 * 1000, ...hashPassword(password) };
    data.accounts.push(account);
    let verificationResult;
    try { verificationResult = await sendVerificationEmail(normalizedEmail, verificationToken); } catch { verificationResult = { ok: false, error: 'The email service could not be reached.' }; }
    if (!verificationResult.ok) return response.status(503).json({ error: verificationResult.error });
    if (!data.sessions) data.sessions = [];
    writeData(data);
    response.status(201).json({ message: 'Check your email to verify the account before signing in. If you do not see it, check your Spam or Junk folder.' });
});

app.get('/api/auth/verify', (request, response) => {
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
    response.redirect('/portal.html?verified=1');
});

app.post('/api/auth/signin', (request, response) => {
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

app.post('/api/auth/signout', (request, response) => {
    const token = request.headers.cookie?.match(/crimson_session=([^;]+)/)?.[1];
    if (token) { const data = readData(); data.sessions = (data.sessions || []).filter(session => session.tokenHash !== hashToken(token)); writeData(data); }
    response.setHeader('Set-Cookie', `crimson_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookie}`);
    response.json({ ok: true });
});

app.get('/api/projects', (_request, response) => {
    const data = readData();
    const projects = data.projects.map(project => {
        const ratings = Object.values(data.ratings[project.id] || {});
        return { ...project, rating: ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : 0, ratingCount: ratings.length };
    });
    response.json({ projects });
});

app.get('/api/projects/:id/feedback', (request, response) => {
    const data = readData();
    if (!data.projects.some(project => project.id === request.params.id)) return response.status(404).json({ error: 'Project not found.' });
    const comments = Array.isArray(data.comments[request.params.id]) ? data.comments[request.params.id] : [];
    const viewer = currentAccount(request);
    const viewerIsAdmin = viewer && publicAccount(viewer).role === 'admin';
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

app.put('/api/projects/:id/feedback/rating', (request, response) => {
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

app.post('/api/projects/:id/feedback/comments', (request, response) => {
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

app.delete('/api/projects/:id/feedback/comments/:commentId', (request, response) => {
    const account = requireAccount(request, response);
    if (!account) return;
    const data = readData();
    if (!data.projects.some(project => project.id === request.params.id)) return response.status(404).json({ error: 'Project not found.' });
    const comments = Array.isArray(data.comments[request.params.id]) ? data.comments[request.params.id] : [];
    const comment = comments.find(item => item.id === request.params.commentId);
    const isAdmin = publicAccount(account).role === 'admin';
    if (!comment) return response.status(404).json({ error: 'Comment not found.' });
    if (!isAdmin && normalizeEmail(comment.email) !== normalizeEmail(account.email)) return response.status(403).json({ error: 'You can only delete your own comment.' });
    data.comments[request.params.id] = comments.filter(item => item.id !== request.params.commentId);
    writeData(data);
    response.json({ ok: true });
});

app.post('/api/projects', (request, response) => {
    if (!requireAccount(request, response, true)) return;
    const project = { ...request.body, id: request.body?.id || `project-${Date.now()}-${crypto.randomBytes(4).toString('hex')}` };
    const data = readData(); data.projects.push(project); writeData(data);
    response.status(201).json({ project });
});

app.put('/api/projects/:id', (request, response) => {
    if (!requireAccount(request, response, true)) return;
    const data = readData(); const index = data.projects.findIndex(project => project.id === request.params.id);
    if (index < 0) return response.status(404).json({ error: 'Project not found.' });
    data.projects[index] = { ...request.body, id: request.params.id }; writeData(data);
    response.json({ project: data.projects[index] });
});

app.delete('/api/projects/:id', (request, response) => {
    if (!requireAccount(request, response, true)) return;
    const data = readData(); const nextProjects = data.projects.filter(project => project.id !== request.params.id);
    if (nextProjects.length === data.projects.length) return response.status(404).json({ error: 'Project not found.' });
    data.projects = nextProjects; writeData(data); response.json({ ok: true });
});

app.get('/api/admins', (request, response) => {
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

app.post('/api/admins', (request, response) => {
    if (!requireAccount(request, response, true)) return;
    const email = normalizeEmail(request.body?.email);
    if (!email) return response.status(400).json({ error: 'A valid email is required.' });
    const data = readData();
    const targetAccount = data.accounts.find(item => normalizeEmail(item.email) === email);
    if (!targetAccount || !targetAccount.verifiedAt) return response.status(403).json({ error: 'That person must verify their email before receiving administrator access.' });
    if (!data.admins.some(admin => admin.accountId === targetAccount.id)) data.admins.push({ accountId: targetAccount.id, name: String(request.body.name || `${targetAccount.firstName} ${targetAccount.lastName}`).trim(), email });
    writeData(data); response.status(201).json({ ok: true });
});

app.delete('/api/admins/:accountId', (request, response) => {
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
app.post('/api/contact', async (request, response) => {
    const key = request.ip || 'unknown';
    const now = Date.now();
    const attempts = (contactAttempts.get(key) || []).filter(timestamp => now - timestamp < 60 * 60 * 1000);
    if (attempts.length >= 5) return response.status(429).json({ message: 'Too many requests. Please try again later.' });
    attempts.push(now); contactAttempts.set(key, attempts);
    if (request.body.botcheck) return response.json({ success: true });
    const data = readData();
    const signedInAccount = currentAccount(request);
    const contactRequest = {
        id: crypto.randomBytes(12).toString('hex'),
        accountEmail: normalizeEmail(signedInAccount?.email),
        name: String(request.body.name || '').trim().slice(0, 120),
        business: String(request.body.business || '').trim().slice(0, 160),
        email: normalizeEmail(request.body.email).slice(0, 200),
        phone: String(request.body.phone || '').trim().slice(0, 80),
        budget: String(request.body.budget || '').trim().slice(0, 120),
        pages: String(request.body.pages || '').trim().slice(0, 300),
        details: String(request.body.details || '').trim().slice(0, 4000),
        projectGoal: String(request.body.project_goal || '').trim().slice(0, 1000),
        projectStyle: String(request.body.project_style || '').trim().slice(0, 1000),
        projectPages: String(request.body.project_pages || '').trim().slice(0, 1000),
        projectTimeline: String(request.body.project_timeline || '').trim().slice(0, 1000),
        status: 'pending',
        progress: 0,
        notifications: [],
        createdAt: new Date().toISOString()
    };
    data.contactRequests.push(contactRequest);
    writeData(data);
    const recipient = configuredAdminEmails[0];
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL || !recipient) {
        return response.status(503).json({ success: false, message: 'The contact form is not configured yet.' });
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
            return response.status(502).json({ success: false, message: 'The contact service could not accept the request.' });
        }
        response.json({ success: true, message: 'Request sent.' });
    } catch (error) {
        console.error(`Resend contact request failed: ${error.message}`);
        response.status(502).json({ success: false, message: 'The contact service is temporarily unavailable.' });
    }
});

app.get('/api/contact-requests', (request, response) => {
    if (!requireAccount(request, response, true)) return;
    const data = readData();
    response.json({ requests: (data.contactRequests || []).map(item => ({
        ...item,
        progress: Number.isFinite(Number(item.progress)) ? Math.max(0, Math.min(100, Number(item.progress))) : 0,
        notifications: Array.isArray(item.notifications) ? item.notifications : []
    })).sort((first, second) => new Date(first.createdAt) - new Date(second.createdAt)) });
});

app.get('/api/my-workspace', (request, response) => {
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

app.patch('/api/contact-requests/:id', (request, response) => {
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

app.delete('/api/contact-requests/:id', (request, response) => {
    if (!requireAccount(request, response, true)) return;
    const data = readData();
    const requests = data.contactRequests || [];
    const nextRequests = requests.filter(item => item.id !== request.params.id);
    if (nextRequests.length === requests.length) return response.status(404).json({ error: 'Request not found.' });
    data.contactRequests = nextRequests;
    writeData(data);
    response.json({ ok: true });
});

app.delete('/api/my-workspace/notifications/:notificationId', (request, response) => {
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
app.get('*', (_request, response) => response.sendFile(path.join(__dirname, 'index.html')));
app.listen(port, '0.0.0.0', () => console.log(`Crimson Creations is running on port ${port}`));
