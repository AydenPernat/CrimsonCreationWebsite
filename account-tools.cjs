const crypto = require('node:crypto');

function backupData(data) {
    const copy = structuredClone(data);
    copy.sessions = [];
    for (const account of copy.accounts) {
        for (const key of ['verificationTokenHash', 'verificationExpiresAt', 'resetTokenHash', 'resetExpiresAt']) delete account[key];
    }
    return copy;
}

function encryptBackup(data, passphrase) {
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', crypto.scryptSync(passphrase, salt, 32), iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ createdAt: new Date().toISOString(), data: backupData(data) })), cipher.final()]);
    return { format: 'crimson-backup', version: 1, salt: salt.toString('hex'), iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), ciphertext: ciphertext.toString('base64') };
}

function decryptBackup(backup, passphrase) {
    if (backup?.format !== 'crimson-backup' || backup.version !== 1 ||
        !/^[a-f0-9]{32}$/.test(backup.salt) || !/^[a-f0-9]{24}$/.test(backup.iv) || !/^[a-f0-9]{32}$/.test(backup.tag) ||
        typeof backup.ciphertext !== 'string' || backup.ciphertext.length > 12 * 1024 * 1024) throw new Error('Invalid backup');
    const decipher = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(passphrase, Buffer.from(backup.salt, 'hex'), 32), Buffer.from(backup.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(backup.tag, 'hex'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(backup.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
}

function validateBackup(snapshot) {
    const data = snapshot?.data;
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    const records = value => Array.isArray(value) && value.every(object);
    if (!object(data) || !Number.isFinite(Date.parse(snapshot.createdAt)) ||
        !['accounts', 'projects', 'admins', 'contactRequests'].every(key => records(data[key])) ||
        !object(data.comments) || !object(data.ratings)) throw new Error('Invalid backup data');
    const walk = (value, depth = 0) => {
        if (depth > 12) throw new Error('Invalid backup depth');
        if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
            if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid backup key');
            walk(child, depth + 1);
        }
    };
    walk(data);
    const unique = (items, key) => new Set(items.map(item => item[key])).size === items.length;
    if (!unique(data.accounts, 'id') || !unique(data.accounts, 'email') || !unique(data.projects, 'id')) throw new Error('Duplicate records');
    for (const account of data.accounts) {
        if (!['id', 'firstName', 'lastName', 'email'].every(key => typeof account[key] === 'string') ||
            !account.id || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email) || account.email !== account.email.trim().toLowerCase() ||
            !/^[a-f0-9]{128}$/.test(account.passwordHash || account.hash) || !/^[a-f0-9]{32}$/.test(account.passwordSalt || account.salt) ||
            (account.verifiedAt !== null && !Number.isFinite(Date.parse(account.verifiedAt)))) throw new Error('Invalid account');
    }
    for (const project of data.projects) {
        if (typeof project.id !== 'string' || !project.id || !['name', 'description', 'ownerEmail'].every(key => typeof project[key] === 'string') ||
            !['website', 'game'].includes(project.projectType) || Object.values(project).some(value => typeof value !== 'string')) throw new Error('Invalid project');
        if (project.link && !['http:', 'https:'].includes(new URL(project.link).protocol)) throw new Error('Invalid project URL');
    }
    for (const admin of data.admins) if (!data.accounts.some(account => account.id === admin.accountId && account.verifiedAt)) throw new Error('Invalid administrator');
    for (const comments of Object.values(data.comments)) {
        if (!records(comments) || comments.some(comment => !['id', 'email', 'name', 'subject', 'message', 'createdAt'].every(key => typeof comment[key] === 'string'))) throw new Error('Invalid comments');
    }
    for (const ratings of Object.values(data.ratings)) if (!object(ratings) || Object.values(ratings).some(rating => !Number.isInteger(rating) || rating < 1 || rating > 5)) throw new Error('Invalid ratings');
    for (const request of data.contactRequests) {
        if (!['id', 'email', 'name', 'business', 'details', 'createdAt'].every(key => typeof request[key] === 'string') ||
            !['pending', 'confirmed', 'completed'].includes(request.status) || !Number.isInteger(request.progress) || request.progress < 0 || request.progress > 100 ||
            !records(request.notifications) || request.notifications.some(note => !['id', 'message', 'createdAt'].every(key => typeof note[key] === 'string'))) throw new Error('Invalid request');
    }
    return backupData(data);
}

function registerAccountTools({ api, readData, writeData, requireAccount, normalizeEmail, hashToken, hashPassword, passwordMatches, configuredAdminEmails, sendVerificationEmail, secureCookie, port }) {
    const attempts = new Map();
    function allowed(request, response, group, limit = 10) {
        const now = Date.now();
        // Expire old entries so random email addresses cannot grow this map forever.
        for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
        const key = `${group}:${request.ip}`;
        const entry = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
        if (entry.count >= limit) { response.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' }); return false; }
        entry.count++;
        attempts.set(key, entry);
        return true;
    }
    const genericMessage = { message: 'If that account is eligible, an email is on its way. Check your inbox and spam folder. Wait a minute before requesting another link.' };
    for (const kind of ['forgot-password', 'resend-verification']) api('post', `/api/auth/${kind}`, async (request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        if (!allowed(request, response, 'recovery')) return;
        const email = normalizeEmail(request.body?.email);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return response.status(400).json({ error: 'Enter a valid email address.' });
        if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) return response.status(503).json({ error: 'Email delivery is temporarily unavailable.' });
        const reset = kind === 'forgot-password';
        const account = readData().accounts.find(item => item.email === email && Boolean(item.verifiedAt) === reset);
        const sentKey = reset ? 'resetSentAt' : 'verificationSentAt';
        if (!account || Date.now() - (account[sentKey] || 0) < 60000) return response.json(genericMessage);
        const token = crypto.randomBytes(32).toString('hex');
        let sent = false;
        try {
            if (reset) {
                const url = new URL('/portal', process.env.CRIMSON_PUBLIC_URL || `http://localhost:${port}`);
                url.hash = `reset=${token}`;
                const result = await fetch('https://api.resend.com/emails', {
                    method: 'POST', signal: AbortSignal.timeout(15000),
                    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL, to: [email], subject: 'Reset your Crimson Creations password',
                        text: `Reset your password: ${url}\n\nThis link expires in 30 minutes and works once. If you did not request this, ignore this email.` })
                });
                sent = result.ok;
            } else sent = (await sendVerificationEmail(email, token)).ok;
        } catch { /* Keep the response identical for unknown and eligible accounts. */ }
        if (sent) {
            const data = readData();
            const current = data.accounts.find(item => item.id === account.id);
            if (current && current.passwordHash === account.passwordHash && Boolean(current.verifiedAt) === reset) {
                current[reset ? 'resetTokenHash' : 'verificationTokenHash'] = hashToken(token);
                current[reset ? 'resetExpiresAt' : 'verificationExpiresAt'] = Date.now() + (reset ? 30 * 60 * 1000 : 24 * 60 * 60 * 1000);
                current[sentKey] = Date.now();
                writeData(data);
            }
        } else console.error(`Account recovery email delivery failed (${kind}).`);
        response.json(genericMessage);
    });

    api('post', '/api/auth/reset-password', (request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        if (!allowed(request, response, 'reset')) return;
        const { token, password } = request.body || {};
        if (typeof password !== 'string' || password.length < 8 || password.length > 128) return response.status(400).json({ error: 'Use a password between 8 and 128 characters.' });
        if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return response.status(400).json({ error: 'This reset link is invalid or expired. Request a new one.' });
        const data = readData();
        const account = data.accounts.find(item => item.verifiedAt && item.resetTokenHash === hashToken(token) && item.resetExpiresAt > Date.now());
        if (!account) return response.status(400).json({ error: 'This reset link is invalid or expired. Request a new one.' });
        Object.assign(account, hashPassword(password));
        delete account.hash;
        delete account.salt;
        delete account.resetTokenHash;
        delete account.resetExpiresAt;
        data.sessions = (data.sessions || []).filter(session => session.accountId !== account.id);
        writeData(data);
        response.setHeader('Set-Cookie', `crimson_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookie}`);
        response.json({ message: 'Password updated. Sign in with your new password. Previous sign-ins have been cleared.' });
    });

    function ownerAccess(request, response) {
        response.setHeader('Cache-Control', 'no-store');
        const account = requireAccount(request, response, true);
        if (!account) return null;
        if (!configuredAdminEmails.includes(normalizeEmail(account.email))) { response.status(403).json({ error: 'Only the site owner can manage backups.' }); return null; }
        if (!allowed(request, response, 'backup', 20)) return null;
        const password = request.body?.password;
        if (typeof password !== 'string' || password.length > 128 || !passwordMatches(password, account)) { response.status(403).json({ error: 'Enter your current account password.' }); return null; }
        const passphrase = request.body?.passphrase;
        if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 256) { response.status(400).json({ error: 'Use a backup passphrase between 12 and 256 characters.' }); return null; }
        return account;
    }

    api('post', '/api/backups/export', (request, response) => {
        if (!ownerAccess(request, response)) return;
        const backup = encryptBackup(readData(), request.body.passphrase);
        if (JSON.stringify(backup).length > 12 * 1024 * 1024) return response.status(413).json({ error: 'This site is too large for browser backups. Use a database export.' });
        response.json({ backup });
    });
    for (const action of ['preview', 'restore']) api('post', `/api/backups/${action}`, (request, response) => {
        const owner = ownerAccess(request, response);
        if (!owner) return;
        let snapshot, data;
        try {
            snapshot = decryptBackup(request.body.backup, request.body.passphrase);
            data = validateBackup(snapshot);
        } catch { return response.status(400).json({ error: 'Cannot open this backup. Check the passphrase and use a valid, unmodified Crimson backup file.' }); }
        if (!data.accounts.some(account => account.id === owner.id && account.email === owner.email)) return response.status(400).json({ error: 'This backup does not contain your owner account. It cannot be restored here.' });
        if (action === 'preview') return response.json({ createdAt: snapshot.createdAt, projects: data.projects.length, accounts: data.accounts.length, requests: data.contactRequests.length });
        if (request.body.confirmation !== 'RESTORE') return response.status(400).json({ error: 'Type RESTORE to confirm replacing site data.' });
        // Keep current credentials for existing users; an old backup must not revive old passwords.
        const current = readData();
        for (const account of data.accounts) {
            const existing = current.accounts.find(item => item.id === account.id && item.email === account.email);
            if (existing) {
                account.passwordHash = existing.passwordHash || existing.hash;
                account.passwordSalt = existing.passwordSalt || existing.salt;
                account.verifiedAt = existing.verifiedAt;
                delete account.hash;
                delete account.salt;
            }
        }
        // Never remove another configured owner's access while restoring.
        for (const account of current.accounts.filter(item => configuredAdminEmails.includes(normalizeEmail(item.email)))) {
            data.accounts = data.accounts.filter(item => item.id !== account.id && item.email !== account.email);
            data.accounts.push(backupData({ accounts: [account] }).accounts[0]);
        }
        writeData(data);
        response.setHeader('Set-Cookie', `crimson_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookie}`);
        response.json({ message: 'Backup restored. Sign in again. Current passwords for existing accounts have been kept.' });
    });
}

module.exports = { registerAccountTools, encryptBackup, decryptBackup, validateBackup };
