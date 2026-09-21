(() => {
    const recoveryForm = document.getElementById('recovery-form');
    const recoveryStatus = document.getElementById('recovery-status');
    const setBusy = (form, busy) => form.querySelectorAll('button').forEach(button => { button.disabled = busy; });
    recoveryForm?.addEventListener('submit', async event => {
        event.preventDefault();
        const action = event.submitter?.value || 'forgot-password';
        setBusy(recoveryForm, true);
        recoveryStatus.textContent = 'Requesting your email…';
        try {
            const result = await apiRequest(`/api/auth/${action}`, { method: 'POST', body: JSON.stringify({ email: document.getElementById('recovery-email').value.trim() }) });
            recoveryStatus.textContent = result.message;
        } catch (error) { recoveryStatus.textContent = error.message; }
        finally { setBusy(recoveryForm, false); }
    });

    const resetForm = document.getElementById('reset-form');
    let resetToken = null;
    const openResetLink = () => {
        const token = new URLSearchParams(window.location.hash.slice(1)).get('reset');
        if (token === null) return;
        resetToken = token;
        passwordResetRequested = true;
        history.replaceState(null, '', window.location.pathname + window.location.search);
        document.getElementById('reset-panel').hidden = false;
        portalSigninCard.hidden = true;
        portalPreview.hidden = true;
        portalSignupPanel.hidden = true;
        portalLayout.classList.add('signed-out');
        document.getElementById('reset-password').focus();
    };
    openResetLink();
    window.addEventListener('hashchange', openResetLink);
    resetForm?.addEventListener('submit', async event => {
        event.preventDefault();
        const status = document.getElementById('reset-status');
        const password = document.getElementById('reset-password').value;
        if (password !== document.getElementById('reset-confirm').value) { status.textContent = 'The passwords do not match.'; return; }
        setBusy(resetForm, true);
        status.textContent = 'Updating your password…';
        try {
            const result = await apiRequest('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: resetToken, password }) });
            resetToken = null;
            passwordResetRequested = false;
            resetForm.reset();
            currentSession = null;
            document.getElementById('reset-panel').hidden = true;
            showSigninPanel();
            portalStatus.textContent = result.message;
            document.getElementById('portal-email').focus();
        } catch (error) { status.textContent = error.message; }
        finally { setBusy(resetForm, false); }
    });

    const form = document.getElementById('backup-form');
    if (!form) return;
    const status = document.getElementById('backup-status');
    const fileInput = document.getElementById('backup-file');
    const review = document.getElementById('restore-review');
    let selectedBackup = null;
    const credentials = () => ({ password: document.getElementById('backup-password').value, passphrase: document.getElementById('backup-passphrase').value });
    const post = (route, extra = {}) => apiRequest(`/api/backups/${route}`, { method: 'POST', body: JSON.stringify({ ...credentials(), ...extra }) });
    const download = (backup, prefix = 'crimson-backup') => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    };
    const run = async task => {
        if (!form.reportValidity()) return;
        setBusy(form, true);
        try { await task(); }
        catch (error) { status.textContent = error.message; }
        finally { setBusy(form, false); }
    };
    form.addEventListener('submit', event => event.preventDefault());
    portalSignout?.addEventListener('click', () => {
        form.reset();
        selectedBackup = null;
        review.hidden = true;
        status.textContent = '';
    });
    for (const input of [fileInput, document.getElementById('backup-passphrase')]) input.addEventListener('input', () => {
        selectedBackup = null;
        review.hidden = true;
        document.getElementById('restore-confirm').value = '';
    });
    document.getElementById('backup-download').addEventListener('click', () => run(async () => {
        status.textContent = 'Preparing your encrypted backup…';
        download((await post('export')).backup);
        status.textContent = 'Backup download started. Keep the file safe and store its passphrase separately.';
    }));
    document.getElementById('backup-preview').addEventListener('click', () => run(async () => {
        selectedBackup = null;
        review.hidden = true;
        const file = fileInput.files[0];
        if (!file) throw new Error('Choose a backup file first.');
        if (file.size > 12 * 1024 * 1024) throw new Error('Choose a backup smaller than 12 MB.');
        let backup;
        try { backup = JSON.parse(await file.text()); }
        catch { throw new Error('This is not a valid backup file.'); }
        status.textContent = 'Checking the backup…';
        const preview = await post('preview', { backup });
        selectedBackup = backup;
        document.getElementById('restore-summary').textContent = `Backup from ${new Date(preview.createdAt).toLocaleString()}: ${preview.projects} projects, ${preview.accounts} accounts, ${preview.requests} requests.`;
        document.getElementById('restore-confirm').value = '';
        review.hidden = false;
        status.textContent = 'Backup checked. Review the replacement details before restoring.';
    }));
    document.getElementById('backup-restore').addEventListener('click', () => run(async () => {
        if (!selectedBackup || document.getElementById('restore-confirm').value !== 'RESTORE') throw new Error('Preview a backup and type RESTORE to continue.');
        status.textContent = 'Saving a backup of the current data…';
        download((await post('export')).backup, 'crimson-before-restore');
        status.textContent = 'Restoring your backup…';
        const result = await post('restore', { backup: selectedBackup, confirmation: 'RESTORE' });
        form.reset();
        selectedBackup = null;
        review.hidden = true;
        currentSession = null;
        portalPreview.hidden = true;
        portalLayout.classList.add('signed-out');
        showSigninPanel();
        portalStatus.textContent = result.message;
        document.getElementById('portal-email').focus();
    }));
})();
