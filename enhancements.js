(() => {
    const estimator = document.getElementById('project-estimator');
    const currency = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
    if (estimator) {
        const update = () => {
            const pageInput = document.getElementById('estimate-pages');
            const pages = Math.min(30, Math.max(1, Math.round(Number(pageInput.value) || 1)));
            pageInput.value = String(pages);
            const base = pages <= 3 ? 800 : pages <= 6 ? 1100 : 1600 + Math.max(0, pages - 7) * 150;
            document.getElementById('estimate-scope').textContent = `${pages} page${pages === 1 ? '' : 's'}: from ${currency(base)}`;
            const selected = [...estimator.querySelectorAll('input:checked')];
            const total = base + selected.reduce((sum, input) => sum + Number(input.value), 0);
            document.getElementById('estimate-total').value = currency(total);
            const params = new URLSearchParams({ estimate: String(total), pages: String(pages), tier: `${pages}-page website`, features: selected.map(input => input.dataset.feature).join(', ') });
            document.getElementById('estimate-brief-link').href = `/contact?${params}`;
        };
        estimator.addEventListener('change', update);
        estimator.querySelectorAll('[data-page-step]').forEach(button => button.addEventListener('click', () => {
            const pageInput = document.getElementById('estimate-pages');
            pageInput.value = String(Number(pageInput.value) + Number(button.dataset.pageStep));
            update();
        }));
        estimator.addEventListener('submit', event => event.preventDefault());
        document.getElementById('estimate-brief-link').addEventListener('click', () => {
            const description = document.getElementById('estimate-description').value.trim().slice(0, 2000);
            try {
                sessionStorage.setItem('crimson_estimate_description', JSON.stringify({
                    query: new URL(document.getElementById('estimate-brief-link').href, location.origin).search,
                    description
                }));
            } catch { /* The estimator and contact form still work if browser storage is unavailable. */ }
        });
        update();
    }
    const params = new URLSearchParams(location.search);
    const contact = document.getElementById('estimate-form');
    if (contact && params.has('estimate')) {
        const amount = Number(params.get('estimate'));
        if (Number.isFinite(amount) && amount >= 0 && amount <= 1000000) {
            if (params.has('pages')) contact.elements.pages.value = String(Math.min(30, Math.max(1, Number(params.get('pages')) || 1)));
            contact.elements.budget.value = `${currency(amount)} planning estimate`;
            contact.elements.details.value = `Project: ${(params.get('tier') || 'Website').slice(0, 100)}\nFeatures: ${(params.get('features') || 'Base scope').slice(0, 500)}\n\nMy project goals: `;
            try {
                const saved = JSON.parse(sessionStorage.getItem('crimson_estimate_description') || 'null');
                sessionStorage.removeItem('crimson_estimate_description');
                if (saved?.query === location.search && typeof saved.description === 'string' && saved.description) {
                    contact.elements.details.value += saved.description.slice(0, 2000);
                }
            } catch { /* Leave the regular project-details field available. */ }
        }
    }
    const oauthButtons = [...document.querySelectorAll('[data-oauth]')];
    if (oauthButtons.length) {
        const authErrors = { unavailable: 'This sign-in provider is not available yet. Use your password.', invalid: 'Your sign-in session expired. Please try again.', cancelled: 'Provider sign-in was cancelled. You can try again.', existing: 'This email already has a portal account. Sign in with your password, then connect the provider from your dashboard.', link: 'Unable to connect this provider. Use the same verified email as your portal account.', provider: 'Unable to complete provider sign-in. Try again or use your password.' };
        const error = authErrors[params.get('authError')];
        if (error) document.querySelectorAll('[data-provider-status]').forEach(status => { status.textContent = error; });
        fetch('/api/auth/providers').then(response => {
            if (!response.ok) throw new Error('Providers unavailable');
            return response.json();
        }).then(providers => {
            oauthButtons.forEach(button => {
                const enabled = providers[button.dataset.oauth] === true;
                button.disabled = !enabled;
                if (!enabled) button.title = 'Provider setup is pending. Use your password.';
                button.addEventListener('click', () => {
                    const next = params.get('next') === 'contact' ? '?next=contact' : '';
                    location.assign(`/api/auth/oauth/${button.dataset.oauth}${next}`);
                });
            });
        }).catch(() => document.querySelectorAll('[data-provider-status]').forEach(status => { status.textContent = 'Social sign-in is temporarily unavailable.'; }));
    }
    const post = async (route, body) => {
        const response = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to complete sign-in.');
        return result;
    };
    const fragment = new URLSearchParams(location.hash.slice(1));
    const magicToken = fragment.get('magic');
    const magicPanel = document.getElementById('magic-consume-panel');
    if (magicPanel && magicToken) {
        history.replaceState(null, '', `${location.pathname}${location.search}`);
        magicPanel.hidden = false;
        magicPanel.scrollIntoView({ block: 'center', behavior: 'instant' });
        document.getElementById('magic-consume').addEventListener('click', async event => {
            const button = event.currentTarget;
            button.disabled = true;
            try { await post('/api/auth/magic-link/consume', { token: magicToken }); location.assign('/portal'); }
            catch (error) { document.getElementById('magic-consume-status').textContent = error.message; button.disabled = false; }
        });
    }
    document.querySelectorAll('[data-viewport]').forEach(button => button.addEventListener('click', () => {
        const frame = document.getElementById('project-preview-frame');
        if (frame) frame.style.width = `${button.dataset.viewport}px`;
        document.querySelectorAll('[data-viewport]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
    }));
})();
