const menuButton = document.getElementById('menu-toggle');
const menuIcon = document.getElementById('bar');
const nav = document.getElementById('navbar');
const header = document.querySelector('.site-header');

function setMenuState(isOpen) {
    if (!menuButton || !menuIcon || !nav) return;

    const wasOpen = nav.classList.contains('active');
    nav.classList.toggle('active', isOpen);
    menuButton.classList.toggle('is-open', isOpen);
    menuButton.classList.toggle('is-closing', !isOpen && wasOpen);
    menuButton.setAttribute('aria-expanded', String(isOpen));
    menuButton.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
    menuIcon.classList.toggle('fa-bars', !isOpen);
    menuIcon.classList.toggle('fa-xmark', isOpen);

    if (!isOpen && wasOpen) {
        window.setTimeout(() => menuButton.classList.remove('is-closing'), 350);
    }
}

if (menuButton && nav) {
    menuButton.addEventListener('click', () => {
        setMenuState(!nav.classList.contains('active'));
    });

    nav.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => setMenuState(false));
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            setMenuState(false);
        }
    });
}

if (header) {
    const updateHeader = () => {
        header.classList.toggle('is-scrolled', window.scrollY > 12);
    };

    updateHeader();
    window.addEventListener('scroll', updateHeader, { passive: true });
}

const revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            revealObserver.unobserve(entry.target);
        }
    });
}, {
    threshold: 0.15,
    rootMargin: document.body.classList.contains('about-page') ? '0px 0px -12% 0px' : '0px 0px -8% 0px'
});

document.querySelectorAll('.reveal-on-scroll').forEach((element, index) => {
    element.style.setProperty('--reveal-delay', `${Math.min(index * 70, 420)}ms`);
    revealObserver.observe(element);
});

function animateCounter(counter, target) {
    const startValue = Number(counter.textContent || 0);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion) {
        counter.textContent = target;
        return;
    }

    const startTime = performance.now();
    const delay = target <= 10 ? 220 : 820;
    const duration = target <= 10 ? 2600 : 6000;

    const animateCounter = currentTime => {
        const elapsed = currentTime - startTime - delay;
        const progress = Math.max(0, Math.min(elapsed / duration, 1));
        const easedProgress = target <= 1
            ? progress
            : target <= 10
            ? progress < 0.76
                ? (progress / 0.76) * ((target - 1) / Math.max(target, 1))
                : ((target - 1) / Math.max(target, 1)) +
                  (1 - Math.pow(1 - ((progress - 0.76) / 0.24), 2)) / Math.max(target, 1)
            : progress < 0.5
                ? 16 * Math.pow(progress, 5)
                : 1 - Math.pow(-2 * progress + 2, 6) / 2;
        counter.textContent = Math.floor(startValue + easedProgress * (target - startValue));
        if (elapsed < duration) requestAnimationFrame(animateCounter);
    };

    requestAnimationFrame(animateCounter);
}

document.querySelectorAll('[data-counter]').forEach(counter => animateCounter(counter, Number(counter.dataset.counter || 0)));

const cursorGlow = document.querySelector('.cursor-glow') || document.body.appendChild(Object.assign(document.createElement('div'), {
    className: 'cursor-glow',
    ariaHidden: 'true'
}));

if (cursorGlow && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const touchTrail = document.body.appendChild(Object.assign(document.createElement('canvas'), {
        className: 'touch-trail-canvas',
        ariaHidden: 'true'
    }));
    const trailContext = touchTrail.getContext('2d');
    let trailPoint = null;
    let trailFadeTimer;

    const resizeTouchTrail = () => {
        const scale = window.devicePixelRatio || 1;
        touchTrail.width = Math.floor(window.innerWidth * scale);
        touchTrail.height = Math.floor(window.innerHeight * scale);
        touchTrail.style.width = `${window.innerWidth}px`;
        touchTrail.style.height = `${window.innerHeight}px`;
        trailContext.setTransform(scale, 0, 0, scale, 0, 0);
    };
    const clearTouchTrail = () => trailContext.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const startTouchTrail = (x, y) => {
        window.clearTimeout(trailFadeTimer);
        touchTrail.classList.remove('is-fading');
        clearTouchTrail();
        trailPoint = { x, y };
        drawTouchBloom(x, y);
    };
    const drawTouchBloom = (x, y) => {
        const radius = 110;
        const bloom = trailContext.createRadialGradient(x, y, 0, x, y, radius);
        bloom.addColorStop(0, 'rgba(225, 6, 27, 0.1)');
        bloom.addColorStop(0.42, 'rgba(225, 6, 27, 0.04)');
        bloom.addColorStop(1, 'rgba(225, 6, 27, 0)');
        trailContext.beginPath();
        trailContext.arc(x, y, radius, 0, Math.PI * 2);
        trailContext.fillStyle = bloom;
        trailContext.fill();
    };
    const extendTouchTrail = (x, y) => {
        if (!trailPoint) return;
        const distance = Math.hypot(x - trailPoint.x, y - trailPoint.y);
        const steps = Math.max(1, Math.ceil(distance / 28));
        for (let step = 1; step <= steps; step += 1) {
            const progress = step / steps;
            drawTouchBloom(
                trailPoint.x + (x - trailPoint.x) * progress,
                trailPoint.y + (y - trailPoint.y) * progress
            );
        }
        trailPoint = { x, y };
    };
    const finishTouchTrail = () => {
        trailPoint = null;
        touchTrail.classList.add('is-fading');
        trailFadeTimer = window.setTimeout(() => {
            clearTouchTrail();
            touchTrail.classList.remove('is-fading');
        }, 500);
    };
    const firstTouch = event => event.touches[0];
    const handleTouchStart = event => {
        const touch = firstTouch(event);
        if (!touch) return;
        cursorGlow.classList.add('is-touching');
        cursorGlow.style.setProperty('--cursor-x', `${touch.clientX}px`);
        cursorGlow.style.setProperty('--cursor-y', `${touch.clientY}px`);
        startTouchTrail(touch.clientX, touch.clientY);
    };
    const handleTouchMove = event => {
        const touch = firstTouch(event);
        if (!touch || !trailPoint) return;
        cursorGlow.classList.add('is-touching');
        cursorGlow.style.setProperty('--cursor-x', `${touch.clientX}px`);
        cursorGlow.style.setProperty('--cursor-y', `${touch.clientY}px`);
        extendTouchTrail(touch.clientX, touch.clientY);
    };
    const handleTouchEnd = () => {
        cursorGlow.classList.remove('is-touching');
        finishTouchTrail();
    };

    resizeTouchTrail();
    window.addEventListener('resize', resizeTouchTrail, { passive: true });
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    window.addEventListener('pointermove', event => {
        if (event.pointerType === 'touch') return;
        cursorGlow.style.setProperty('--cursor-x', `${event.clientX}px`);
        cursorGlow.style.setProperty('--cursor-y', `${event.clientY}px`);
    }, { passive: true });
}

const guidanceCopy = document.getElementById('guidance-copy');
const guidanceTabs = [...document.querySelectorAll('[data-guidance]')];
const guidanceFields = [...document.querySelectorAll('[data-guidance-field], .guidance-field')];

if (guidanceCopy && guidanceTabs.length > 0 && guidanceFields.length > 0) {
    guidanceTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            guidanceTabs.forEach(otherTab => {
                const isActive = otherTab === tab;
                otherTab.classList.toggle('is-active', isActive);
                otherTab.setAttribute('aria-selected', String(isActive));
            });

            guidanceFields.forEach(field => {
                field.hidden = field.id !== `guidance-${tab.dataset.guidance}`;
            });

            const activeField = document.getElementById(`guidance-${tab.dataset.guidance}`);
            const activeLabel = guidanceCopy.querySelector('.guidance-label');
            if (activeLabel && activeField) {
                activeLabel.textContent = tab.textContent.trim();
                activeLabel.setAttribute('for', activeField.id);
                activeField.focus();
            }
        });
    });
}

const portalForm = document.getElementById('portal-form');
const portalStatus = document.getElementById('portal-status');
const portalPreview = document.getElementById('portal-preview');
const portalSignup = document.getElementById('portal-signup');
const portalLayout = document.getElementById('portal-layout');
const portalSignupPanel = document.getElementById('portal-signup-panel');
const portalSignupForm = document.getElementById('portal-signup-form');
const portalSignupStatus = document.getElementById('portal-signup-status');
const portalBackToSignin = document.getElementById('portal-back-to-signin');
const portalSignout = document.getElementById('portal-signout');
const portalSigninCard = portalForm?.closest('.portal-card');
let currentSession = null;
const apiRequest = async (url, options = {}) => {
    let response;
    try {
        response = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    } catch {
        throw new Error('The site connection is unavailable. Start the local server and try again.');
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'The request could not be completed.');
    return body;
};
const isSignedIn = () => Boolean(currentSession);
const normalizeEmail = email => String(email || '').trim().toLowerCase();
const getAccount = () => currentSession;
let projectCache = [];
let projectLoadFailed = false;
const ADMIN_CACHE_TTL = 5 * 60 * 1000;
const getAdmins = () => {
    try {
        const stored = JSON.parse(localStorage.getItem('crimsonAdmins') || '{}');
        if (!stored || !Array.isArray(stored.admins) || Date.now() - Number(stored.savedAt) > ADMIN_CACHE_TTL) return [];
        return stored.admins;
    } catch {
        return [];
    }
};
const isAdminAccount = account => ['admin', 'owner'].includes(account?.role);
const isOwnerAccount = account => account?.role === 'owner';
const currentAccountIsAdmin = () => isAdminAccount(getAccount());

function accountInitials(account) {
    return `${account.firstName?.[0] || ''}${account.lastName?.[0] || ''}`.toUpperCase() || 'CC';
}

function showPortalPreview() {
    const account = getAccount() || { firstName: 'Client', lastName: '', email: 'Not connected' };
    const fullName = `${account.firstName || ''} ${account.lastName || ''}`.trim() || 'Client';
    if (portalPreview) portalPreview.hidden = false;
    if (portalSigninCard) portalSigninCard.hidden = true;
    if (portalSignupPanel) portalSignupPanel.hidden = true;
    if (portalLayout) portalLayout.classList.remove('signed-out');
    if (portalStatus) portalStatus.textContent = 'You are signed in. Your project workspace is ready.';
    document.querySelectorAll('[data-client-name]').forEach(element => element.textContent = fullName);
    document.querySelectorAll('[data-client-initials]').forEach(element => element.textContent = accountInitials(account));
    document.querySelectorAll('[data-client-email]').forEach(element => element.textContent = account.email || 'Not connected');
    document.querySelectorAll('[data-account-role]').forEach(element => element.textContent = isOwnerAccount(account) ? 'Owner' : isAdminAccount(account) ? 'Administrator' : 'Client account');
    const adminPanel = document.getElementById('admin-panel');
    if (adminPanel) adminPanel.hidden = !isAdminAccount(account);
    renderAdminProjects();
    updateProjectGridLayout();
    bindProjectCards();
    loadAdminManagement();
    loadContactRequests();
    loadWorkspaceUpdates();
}

function showSignupPanel() {
    if (portalForm) portalForm.closest('.portal-card').hidden = true;
    if (portalSignupPanel) portalSignupPanel.hidden = false;
    if (portalSignupStatus) portalSignupStatus.textContent = '';
}

function showSigninPanel() {
    if (portalSigninCard) portalSigninCard.hidden = false;
    if (portalSignupPanel) portalSignupPanel.hidden = true;
}

async function loadCurrentSession() {
    try {
        const result = await apiRequest('/api/auth/me');
        currentSession = result.account;
        updateCommentAccess();
        updateRequestAccount();
        if (currentSession) {
            localStorage.removeItem('crimsonAccount');
            showPortalPreview();
        }
    } catch {
        currentSession = null;
    }
}

loadCurrentSession();

if (portalForm && portalStatus) {
    portalForm.addEventListener('submit', async event => {
        event.preventDefault();
        portalStatus.textContent = 'Signing you in...';
        try {
            const result = await apiRequest('/api/auth/signin', { method: 'POST', body: JSON.stringify({ email: document.getElementById('portal-email')?.value, password: document.getElementById('portal-password')?.value }) });
            currentSession = result.account;
            showPortalPreview();
        } catch (error) { portalStatus.textContent = error.message; }
    });
}

if (portalSignup) portalSignup.addEventListener('click', showSignupPanel);
if (portalBackToSignin) portalBackToSignin.addEventListener('click', showSigninPanel);

document.querySelectorAll('.password-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
        const passwordInput = document.getElementById(toggle.getAttribute('aria-controls'));
        const icon = toggle.querySelector('i');
        if (!passwordInput) return;

        const isVisible = passwordInput.type === 'text';
        passwordInput.type = isVisible ? 'password' : 'text';
        toggle.setAttribute('aria-label', isVisible ? 'Show password' : 'Hide password');
        toggle.setAttribute('aria-pressed', String(!isVisible));
        icon?.classList.toggle('fa-eye', isVisible);
        icon?.classList.toggle('fa-eye-slash', !isVisible);
    });
});

if (portalSignupForm) {
    portalSignupForm.addEventListener('submit', async event => {
        event.preventDefault();
        portalSignupStatus.textContent = 'Creating your account...';
        try {
            const result = await apiRequest('/api/auth/signup', { method: 'POST', body: JSON.stringify({ firstName: document.getElementById('portal-first-name')?.value.trim(), lastName: document.getElementById('portal-last-name')?.value.trim(), email: document.getElementById('portal-signup-email')?.value.trim(), password: document.getElementById('portal-signup-password')?.value, newsletterOptIn: Boolean(document.getElementById('portal-newsletter-opt-in')?.checked) }) });
            if (!result.account) {
                portalSignupForm.reset();
                portalSignupStatus.textContent = result.message || 'Check your email to verify the account before signing in.';
                return;
            }
            currentSession = result.account;
            showPortalPreview();
        } catch (error) { portalSignupStatus.textContent = error.message; }
    });
}

if (portalSignout) {
    portalSignout.addEventListener('click', async () => {
        await apiRequest('/api/auth/signout', { method: 'POST' }).catch(() => {});
        currentSession = null;
        if (portalPreview) portalPreview.hidden = true;
        if (portalLayout) portalLayout.classList.add('signed-out');
        showSigninPanel();
        if (portalStatus) portalStatus.textContent = 'You have been signed out.';
    });
}

const ratingButtons = [...document.querySelectorAll('.rating-button')];
const commentForm = document.getElementById('comment-form');
const commentStatus = document.getElementById('comment-status');
const ratingValues = [...document.querySelectorAll('[data-rating-value]')];
const ratingCounts = [...document.querySelectorAll('[data-rating-count]')];
const summaryStars = [...document.querySelectorAll('.rating-summary .stars')];
const commentSubmit = commentForm?.querySelector('button[type="submit"]');
const commentAccountLink = null;
const commentList = document.querySelector('.comment-list');
const commentViewMore = document.querySelector('[data-comment-view-more]');
const ratingNotes = [...document.querySelectorAll('.rating-widget .comment-note')];
const projectQueryId = new URLSearchParams(window.location.search).get('projectId');
const projectQueryName = new URLSearchParams(window.location.search).get('project');
const savedDetailProject = projectQueryId
    ? getProjects().find(project => project.id === projectQueryId)
    : projectQueryName ? getProjects().find(project => project.name === projectQueryName) : null;
let projectOwnerEmail = normalizeEmail(document.body.dataset.ownerEmail || savedDetailProject?.ownerEmail);
let projectStorageId = document.body.dataset.projectKey || projectQueryId || savedDetailProject?.id || projectQueryName?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'project';

function updateCommentAccess() {
    if (!isSignedIn()) return;

    const account = getAccount();
    const name = account ? `${account.firstName || ''} ${account.lastName || ''}`.trim() : 'your account';
    if (commentSubmit) commentSubmit.textContent = 'Post comment';
    if (commentAccountLink) commentAccountLink.hidden = true;
    ratingNotes.forEach(note => note.textContent = `Signed in as ${name}. You can rate this project.`);
    if (commentStatus && commentStatus.textContent.includes('account')) {
        commentStatus.textContent = `Signed in as ${name}. Add a subject and comment below.`;
    }
    if (projectDetail) loadFeedback();
}

updateCommentAccess();

function updateRatingDisplay(rating, count) {
    ratingValues.forEach(element => {
        element.textContent = rating ? Number(rating).toFixed(1) : '0.0';
    });
    ratingCounts.forEach(element => {
        element.textContent = `${count} rating${count === 1 ? '' : 's'}`;
    });
    summaryStars.forEach(stars => {
        [...stars.children].forEach((star, index) => {
            star.classList.toggle('muted-star', index >= Math.round(rating));
        });
    });
    ratingButtons.forEach((button, index) => {
        button.classList.toggle('is-selected', selectedRating > 0 && index < selectedRating);
    });
}

let currentRating = 0;
let ratingCount = 0;
let selectedRating = 0;
let commentsCache = [];
let feedbackLoadSequence = 0;
let showAllComments = false;

function renderComments() {
    if (!commentList) return;

    const comments = commentsCache;
    commentList.replaceChildren();

    if (comments.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'comment-item';
        empty.innerHTML = '<strong>No comments yet</strong><p>Signed-in client comments will appear here, with the project owner\'s comment pinned first.</p>';
        commentList.append(empty);
        if (commentViewMore) commentViewMore.hidden = true;
        return;
    }

    const sortedComments = [...comments].sort((first, second) => {
        const firstIsOwner = first.isOwner || (projectOwnerEmail && normalizeEmail(first.email) === projectOwnerEmail);
        const secondIsOwner = second.isOwner || (projectOwnerEmail && normalizeEmail(second.email) === projectOwnerEmail);
        if (firstIsOwner !== secondIsOwner) return Number(secondIsOwner) - Number(firstIsOwner);
        return new Date(second.createdAt || 0) - new Date(first.createdAt || 0);
    });
    const visibleComments = showAllComments ? sortedComments : sortedComments.slice(0, 5);
    visibleComments.forEach(comment => {
        const item = document.createElement('div');
        item.className = 'comment-item';
        const isOwnerComment = comment.isOwner || (projectOwnerEmail && normalizeEmail(comment.email) === projectOwnerEmail);
        if (isOwnerComment) item.classList.add('comment-owner');

        const meta = document.createElement('div');
        meta.className = 'comment-meta';
        const name = document.createElement('strong');
        name.textContent = comment.name;
        const stars = document.createElement('span');
        stars.className = 'stars comment-stars';
        stars.setAttribute('aria-label', `${comment.rating} out of 5 stars`);
        stars.innerHTML = Array.from({ length: 5 }, (_, index) => `<i class="fa-solid fa-star${index < comment.rating ? '' : ' muted-star'}"></i>`).join('');
        meta.append(name, stars);
        if (isOwnerComment) {
            const ownerTag = document.createElement('span');
            ownerTag.className = 'comment-owner-tag';
            ownerTag.textContent = 'Owner of website';
            meta.append(ownerTag);
        }

        const subject = document.createElement('h4');
        subject.textContent = comment.subject;
        const message = document.createElement('p');
        message.className = 'comment-message comment-message-collapsed';
        message.textContent = String(comment.message || '');
        const account = getAccount();
        const canDelete = comment.canDelete;
        item.append(meta, subject, message);
        commentList.append(item);
        if (message.scrollHeight > message.clientHeight + 1) {
            const expandButton = document.createElement('button');
            expandButton.className = 'comment-expand';
            expandButton.type = 'button';
            expandButton.setAttribute('aria-expanded', 'false');
            expandButton.setAttribute('aria-label', 'Show full comment');
            expandButton.innerHTML = '<i class="fa-solid fa-chevron-down" aria-hidden="true"></i>';
            expandButton.addEventListener('click', () => {
                const expanded = expandButton.getAttribute('aria-expanded') === 'true';
                message.classList.toggle('comment-message-collapsed', expanded);
                expandButton.setAttribute('aria-expanded', String(!expanded));
                expandButton.setAttribute('aria-label', expanded ? 'Show full comment' : 'Collapse comment');
            });
            item.append(expandButton);
        }
        if (canDelete) {
            const actions = document.createElement('div');
            actions.className = 'comment-actions';
            const deleteButton = document.createElement('button');
            deleteButton.className = 'comment-delete';
            deleteButton.type = 'button';
        deleteButton.dataset.commentId = comment.id;
            deleteButton.textContent = 'Delete comment';
            actions.append(deleteButton);
            item.append(actions);
        }
    });
    if (commentViewMore) {
        commentViewMore.hidden = sortedComments.length <= 5;
        commentViewMore.textContent = showAllComments ? 'Show fewer comments' : 'View more comments';
    }
}

if (commentViewMore) {
    commentViewMore.addEventListener('click', () => {
        showAllComments = !showAllComments;
        renderComments();
    });
}

renderComments();

async function loadFeedback() {
    if (!document.getElementById('project-detail')) return;
    const requestId = ++feedbackLoadSequence;
    const accountEmail = normalizeEmail(currentSession?.email);
    try {
        const result = await apiRequest(`/api/projects/${encodeURIComponent(projectStorageId)}/feedback`);
        if (requestId !== feedbackLoadSequence || accountEmail !== normalizeEmail(currentSession?.email)) return;
        currentRating = Number(result.rating || 0);
        ratingCount = Number(result.count || 0);
        selectedRating = Number(result.viewerRating || 0);
        commentsCache = Array.isArray(result.comments) ? result.comments : [];
        updateRatingDisplay(currentRating, ratingCount);
        renderComments();
    } catch { /* Feedback remains in its empty state when the server is unavailable. */ }
}

loadFeedback();

ratingButtons.forEach((button, index) => {
    button.addEventListener('click', async () => {
        if (!isSignedIn()) {
            if (commentStatus) commentStatus.textContent = 'Sign in before submitting a rating.';
            return;
        }

        ratingButtons.forEach((otherButton, otherIndex) => {
            otherButton.classList.toggle('is-selected', otherIndex <= index);
        });
        selectedRating = index + 1;

        try {
            await apiRequest(`/api/projects/${encodeURIComponent(projectStorageId)}/feedback/rating`, { method: 'PUT', body: JSON.stringify({ rating: index + 1 }) });
            await loadFeedback();
            if (commentStatus) commentStatus.textContent = 'Your rating has been saved.';
        } catch (error) { if (commentStatus) commentStatus.textContent = error.message; }
    });
});

if (commentForm && commentStatus) {
    commentForm.addEventListener('submit', async event => {
        event.preventDefault();

        if (!isSignedIn()) {
            commentStatus.textContent = 'Sign in before submitting a comment.';
            return;
        }

        const subjectField = document.getElementById('comment-subject');
        const messageField = document.getElementById('project-comment');
        const subject = subjectField?.value.trim();
        const message = messageField?.value.trim();

        if (!subject || !message) {
            commentStatus.textContent = 'Add a subject and comment before posting.';
            return;
        }

        try {
            await apiRequest(`/api/projects/${encodeURIComponent(projectStorageId)}/feedback/comments`, { method: 'POST', body: JSON.stringify({ subject, message }) });
            await loadFeedback();
            commentForm.reset();
            commentStatus.textContent = 'Comment posted.';
        } catch (error) { commentStatus.textContent = error.message; }
    });
}

if (commentList) {
    commentList.addEventListener('click', event => {
        const deleteButton = event.target.closest('.comment-delete');
        if (!deleteButton || !currentAccountIsAdmin() && !getAccount()) return;

        apiRequest(`/api/projects/${encodeURIComponent(projectStorageId)}/feedback/comments/${encodeURIComponent(deleteButton.dataset.commentId)}`, { method: 'DELETE' }).then(() => loadFeedback()).then(() => { if (commentStatus) commentStatus.textContent = 'Comment deleted.'; }).catch(error => { if (commentStatus) commentStatus.textContent = error.message; });
    });
}

const estimateForm = document.getElementById('estimate-form');
const estimateStatus = document.getElementById('estimate-status');
const requestAccountIsland = document.getElementById('request-account-island');
const requestAccountCopy = document.getElementById('request-account-copy');
const requestAccountLink = requestAccountIsland?.querySelector('a');
const estimateSubmit = estimateForm?.querySelector('button[type="submit"]');
sessionStorage.removeItem('crimsonPendingEstimate');
sessionStorage.removeItem('crimsonPendingEstimateReturn');

function updateRequestAccount() {
    if (!requestAccountCopy) return;

    if (!isSignedIn() || !getAccount()) return;

    const account = getAccount();
    const name = `${account.firstName || ''} ${account.lastName || ''}`.trim() || 'Client';
    const strong = document.createElement('strong');
    strong.textContent = 'Client account';
    requestAccountCopy.replaceChildren(strong, document.createTextNode(` Signed in as ${name} (${account.email}).`));
    if (requestAccountLink) requestAccountLink.hidden = true;
}

if (estimateForm) {
    const service = new URLSearchParams(window.location.search).get('service');
    const serviceCopy = {
        'one-revision': 'I would like to add one revision round to my project.',
        'two-revisions': 'I would like to add two revision rounds to my project.'
    }[service];
    const detailsField = estimateForm.elements.namedItem('details');
    if (serviceCopy && detailsField && !detailsField.value) detailsField.value = serviceCopy;

    estimateForm.addEventListener('submit', async event => {
        event.preventDefault();
        if (estimateSubmit) {
            estimateSubmit.disabled = true;
            estimateSubmit.textContent = 'Sending request...';
        }
        if (estimateStatus) estimateStatus.textContent = 'Sending your project details securely...';

        try {
            const response = await fetch(estimateForm.action, {
                method: 'POST',
                body: new URLSearchParams(new FormData(estimateForm)),
                headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            const result = await response.json();
            if (!response.ok || result.success === false) throw new Error(result.message || 'Unable to send request.');
            window.location.href = 'success.html';
        } catch (error) {
            if (estimateSubmit) {
                estimateSubmit.disabled = false;
                estimateSubmit.textContent = 'Send request';
            }
            if (estimateStatus) estimateStatus.textContent = error.message || 'Unable to send request. Please try again.';
        }
    });
}

updateRequestAccount();

const workSearch = document.getElementById('work-search');
const workResults = document.getElementById('work-results');
const workEmpty = document.getElementById('work-empty');
const workGrid = document.getElementById('work-grid');
const projectCardTemplate = document.getElementById('project-card-template');
let workCards = [...document.querySelectorAll('[data-work-card]')];
function getProjects() { return projectCache; }

function updateWebsiteCount(count) {
    document.querySelectorAll('[data-counter-key="websites"]').forEach(counter => {
        const websiteCount = Math.max(0, Number(count) || 0);
        counter.dataset.counter = String(websiteCount);
        animateCounter(counter, websiteCount);
    });
}

async function loadProjectsFromServer() {
    try {
        const result = await apiRequest('/api/projects');
        projectCache = Array.isArray(result.projects) ? result.projects : [];
        projectLoadFailed = false;
        updateWebsiteCount(result.websiteCount ?? projectCache.filter(project => project.projectType !== 'game').length);
        renderAdminProjects();
        updateProjectGridLayout();
        bindProjectCards();
        updateAdminProjectCapacity();
    } catch {
        projectLoadFailed = true;
        if (workEmpty) {
            workEmpty.textContent = 'Projects are temporarily unavailable. Start the site server and refresh to load the portfolio.';
            workEmpty.hidden = workCards.length !== 0;
        }
    }
}

function renderAdminProjects() {
    if (!workGrid || !projectCardTemplate) return;

    workGrid.replaceChildren();
    const projects = getProjects();
    projects.forEach((project, projectIndex) => {
        const card = projectCardTemplate.content.firstElementChild.cloneNode(true);
        card.classList.add('is-visible');
        card.dataset.workCard = '';
        card.dataset.adminProject = '';
        card.dataset.projectIndex = String(projectIndex);
        card.dataset.projectId = project.id;
        card.dataset.search = `${project.name} ${project.description} ${project.tags || ''}`.toLowerCase();

        card.querySelector('[data-project-name]').textContent = project.name;
        card.querySelector('[data-project-description]').textContent = project.description;
        const typeLabel = project.projectType === 'game' ? 'Game' : 'Website';
        const badges = [typeLabel, ...String(project.badges || '').split(',').map(badge => badge.trim()).filter(Boolean)].slice(0, 3);
        card.querySelectorAll('[data-project-badge]').forEach((badgeElement, badgeIndex) => {
            const badge = badges[badgeIndex];
            badgeElement.textContent = badge || '';
            badgeElement.hidden = !badge;
        });
        const projectRating = Number(project.rating || 0);
        const projectRatingCount = Number(project.ratingCount || 0);
        const ratingValue = card.querySelector('.rating-summary strong');
        const ratingCount = card.querySelector('.rating-summary small');
        const ratingSummary = card.querySelector('.rating-summary');
        if (ratingValue) ratingValue.textContent = projectRating ? projectRating.toFixed(1) : '0.0';
        if (ratingCount) ratingCount.textContent = `${projectRatingCount} rating${projectRatingCount === 1 ? '' : 's'}`;
        if (ratingSummary) ratingSummary.setAttribute('aria-label', projectRating ? `${projectRating} out of 5 stars` : 'No ratings yet');
        card.querySelectorAll('.rating-summary .stars i').forEach((star, starIndex) => {
            star.classList.toggle('muted-star', starIndex >= Math.round(projectRating));
        });
        const link = card.querySelector('[data-project-link]');
        if (link && project.link) link.href = project.link;
        else if (link) link.remove();
        const deleteButton = card.querySelector('[data-project-delete]');
        if (deleteButton && currentAccountIsAdmin()) deleteButton.hidden = false;

        workGrid.append(card);
    });
    workCards = [...document.querySelectorAll('[data-work-card]')];
    if (workResults) workResults.textContent = `${workCards.length} project${workCards.length === 1 ? '' : 's'}`;
    if (workEmpty) {
        workEmpty.textContent = projectLoadFailed
            ? 'Projects are temporarily unavailable. Start the site server and refresh to load the portfolio.'
            : 'No projects have been published yet. Check back soon.';
        workEmpty.hidden = workCards.length !== 0;
    }
}

renderAdminProjects();

function updateProjectGridLayout() {
    const visibleCards = workCards.filter(card => !card.hidden);
    if (workGrid) workGrid.dataset.visibleCount = String(visibleCards.length);
    visibleCards.forEach((card, index) => {
        const rowStart = Math.floor(index / 3) * 3;
        const rowSize = Math.min(3, visibleCards.length - rowStart);
        card.dataset.rowSize = String(rowSize);
        card.dataset.rowPosition = String(index - rowStart + 1);
    });
}

updateProjectGridLayout();

if (workSearch && workResults) {
    workSearch.addEventListener('input', () => {
        const query = workSearch.value.trim().toLowerCase();
        let visibleCount = 0;

        workCards.forEach(card => {
            const matches = card.dataset.search.includes(query);
            card.hidden = !matches;
            if (matches) visibleCount += 1;
        });

        workResults.textContent = `${visibleCount} project${visibleCount === 1 ? '' : 's'}`;
        if (workEmpty) workEmpty.hidden = visibleCount !== 0;
        updateProjectGridLayout();
    });
}

function bindProjectCards() {
    workCards.forEach(card => {
    const destinationLink = card.querySelector('.work-card-link, .project-link');
    card.setAttribute('role', 'link');
    card.tabIndex = 0;
    card.setAttribute('aria-label', `Open ${card.querySelector('h3')?.textContent || 'project'}`);

    card.addEventListener('click', event => {
        if (event.target.closest('a, button')) return;

        const projectId = card.dataset.projectId;
        if (projectId) window.location.href = `project.html?projectId=${encodeURIComponent(projectId)}&project=${encodeURIComponent(card.querySelector('[data-project-name]')?.textContent || '')}`;
    });

    card.addEventListener('keydown', event => {
        if (event.target !== card) return;
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            const projectId = card.dataset.projectId;
            if (projectId) window.location.href = `project.html?projectId=${encodeURIComponent(projectId)}&project=${encodeURIComponent(card.querySelector('[data-project-name]')?.textContent || '')}`;
        }
    });
    });
}

loadProjectsFromServer();

bindProjectCards();

if (workGrid) {
    workGrid.addEventListener('click', event => {
        const deleteButton = event.target.closest('[data-project-delete]');
        if (!deleteButton || !currentAccountIsAdmin()) return;

        const card = deleteButton.closest('[data-admin-project]');
        const projectId = card?.dataset.projectId;
        if (!card || !projectId) return;
        if (!window.confirm('Delete this project for everyone using this portfolio?')) return;

        apiRequest(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' }).then(() => loadProjectsFromServer()).catch(error => window.alert(error.message));
    });
}

const adminProjectForm = document.getElementById('admin-project-form');
const adminProjectCapacity = document.getElementById('admin-project-capacity');
const adminProjectExisting = document.getElementById('admin-project-existing');
const adminProjectSubmit = document.getElementById('admin-project-submit');
const customProjectSelect = document.getElementById('admin-project-select');
const customProjectSelectTrigger = customProjectSelect?.querySelector('.custom-select-trigger');
const customProjectSelectMenu = customProjectSelect?.querySelector('.custom-select-menu');
const projectTypeButtons = [...document.querySelectorAll('[data-project-type]')];
let selectedProjectType = 'website';

function setProjectType(type) {
    selectedProjectType = type === 'game' ? 'game' : 'website';
    projectTypeButtons.forEach(button => {
        const isSelected = button.dataset.projectType === selectedProjectType;
        button.classList.toggle('is-active', isSelected);
        button.setAttribute('aria-selected', String(isSelected));
    });
}

projectTypeButtons.forEach(button => button.addEventListener('click', () => setProjectType(button.dataset.projectType)));
setProjectType('website');

function syncCustomProjectSelect() {
    if (!adminProjectExisting || !customProjectSelect) return;
    const selectedOption = adminProjectExisting.options[adminProjectExisting.selectedIndex];
    const triggerLabel = customProjectSelectTrigger?.querySelector('span');
    if (triggerLabel) triggerLabel.textContent = selectedOption?.textContent || 'Create a new project';
    customProjectSelectMenu?.querySelectorAll('[role="option"]').forEach(option => {
        option.setAttribute('aria-selected', String(option.dataset.value === adminProjectExisting.value));
    });
}

function renderAdminProjectChoices() {
    if (!adminProjectExisting) return;
    const selectedValue = adminProjectExisting.value;
    adminProjectExisting.replaceChildren(new Option('Create a new project', ''));
    customProjectSelectMenu?.replaceChildren();
    const options = [{ label: 'Create a new project', value: '' }];
    getProjects().forEach((project, index) => {
        adminProjectExisting.append(new Option(project.name, String(index)));
        options.push({ label: project.name, value: String(index) });
    });
    adminProjectExisting.value = [...adminProjectExisting.options].some(option => option.value === selectedValue) ? selectedValue : '';
    options.forEach(option => {
        if (!customProjectSelectMenu) return;
        const optionButton = document.createElement('button');
        optionButton.className = 'custom-select-option';
        optionButton.type = 'button';
        optionButton.setAttribute('role', 'option');
        optionButton.setAttribute('aria-selected', 'false');
        optionButton.dataset.value = option.value;
        optionButton.textContent = option.label;
        optionButton.addEventListener('click', () => {
            adminProjectExisting.value = option.value;
            syncCustomProjectSelect();
            customProjectSelectTrigger?.setAttribute('aria-expanded', 'false');
            customProjectSelectMenu.hidden = true;
            adminProjectExisting.dispatchEvent(new Event('change', { bubbles: true }));
        });
        customProjectSelectMenu.append(optionButton);
    });
    syncCustomProjectSelect();
}

if (customProjectSelectTrigger && customProjectSelectMenu) {
    customProjectSelectTrigger.addEventListener('click', () => {
        const isOpen = customProjectSelectTrigger.getAttribute('aria-expanded') === 'true';
        customProjectSelectTrigger.setAttribute('aria-expanded', String(!isOpen));
        customProjectSelectMenu.hidden = isOpen;
    });
    document.addEventListener('click', event => {
        if (!customProjectSelect.contains(event.target)) {
            customProjectSelectTrigger.setAttribute('aria-expanded', 'false');
            customProjectSelectMenu.hidden = true;
        }
    });
    customProjectSelectTrigger.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            customProjectSelectTrigger.setAttribute('aria-expanded', 'false');
            customProjectSelectMenu.hidden = true;
        }
    });
}

function loadAdminProject(projectIndex) {
    const project = getProjects()[Number(projectIndex)];
    if (!project) {
        adminProjectSubmit.textContent = 'Add project';
        return;
    }

    const whatBuilt = project.whatBuilt || project;

    document.getElementById('admin-project-name').value = project.name || '';
    document.getElementById('admin-project-description').value = project.description || '';
    document.getElementById('admin-project-tags').value = project.tags || whatBuilt.tags || '';
    document.getElementById('admin-project-link').value = project.link || '';
    document.getElementById('admin-project-owner-email').value = project.ownerEmail || '';
    document.getElementById('admin-project-badges').value = project.badges || '';
    document.getElementById('admin-project-direction').value = project.direction || whatBuilt.direction || '';
    document.getElementById('admin-project-structure').value = project.structure || whatBuilt.structure || '';
    document.getElementById('admin-project-focus').value = project.focus || whatBuilt.focus || '';
    document.getElementById('admin-project-build-title').value = project.buildTitle || whatBuilt.title || whatBuilt.buildTitle || '';
    document.getElementById('admin-project-build-description').value = project.buildDescription || whatBuilt.description || whatBuilt.buildDescription || '';
    setProjectType(project.projectType || project.type || 'website');
    adminProjectSubmit.textContent = 'Save project changes';
}

if (adminProjectExisting) adminProjectExisting.addEventListener('change', () => {
    if (adminProjectExisting.value === '') {
        adminProjectForm?.reset();
        setProjectType('website');
        syncCustomProjectSelect();
        if (adminProjectSubmit) adminProjectSubmit.textContent = 'Add project';
        return;
    }
    loadAdminProject(adminProjectExisting.value);
});

function updateAdminProjectCapacity() {
    if (!adminProjectForm || !adminProjectCapacity) return;
    const count = getProjects().length;
    adminProjectCapacity.textContent = `${count} active project${count === 1 ? '' : 's'}`;
    renderAdminProjectChoices();
}

if (adminProjectForm) {
    adminProjectForm.addEventListener('submit', async event => {
        event.preventDefault();
        if (!currentAccountIsAdmin()) return;
        const status = document.getElementById('admin-project-status');

        const project = {
            name: document.getElementById('admin-project-name')?.value.trim(),
            description: document.getElementById('admin-project-description')?.value.trim(),
            tags: document.getElementById('admin-project-tags')?.value.trim(),
            link: document.getElementById('admin-project-link')?.value.trim(),
            ownerEmail: normalizeEmail(document.getElementById('admin-project-owner-email')?.value),
            badges: document.getElementById('admin-project-badges')?.value.trim(),
            direction: document.getElementById('admin-project-direction')?.value.trim(),
            structure: document.getElementById('admin-project-structure')?.value.trim(),
            focus: document.getElementById('admin-project-focus')?.value.trim(),
            buildTitle: document.getElementById('admin-project-build-title')?.value.trim(),
            buildDescription: document.getElementById('admin-project-build-description')?.value.trim(),
            projectType: selectedProjectType
        };
        const isEditing = adminProjectExisting?.value !== '';
        const selectedIndex = Number(adminProjectExisting?.value);
        const existingProject = isEditing ? getProjects()[selectedIndex] : null;
        try {
            const endpoint = existingProject ? `/api/projects/${encodeURIComponent(existingProject.id)}` : '/api/projects';
            await apiRequest(endpoint, { method: existingProject ? 'PUT' : 'POST', body: JSON.stringify(existingProject ? { ...project, id: existingProject.id } : project) });
            adminProjectForm.reset();
            setProjectType('website');
            syncCustomProjectSelect();
            if (status) status.textContent = isEditing ? 'Project changes saved.' : 'Project added to the Projects page.';
            if (adminProjectSubmit) adminProjectSubmit.textContent = 'Add project';
            await loadProjectsFromServer();
        } catch (error) { if (status) status.textContent = error.message; }
    });
}

updateAdminProjectCapacity();

const adminManagementForm = document.getElementById('admin-management-form');
const adminList = document.getElementById('admin-list');
const adminManagementStatus = document.getElementById('admin-management-status');
let adminCache = [];

function renderAdminManagement() {
    if (!adminList) return;
    const account = getAccount();
    if (!currentAccountIsAdmin()) {
        adminList.innerHTML = '<p class="admin-access-note">This page is only available to administrators.</p>';
        if (adminManagementForm) adminManagementForm.hidden = true;
        return;
    }

    if (adminManagementForm) adminManagementForm.hidden = false;

    const admins = adminCache.length ? adminCache : getAdmins();
    adminList.replaceChildren();
    admins.forEach(admin => {
        const item = document.createElement('div');
        item.className = 'admin-list-item';
        const adminEmail = normalizeEmail(admin.email || (admin.accountId === getAccount()?.id ? getAccount()?.email : ''));
        const isOwner = Boolean(admin.isOwner);
        const identity = document.createElement('div');
        identity.className = 'admin-list-identity';
        const name = document.createElement('strong');
        name.textContent = admin.name || 'Administrator';
        const role = document.createElement('span');
        role.className = 'admin-role';
        role.textContent = isOwner ? 'Owner' : 'Administrator';
        const email = document.createElement('span');
        email.textContent = adminEmail || 'Email unavailable';
        identity.append(name, role);
        item.append(identity, email);
        const isCurrentAccount = adminEmail === normalizeEmail(getAccount()?.email);
        if (!isOwner && admin.accountId && !isCurrentAccount) {
            const deleteButton = document.createElement('button');
            deleteButton.className = 'admin-delete';
            deleteButton.type = 'button';
            deleteButton.dataset.adminId = admin.accountId;
            deleteButton.textContent = 'Delete';
            item.append(deleteButton);
        }
        adminList.append(item);
    });
}

async function loadAdminManagement() {
    if (!adminList || !currentAccountIsAdmin()) { renderAdminManagement(); return; }
    try {
        const result = await apiRequest('/api/admins');
        adminCache = Array.isArray(result.admins) ? result.admins : [];
        localStorage.setItem('crimsonAdmins', JSON.stringify({ admins: adminCache, savedAt: Date.now() }));
    } catch (error) {
        if (adminManagementStatus) adminManagementStatus.textContent = `${error.message} Showing the last recent roster, if available.`;
    }
    renderAdminManagement();
}

loadAdminManagement();

if (adminList) {
    adminList.addEventListener('click', async event => {
        const deleteButton = event.target.closest('[data-admin-id]');
        if (!deleteButton || !currentAccountIsAdmin()) return;
        if (!window.confirm('Remove this administrator from the site?')) return;
        try {
            await apiRequest(`/api/admins/${encodeURIComponent(deleteButton.dataset.adminId)}`, { method: 'DELETE' });
            if (adminManagementStatus) adminManagementStatus.textContent = 'Administrator removed.';
            await loadAdminManagement();
        } catch (error) {
            if (adminManagementStatus) adminManagementStatus.textContent = error.message;
        }
    });
}

const requestList = document.getElementById('request-list');
const requestSearch = document.getElementById('request-search');
const requestEmpty = document.getElementById('request-empty');
const requestTabs = [...document.querySelectorAll('[data-request-tab]')];
const requestCounts = [...document.querySelectorAll('[data-request-count]')];
const workspaceUpdates = document.getElementById('workspace-updates');
const workspaceNotificationList = document.getElementById('workspace-notification-list');
const workspaceEmpty = document.getElementById('workspace-empty');
const workspaceProgress = document.querySelector('[data-workspace-progress]');
const workspaceState = document.querySelector('[data-project-state]');
const workspaceMessage = document.querySelector('[data-workspace-message]');
const workspaceProgressLabel = document.querySelector('[data-workspace-progress-label]');
const workspaceStatProgress = document.querySelector('[data-workspace-stat-progress]');
const workspaceStatUpdates = document.querySelector('[data-workspace-stat-updates]');
const workspaceStatNext = document.querySelector('[data-workspace-stat-next]');
const activeProjectsLabel = document.querySelector('[data-active-projects]');
let contactRequests = [];
let activeRequestStatus = 'pending';

function requestValue(value) {
    return String(value || '').trim();
}

function formatRequestDate(value, includeTime = true) {
    if (!value) return 'Unknown date';
    return new Date(value).toLocaleString([], includeTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
}

function renderContactRequests() {
    if (!requestList) return;
    const query = requestValue(requestSearch?.value).toLowerCase();
    const statusCounts = { pending: 0, confirmed: 0, completed: 0 };
    contactRequests.forEach(request => {
        if (statusCounts[request.status] !== undefined) statusCounts[request.status] += 1;
    });
    requestCounts.forEach(count => {
        count.textContent = String(statusCounts[count.dataset.requestCount] || 0);
    });
    const visibleRequests = contactRequests
        .filter(request => request.status === activeRequestStatus)
        .filter(request => `${request.name} ${request.business} ${request.email}`.toLowerCase().includes(query));
    requestList.replaceChildren();
    visibleRequests.forEach(request => {
        const item = document.createElement('details');
        item.className = 'request-item';
        const summary = document.createElement('summary');
        const summaryName = document.createElement('strong');
        summaryName.textContent = request.name || request.email || 'Unnamed request';
        const summaryDate = document.createElement('time');
        summaryDate.dateTime = request.createdAt || '';
        summaryDate.textContent = formatRequestDate(request.createdAt);
        const summaryProgress = document.createElement('span');
        summaryProgress.className = 'request-summary-progress';
        summaryProgress.textContent = `${Number(request.progress || 0)}% complete`;
        const deleteButton = document.createElement('button');
        deleteButton.className = 'request-delete-button';
        deleteButton.type = 'button';
        deleteButton.title = 'Delete request';
        deleteButton.setAttribute('aria-label', `Delete request from ${request.name || request.email}`);
        deleteButton.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i>';
        deleteButton.addEventListener('click', async event => {
            event.preventDefault();
            event.stopPropagation();
            if (!window.confirm('Delete this request permanently?')) return;
            try {
                await apiRequest(`/api/contact-requests/${encodeURIComponent(request.id)}`, { method: 'DELETE' });
                item.remove();
                await loadContactRequests();
            } catch (error) { requestEmpty.textContent = error.message; }
        });
        summary.append(summaryName, summaryProgress, summaryDate, deleteButton);
        const details = document.createElement('div');
        details.className = 'request-item-details';
        const fields = [
            ['Email', request.email],
            ['Business', request.business],
            ['Phone', request.phone],
            ['Budget', request.budget],
            ['Pages', request.pages],
            ['Project details', request.details],
            ['Goal', request.projectGoal],
            ['Style', request.projectStyle],
            ['Timeline', request.projectTimeline]
        ];
        fields.filter(([, value]) => requestValue(value)).forEach(([label, value]) => {
            const field = document.createElement('p');
            const fieldLabel = document.createElement('strong');
            fieldLabel.textContent = `${label}: `;
            field.append(fieldLabel, document.createTextNode(requestValue(value)));
            details.append(field);
        });
        const progress = Number(request.progress || 0);
        const progressField = document.createElement('p');
        const progressLabel = document.createElement('strong');
        progressLabel.textContent = 'Progress: ';
        progressField.append(progressLabel, document.createTextNode(`${progress}%`));
        details.append(progressField);
        if (activeRequestStatus === 'confirmed') {
            const updateForm = document.createElement('form');
            updateForm.className = 'request-update-form';
            updateForm.innerHTML = `<div class="request-progress-control"><div class="request-progress-heading"><span>Project progress</span><output>${progress}%</output></div><div class="request-progress-visual" style="--progress: ${progress}%"><span class="request-progress-fill"></span><span class="request-progress-thumb"></span><input class="request-progress-slider" aria-label="Project progress percentage" type="range" min="0" max="100" step="1" value="${progress}"></div></div><label>Update note<textarea rows="3" maxlength="1000" placeholder="Example: Just updated your profile section."></textarea></label>`;
            const slider = updateForm.querySelector('.request-progress-slider');
            const output = updateForm.querySelector('output');
            const visual = updateForm.querySelector('.request-progress-visual');
            slider.addEventListener('input', () => { output.textContent = `${slider.value}%`; visual.style.setProperty('--progress', `${slider.value}%`); });
            const saveButton = document.createElement('button');
            saveButton.className = 'btn btn-secondary';
            saveButton.type = 'submit';
            saveButton.textContent = 'Save update';
            updateForm.append(saveButton);
            updateForm.addEventListener('submit', async event => {
                event.preventDefault();
                saveButton.disabled = true;
                try {
                    await apiRequest(`/api/contact-requests/${encodeURIComponent(request.id)}`, { method: 'PATCH', body: JSON.stringify({ progress: Number(slider.value), note: updateForm.querySelector('textarea').value }) });
                    await loadContactRequests();
                } catch (error) {
                    saveButton.disabled = false;
                    requestEmpty.textContent = error.message;
                }
            });
            details.append(updateForm);
        }
        const statusButton = document.createElement('button');
        statusButton.className = 'btn btn-secondary request-status-button';
        statusButton.type = 'button';
        statusButton.textContent = activeRequestStatus === 'pending' ? 'Mark confirmed' : activeRequestStatus === 'confirmed' ? 'Mark completed' : 'Completed';
        statusButton.disabled = activeRequestStatus === 'completed';
        statusButton.addEventListener('click', async event => {
            event.preventDefault();
            try {
                await apiRequest(`/api/contact-requests/${encodeURIComponent(request.id)}`, { method: 'PATCH', body: JSON.stringify({ status: activeRequestStatus === 'pending' ? 'confirmed' : 'completed' }) });
                await loadContactRequests();
            } catch (error) {
                if (requestEmpty) requestEmpty.textContent = error.message;
            }
        });
        details.append(statusButton);
        item.append(summary, details);
        requestList.append(item);
    });
    requestEmpty.hidden = visibleRequests.length !== 0;
    requestEmpty.textContent = query ? 'No matching requests in this tab.' : 'No requests in this tab yet.';
}

function renderWorkspaceUpdates(requests) {
    if (!workspaceUpdates) return;
    workspaceUpdates.hidden = !currentSession;
    if (!currentSession || !workspaceNotificationList) return;
    const activeRequest = requests.find(request => request.status !== 'completed') || requests[0];
    const progress = Number(activeRequest?.progress || 0);
    const notifications = requests.flatMap(request => (request.notifications || []).map(notification => ({ ...notification, projectName: request.business || 'Your project' })))
        .sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt));
    if (workspaceState) workspaceState.textContent = activeRequest ? activeRequest.status === 'completed' ? 'Project completed' : 'Project in progress' : 'No current projects yet';
    if (activeProjectsLabel) activeProjectsLabel.textContent = activeRequest ? activeRequest.status === 'completed' ? 'Project completed' : '1 active project' : 'No active project';
    if (workspaceMessage) workspaceMessage.textContent = activeRequest ? `Your project is ${progress}% complete. New progress notes will appear here as work continues.` : 'Your workspace will show project updates, files, approvals, and milestones here when a project is connected.';
    if (workspaceProgressLabel) workspaceProgressLabel.textContent = activeRequest ? 'Project progress' : 'Waiting for a project';
    if (workspaceStatProgress) workspaceStatProgress.textContent = activeRequest ? `${progress}%` : '00%';
    if (workspaceStatUpdates) workspaceStatUpdates.textContent = String(notifications.length).padStart(2, '0');
    if (workspaceStatNext) workspaceStatNext.textContent = notifications[0] ? `${Number(notifications[0].progress || progress)}%` : activeRequest ? 'Started' : '--';
    if (workspaceProgress) workspaceProgress.textContent = `${progress}% complete`;
    const track = document.querySelector('.portal-progress-track');
    const trackFill = track?.querySelector('span');
    if (trackFill) trackFill.style.width = `${progress}%`;
    if (track) track.setAttribute('aria-label', `Project progress: ${progress} percent`);
    workspaceNotificationList.replaceChildren();
    notifications.forEach(notification => {
        const item = document.createElement('article');
        item.className = 'workspace-notification';
        const heading = document.createElement('div');
        heading.className = 'workspace-notification-heading';
        const title = document.createElement('strong');
        title.textContent = notification.projectName;
        const date = document.createElement('time');
        date.dateTime = notification.createdAt || '';
        date.textContent = formatRequestDate(notification.createdAt);
        heading.append(title, date);
        const message = document.createElement('p');
        message.textContent = notification.message;
        const deleteButton = document.createElement('button');
        deleteButton.className = 'request-delete-button';
        deleteButton.type = 'button';
        deleteButton.title = 'Delete notification';
        deleteButton.setAttribute('aria-label', 'Delete notification');
        deleteButton.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i>';
        deleteButton.addEventListener('click', async () => {
            try {
                await apiRequest(`/api/my-workspace/notifications/${encodeURIComponent(notification.id)}`, { method: 'DELETE' });
                await loadWorkspaceUpdates();
            } catch (error) { if (workspaceEmpty) workspaceEmpty.textContent = error.message; }
        });
        item.append(heading, message, deleteButton);
        workspaceNotificationList.append(item);
    });
    if (workspaceEmpty) {
        workspaceEmpty.hidden = notifications.length !== 0;
        workspaceEmpty.textContent = 'Your project updates will appear here.';
    }
}

async function loadWorkspaceUpdates() {
    if (!workspaceUpdates || !currentSession) return;
    try {
        const result = await apiRequest('/api/my-workspace');
        renderWorkspaceUpdates(Array.isArray(result.requests) ? result.requests : []);
    } catch { /* The workspace can still show its signed-in shell if updates are unavailable. */ }
}

setInterval(() => {
    if (currentSession) loadWorkspaceUpdates();
}, 30000);

async function loadContactRequests() {
    if (!requestList || !currentAccountIsAdmin()) return;
    try {
        const result = await apiRequest('/api/contact-requests');
        contactRequests = Array.isArray(result.requests) ? result.requests : [];
        renderContactRequests();
    } catch { /* The empty state remains visible if the queue is unavailable. */ }
}

requestTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        activeRequestStatus = tab.dataset.requestTab;
        requestTabs.forEach(otherTab => otherTab.setAttribute('aria-selected', String(otherTab === tab)));
        renderContactRequests();
    });
});

if (requestSearch) requestSearch.addEventListener('input', renderContactRequests);
renderContactRequests();

const projectDetail = document.getElementById('project-detail');
if (projectDetail) {
    const projectId = new URLSearchParams(window.location.search).get('projectId');
    const projectName = new URLSearchParams(window.location.search).get('project');
    const detailStatus = projectDetail.querySelector('[data-detail-status]');

    function renderProjectDetails(project) {
        projectStorageId = project.id;
        projectOwnerEmail = normalizeEmail(project.ownerEmail);
        projectDetail.querySelector('[data-detail-name]').textContent = project.name;
        projectDetail.querySelector('[data-detail-description]').textContent = project.description;
        const whatBuilt = project.whatBuilt || {};
        document.querySelector('[data-detail-tags]').textContent = project.tags || whatBuilt.tags || '';
        document.querySelector('[data-detail-build-title]').textContent = project.buildTitle || whatBuilt.title || whatBuilt.buildTitle || '';
        document.querySelector('[data-detail-build-description]').textContent = project.buildDescription || whatBuilt.description || whatBuilt.buildDescription || '';
        document.querySelector('[data-detail-direction]').textContent = project.direction || whatBuilt.direction || '';
        document.querySelector('[data-detail-structure]').textContent = project.structure || whatBuilt.structure || '';
        document.querySelector('[data-detail-focus]').textContent = project.focus || whatBuilt.focus || '';
        const detailLink = projectDetail.querySelector('[data-detail-link]');
        if (project.link) { detailLink.href = project.link; detailLink.hidden = false; } else detailLink.hidden = true;
        document.querySelector('[data-detail-tags]').hidden = false;
        if (detailStatus) detailStatus.hidden = true;
    }

    const cachedProject = projectId
        ? getProjects().find(savedProject => savedProject.id === projectId) || getProjects().find(savedProject => savedProject.name === projectName)
        : getProjects().find(savedProject => savedProject.name === projectName);
    if (cachedProject) {
        renderProjectDetails(cachedProject);
    } else {
        projectDetail.querySelector('[data-detail-name]').textContent = 'Loading project...';
        projectDetail.querySelector('[data-detail-description]').textContent = 'Loading the latest project details.';
    }

    function showProjectNotFound() {
        projectDetail.querySelector('[data-detail-name]').textContent = 'Project not found';
        projectDetail.querySelector('[data-detail-description]').textContent = 'This project is no longer in the active portfolio.';
        const tags = document.querySelector('[data-detail-tags]');
        const detailLink = projectDetail.querySelector('[data-detail-link]');
        if (tags) tags.hidden = true;
        if (detailLink) detailLink.hidden = true;
        if (detailStatus) {
            detailStatus.hidden = false;
            detailStatus.textContent = 'Return to Projects to choose another project.';
        }
    }

    async function loadProjectDetail() {
        if (!projectId && !projectName) return;
        try {
            const result = await apiRequest('/api/projects');
            const serverProject = (result.projects || []).find(savedProject => projectId ? savedProject.id === projectId : savedProject.name === projectName)
                || (projectName ? (result.projects || []).find(savedProject => savedProject.name === projectName) : null);
            if (!serverProject) { showProjectNotFound(); return; }
            renderProjectDetails(serverProject);
            await loadFeedback();
        } catch {
            if (!cachedProject) showProjectNotFound();
        }
    }

    loadProjectDetail();
}

if (adminManagementForm) {
    adminManagementForm.addEventListener('submit', async event => {
        event.preventDefault();
        if (!currentAccountIsAdmin()) return;

        const admin = {
            name: document.getElementById('admin-name')?.value.trim(),
            email: normalizeEmail(document.getElementById('admin-email')?.value)
        };
        if (!admin.email) return;

        try {
            await apiRequest('/api/admins', { method: 'POST', body: JSON.stringify(admin) });
            adminManagementForm.reset();
            if (adminManagementStatus) adminManagementStatus.textContent = 'Administrator added.';
            loadAdminManagement();
        } catch (error) { if (adminManagementStatus) adminManagementStatus.textContent = error.message; }
    });
}

const newsletterForm = document.getElementById('newsletter-form');
if (newsletterForm) {
    const newsletterSubject = document.getElementById('newsletter-subject');
    const newsletterMessage = document.getElementById('newsletter-message');
    const newsletterStatus = document.getElementById('newsletter-status');
    const newsletterSend = document.getElementById('newsletter-send');
    let savedDraft = null;
    try { savedDraft = JSON.parse(localStorage.getItem('crimsonNewsletterDraft') || 'null'); } catch { savedDraft = null; }
    if (savedDraft) {
        if (newsletterSubject) newsletterSubject.value = savedDraft.subject || '';
        if (newsletterMessage) newsletterMessage.value = savedDraft.message || '';
    }
    newsletterForm.addEventListener('submit', async event => {
        event.preventDefault();
        const draft = {
            subject: newsletterSubject?.value.trim() || '',
            message: newsletterMessage?.value.trim() || '',
            savedAt: Date.now()
        };
        localStorage.setItem('crimsonNewsletterDraft', JSON.stringify(draft));
        if (!draft.subject || !draft.message) {
            if (newsletterStatus) newsletterStatus.textContent = 'Add a subject and message before sending.';
            return;
        }
        if (!window.confirm('Send this newsletter to all opted-in subscribers?')) return;
        if (newsletterSend) {
            newsletterSend.disabled = true;
            newsletterSend.textContent = 'Sending newsletter...';
        }
        if (newsletterStatus) newsletterStatus.textContent = 'Sending to opted-in subscribers...';
        try {
            const result = await apiRequest('/api/newsletter', { method: 'POST', body: JSON.stringify(draft) });
            if (newsletterStatus) newsletterStatus.textContent = `Newsletter sent to ${result.sent} subscriber${result.sent === 1 ? '' : 's'}${result.failed ? `; ${result.failed} failed` : ''}.`;
        } catch (error) {
            if (newsletterStatus) newsletterStatus.textContent = error.message;
        } finally {
            if (newsletterSend) {
                newsletterSend.disabled = false;
                newsletterSend.textContent = 'Send newsletter';
            }
        }
    });
}
